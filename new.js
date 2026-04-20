// # Create a profile
// curl - X POST https://profile-api-eta.vercel.app/api/profiles \
// -H "Content-Type: application/json" \
// -d '{"name": "ella"}'

// # Get all profiles
// curl https://profile-api-eta.vercel.app/api/profiles

// # Filter by gender
// curl "https://profile-api-eta.vercel.app/api/profiles?gender=female"

// # Get one profile(replace with a real ID from above)
// curl https://profile-api-eta.vercel.app/api/profiles/<id>

// # Delete a profile
// curl - X DELETE https://profile-api-eta.vercel.app/api/profiles/<id>