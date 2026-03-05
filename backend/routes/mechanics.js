const express = require('express');
const router = express.Router();

// GET /api/mechanics/nearby?lat=&lng=&radius=
// Proxies Google Places Nearby Search so the API key stays server-side.
router.get('/nearby', async (req, res) => {
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

    // Normalize to a flat shape the frontend can use directly
    const shops = (data.places || []).map(p => ({
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

    res.json({ shops });
  } catch (err) {
    console.error('mechanics/nearby error:', err);
    res.status(500).json({ message: 'Failed to fetch nearby mechanics' });
  }
});

module.exports = router;
