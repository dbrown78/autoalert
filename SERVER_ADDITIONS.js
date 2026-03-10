// ─────────────────────────────────────────────────────────────────────────────
// ADD TO backend/server.js
// ─────────────────────────────────────────────────────────────────────────────
// 1. Import the sensor router near your other route imports:

const sensorRoutes = require('./routes/sensors');

// 2. Mount it alongside your existing routes (after your auth middleware setup):

app.use('/api/sensors', sensorRoutes);

// That's it. The mock stream and buffer start automatically when the route
// module loads. No other changes to server.js needed.

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN — add to your existing shutdown handler if you have one
// ─────────────────────────────────────────────────────────────────────────────

const mockStream   = require('./mockOBD2Stream');
const sensorBuffer = require('./sensorBuffer');

process.on('SIGTERM', async () => {
  console.log('[server] SIGTERM received, shutting down gracefully...');
  mockStream.stopAll();
  await sensorBuffer.flush(); // flush remaining readings before exit
  sensorBuffer.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  mockStream.stopAll();
  await sensorBuffer.flush();
  sensorBuffer.stop();
  process.exit(0);
});
