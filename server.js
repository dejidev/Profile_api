const express = require('express');

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

// UUID v7 generator (no package needed)
function generateUUIDv7() {
    const now = Date.now();
    const timeHigh = Math.floor(now / 0x100000000);
    const timeLow = now & 0xffffffff;
    const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    const timeHighHex = timeHigh.toString(16).padStart(8, '0');
    const timeLowHex = timeLow.toString(16).padStart(8, '0');
    const part1 = timeHighHex.slice(0, 8);
    const part2 = timeLowHex.slice(0, 4);
    const part3 = '7' + rand().slice(1);
    const part4 = (8 + Math.floor(Math.random() * 4)).toString(16) + rand().slice(1);
    const part5 = rand() + rand() + rand();
    return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

// In-memory store
const profiles = {};

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
    const existing = Object.values(profiles).find(p => p.name === nameLower);
    if (existing) {
        return res.status(201).json({
            status: 'success',
            message: 'Profile already exists',
            data: existing,
        });
    }

    try {
        const [genderData, agifyData, nationalizeData] = await Promise.all([
            fetchExternal(`https://api.genderize.io?name=${encodeURIComponent(nameLower)}`, 'Genderize'),
            fetchExternal(`https://api.agify.io?name=${encodeURIComponent(nameLower)}`, 'Agify'),
            fetchExternal(`https://api.nationalize.io?name=${encodeURIComponent(nameLower)}`, 'Nationalize'),
        ]);

        if (!genderData.gender || genderData.count === 0) {
            return res.status(502).json({ status: 'error', message: 'Genderize returned an invalid response' });
        }
        if (agifyData.age === null || agifyData.age === undefined) {
            return res.status(502).json({ status: 'error', message: 'Agify returned an invalid response' });
        }
        if (!nationalizeData.country || nationalizeData.country.length === 0) {
            return res.status(502).json({ status: 'error', message: 'Nationalize returned an invalid response' });
        }

        const topCountry = nationalizeData.country.reduce((a, b) =>
            a.probability > b.probability ? a : b
        );

        const profile = {
            id: generateUUIDv7(),
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

        profiles[profile.id] = profile;

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

    let result = Object.values(profiles);

    if (gender) result = result.filter(p => p.gender.toLowerCase() === gender.toLowerCase());
    if (country_id) result = result.filter(p => p.country_id.toLowerCase() === country_id.toLowerCase());
    if (age_group) result = result.filter(p => p.age_group.toLowerCase() === age_group.toLowerCase());

    const data = result.map(({ id, name, gender, age, age_group, country_id }) =>
        ({ id, name, gender, age, age_group, country_id })
    );

    return res.status(200).json({ status: 'success', count: data.length, data });
});

// GET /api/profiles/:id
app.get('/api/profiles/:id', (req, res) => {
    const profile = profiles[req.params.id];
    if (!profile) {
        return res.status(404).json({ status: 'error', message: 'Profile not found' });
    }
    return res.status(200).json({ status: 'success', data: profile });
});

// DELETE /api/profiles/:id
app.delete('/api/profiles/:id', (req, res) => {
    if (!profiles[req.params.id]) {
        return res.status(404).json({ status: 'error', message: 'Profile not found' });
    }
    delete profiles[req.params.id];
    return res.sendStatus(204);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

module.exports = app;