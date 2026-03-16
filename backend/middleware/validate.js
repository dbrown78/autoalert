const { z } = require('zod');

// ── Generic schema middleware factory ─────────────────────────────────────────

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid request', details: result.error.flatten() });
  }
  req.body = result.data;
  next();
};

// ── Schemas ───────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name:     z.string().min(2).max(100).trim(),
  email:    z.string().email().max(255).toLowerCase(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email:    z.string().email().max(255),
  password: z.string().min(1).max(128),
});

const vehicleSchema = z.object({
  make:    z.string().min(1).max(50).trim(),
  model:   z.string().min(1).max(50).trim(),
  year:    z.number().int().min(1900).max(new Date().getFullYear() + 1),
  trim:    z.string().max(50).trim().optional(),
  mileage: z.number().int().min(0).optional().nullable(),
  vin:     z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'VIN must be 17 valid characters').optional().nullable(),
});

const dtcLookupSchema = z.object({
  code:      z.string().regex(/^[A-Z][0-9]{4}$/, 'Invalid DTC format'),
  vehicleId: z.number().int().positive().optional(),
});

// ── Named middleware (backward-compatible with auth.js imports) ───────────────

const validateRegister = validate(registerSchema);
const validateLogin    = validate(loginSchema);
const validateVehicle  = validate(vehicleSchema);
const validateDtcLookup = validate(dtcLookupSchema);

module.exports = {
  validate,
  validateRegister,
  validateLogin,
  validateVehicle,
  validateDtcLookup,
  schemas: { registerSchema, loginSchema, vehicleSchema, dtcLookupSchema },
};
