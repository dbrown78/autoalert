const express = require('express');
const router = express.Router();

// GET /api/mechanics?lat=&lng=&radius=
// Proxies Google Places Nearby Search so the API key stays server-side.
router.get('/', async (req, res) => {
  const { lat, lng, radius = 8000 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ message: 'lat and lng are required' });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ message: 'Places API key not configured' });
  }

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.rating',
          'places.userRatingCount',
          'places.nationalPhoneNumber',
          'places.location',
          'places.regularOpeningHours.openNow',
        ].join(','),
      },
      body: JSON.stringify({
        includedTypes: ['car_repair'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
            radius: parseFloat(radius),
          },
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Places API error:', err);
      return res.status(502).json({ message: 'Places API request failed' });
    }

    const data = await response.json();

    const EXCLUDED_KEYWORDS = [
      'autozone', "o'reilly", 'advance auto', 'car wash', 'supply',
      'wholesale', 'inspection', 'mvc', 'nissan', 'honda', 'toyota',
      'ford', 'chevy', 'bmw', 'mercedes',
    ];

    // Normalize to a flat shape the frontend can use directly
    const all = (data.places || []).map(p => ({
      id: p.id,
      name: p.displayName?.text ?? 'Unknown',
      address: p.formattedAddress ?? '',
      rating: p.rating ?? null,
      ratingCount: p.userRatingCount ?? 0,
      phone: p.nationalPhoneNumber ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      openNow: p.regularOpeningHours?.openNow ?? null,
    }));

    // Remove dealerships, parts stores, car washes, etc.
    const filtered = all.filter(s => {
      const lower = s.name.toLowerCase();
      return !EXCLUDED_KEYWORDS.some(kw => lower.includes(kw));
    });

    // Prioritize established shops (rating >= 4.0, ratingCount >= 50)
    const preferred = filtered.filter(s => s.rating >= 4.0 && s.ratingCount >= 50);
    const rest      = filtered.filter(s => !(s.rating >= 4.0 && s.ratingCount >= 50));
    const shops     = [...preferred, ...rest].slice(0, 8);

    res.json({ shops });
  } catch (err) {
    console.error('mechanics/nearby error:', err);
    res.status(500).json({ message: 'Failed to fetch nearby mechanics' });
  }
});

module.exports = router;
