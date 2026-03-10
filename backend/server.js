const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Validate critical env vars at startup
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in .env');
  process.exit(1);
}

const app = express();

// Security headers
app.use(helmet());

// CORS — restrict to known origins
const allowedOrigins = [
  'http://localhost:8081',
  'http://localhost:3001',
  'exp://192.168.1.221:8081',
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Body parser with size limit
app.use(express.json({ limit: '10kb' }));

// Rate limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many auth attempts, please try again later' },
});

app.use(globalLimiter);
app.use('/api/auth', authLimiter);

const sensorRoutes = require('./routes/sensors');
const sensorBuffer = require('./sensorBuffer');
const mockStream   = require('./mockOBD2Stream');

// Start sensor buffer flush cycle
sensorBuffer.start();

// Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/vehicles',  require('./routes/vehicles'));
app.use('/api/dtc',       require('./routes/dtc'));
app.use('/api/mechanics', require('./routes/mechanics'));
app.use('/api/scans',     require('./routes/scans'));
app.use('/api/telemetry', require('./routes/telemetry'));
app.use('/api/foresight', require('./routes/foresight'));
app.use('/api/push',      require('./routes/push'));
app.use('/api/sensors',   sensorRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown
async function shutdown(signal) {
  console.log(`[server] ${signal} received — shutting down`);
  mockStream.stopAll();
  await sensorBuffer.stop();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
