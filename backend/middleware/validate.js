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
