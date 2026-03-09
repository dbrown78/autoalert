# Backend Hardening Task

Run all steps in order. Work inside `/Users/dadon/autoalert/backend/`.

---

## Step 1 — Install new dependencies

```bash
cd /Users/dadon/autoalert/backend
npm install helmet express-rate-limit
```

---

## Step 2 — Create middleware directory and files

### Create `/Users/dadon/autoalert/backend/middleware/auth.js`

```js
const jwt = require('jsonwebtoken');

module.exports = function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};
```

### Create `/Users/dadon/autoalert/backend/middleware/validate.js`

```js
function validateRegister(req, res, next) {
  const { name, email, password } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length < 2)
    return res.status(400).json({ message: 'Name must be at least 2 characters' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email))
    return res.status(400).json({ message: 'Valid email is required' });

  if (!password || password.length < 8)
    return res.status(400).json({ message: 'Password must be at least 8 characters' });

  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: 'Email and password are required' });

  next();
}

module.exports = { validateRegister, validateLogin };
```

---

## Step 3 — Replace server.js

Overwrite `/Users/dadon/autoalert/backend/server.js` with:

```js
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

// Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/vehicles',  require('./routes/vehicles'));
app.use('/api/dtc',       require('./routes/dtc'));
app.use('/api/mechanics', require('./routes/mechanics'));
app.use('/api/scans',     require('./routes/scans'));
app.use('/api/telemetry', require('./routes/telemetry'));
app.use('/api/foresight', require('./routes/foresight'));
app.use('/api/push',      require('./routes/push'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

---

## Step 4 — Replace routes/auth.js

Overwrite `/Users/dadon/autoalert/backend/routes/auth.js` with:

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validate');

const router = express.Router();

router.post('/register', validateRegister, async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0)
      return res.status(400).json({ message: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name.trim(), email.toLowerCase(), hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', validateLogin, async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0)
      return res.status(400).json({ message: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user.id, name: user.name, email: user.email }, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
```

---

## Step 5 — Update all other route files

For each of these files:
- `routes/vehicles.js`
- `routes/scans.js`
- `routes/dtc.js`
- `routes/mechanics.js`
- `routes/telemetry.js`
- `routes/foresight.js`
- `routes/push.js`

Do the following:
1. Remove the local `authenticateToken` function definition (the `const authenticateToken = (req, res, next) => { ... }` block) if it exists
2. Add this line near the top with the other requires:
   ```js
   const authenticateToken = require('../middleware/auth');
   ```

---

## Step 6 — Verify

```bash
cd /Users/dadon/autoalert/backend
node server.js
```

Server should start with no errors. If JWT_SECRET is missing from .env, it will exit with a clear FATAL message. Fix by ensuring .env has:

```
JWT_SECRET=your_secret_here
```

---

## Done
All hardening changes applied. Restart the backend and confirm `GET /api/health` returns `{"status":"ok"}`.
