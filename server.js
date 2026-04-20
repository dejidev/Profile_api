const express = require('express');
const { v7: uuidv7 } = require('uuid');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// DB setup
const db = new Database(path.join(__dirname, 'profiles.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    gender TEXT,
    gender_probability REAL,
    sample_size INTEGER,
    age INTEGER,
    age_group TEXT,
    country_id TEXT,
    country_probability REAL,
    created_at TEXT NOT NULL
  )
`);

// Helpers
function getAgeGroup(age) {
  if (age <= 12) return 'child';
  if (age <= 19) return 'teenager';
  if (age <= 59) return 'adult';
  return 'senior';
}

async function fetchExternal(url, apiName) {
  const res = await fetch(url);
  if (!res.ok) throw { status: 502, message: `${apiName} returned an invalid response` };
  return res.json();
}

// POST /api/profiles
app.post('/api/profiles', async (req, res) => {
  const { name } = req.body;

  if (name === undefined || name === null || name === '') {
    return res.status(400).json({ status: 'error', message: 'Missing or empty name' });
  }
  if (typeof name !== 'string') {
    return res.status(422).json({ status: 'error', message: 'Invalid type for name' });
  }

  const nameLower = name.trim().toLowerCase();
  if (!nameLower) {
    return res.status(400).json({ status: 'error', message: 'Missing or empty name' });
  }

  // Check existing
  const existing = db.prepare('SELECT * FROM profiles WHERE name = ?').get(nameLower);
  if (existing) {
    return res.status(201).json({
      status: 'success',
      message: 'Profile already exists',
      data: existing
    });
  }

  // Call external APIs
  try {
    const [genderData, agifyData, nationalizeData] = await Promise.all([
      fetchExternal(`https://api.genderize.io?name=${encodeURIComponent(nameLower)}`, 'Genderize'),
      fetchExternal(`https://api.agify.io?name=${encodeURIComponent(nameLower)}`, 'Agify'),
      fetchExternal(`https://api.nationalize.io?name=${encodeURIComponent(nameLower)}`, 'Nationalize'),
    ]);

    // Validate responses
    if (!genderData.gender || genderData.count === 0) {
      return res.status(502).json({ status: 'error', message: 'Genderize returned an invalid response' });
    }
    if (agifyData.age === null || agifyData.age === undefined) {
      return res.status(502).json({ status: 'error', message: 'Agify returned an invalid response' });
    }
    if (!nationalizeData.country || nationalizeData.country.length === 0) {
      return res.status(502).json({ status: 'error', message: 'Nationalize returned an invalid response' });
    }

    // Pick top country
    const topCountry = nationalizeData.country.reduce((a, b) =>
      a.probability > b.probability ? a : b
    );

    const profile = {
      id: uuidv7(),
      name: nameLower,
      gender: genderData.gender,
      gender_probability: genderData.probability,
      sample_size: genderData.count,
      age: agifyData.age,
      age_group: getAgeGroup(agifyData.age),
      country_id: topCountry.country_id,
      country_probability: topCountry.probability,
      created_at: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO profiles (id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_probability, created_at)
      VALUES (@id, @name, @gender, @gender_probability, @sample_size, @age, @age_group, @country_id, @country_probability, @created_at)
    `).run(profile);

    return res.status(201).json({ status: 'success', data: profile });

  } catch (err) {
    if (err.status === 502) {
      return res.status(502).json({ status: 'error', message: err.message });
    }
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// GET /api/profiles
app.get('/api/profiles', (req, res) => {
  const { gender, country_id, age_group } = req.query;

  let query = 'SELECT id, name, gender, age, age_group, country_id FROM profiles WHERE 1=1';
  const params = [];

  if (gender) {
    query += ' AND LOWER(gender) = ?';
    params.push(gender.toLowerCase());
  }
  if (country_id) {
    query += ' AND LOWER(country_id) = ?';
    params.push(country_id.toLowerCase());
  }
  if (age_group) {
    query += ' AND LOWER(age_group) = ?';
    params.push(age_group.toLowerCase());
  }

  const profiles = db.prepare(query).all(...params);
  return res.status(200).json({ status: 'success', count: profiles.length, data: profiles });
});

// GET /api/profiles/:id
app.get('/api/profiles/:id', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) {
    return res.status(404).json({ status: 'error', message: 'Profile not found' });
  }
  return res.status(200).json({ status: 'success', data: profile });
});

// DELETE /api/profiles/:id
app.delete('/api/profiles/:id', (req, res) => {
  const result = db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ status: 'error', message: 'Profile not found' });
  }
  return res.sendStatus(204);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));