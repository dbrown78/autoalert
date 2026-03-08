# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
node server.js          # Start server (port 3001 or $PORT)
node migrate_all.js     # Run all migrations + seeds in order
node migrate_base.js    # Create users, vehicles, scan_history tables
node seed_dtc.js        # Seed dtc_codes table (idempotent)
```

No test suite is configured.

## Architecture

Express v5 API with PostgreSQL via `pg`. Entry point is `server.js`.

### Route map

| Mount | File | Auth |
|---|---|---|
| `/api/auth` | `routes/auth.js` | Public (register/login/me) |
| `/api/vehicles` | `routes/vehicles.js` | JWT required |
| `/api/dtc` | `routes/dtc.js` | Public |
| `/api/mechanics` | `routes/mechanics.js` | Mixed (GET / public, POST outcome JWT) |
| `/api/scans` | `routes/scans.js` | JWT required |
| `/api/telemetry` | `routes/telemetry.js` | JWT required |
| `/api/foresight` | `routes/foresight.js` | JWT required |

### Auth pattern

Each route file defines its own `authenticateToken` middleware (no shared middleware file). It validates `Authorization: Bearer <token>` and attaches `req.userId`.

### Services

- `services/trustScore.js` — ODIN Trust Score (0–100) for mechanic shops. Three components: cost accuracy (0–40), fix success (0–40), upsell penalty (0–20). Tiers: Trusted ≥80, Good ≥60, Fair ≥40, Flagged <40.
- `services/foresight.js` — Rule-based telemetry analysis. Evaluates 4 sensors (coolant_temp, voltage, fuel_trim, rpm) against thresholds; upserts/resolves `foresight_alerts` rows.

### Database

`config/db.js` creates a `pg.Pool`. Supports `DATABASE_URL` (Railway/production with SSL) or individual `DB_HOST/PORT/NAME/USER/PASSWORD` env vars.

Migration files are standalone scripts (not a migration framework). Run `node migrate_all.js` to apply everything in order:

```
migrate_base → seed_dtc → migrate_dtc_costs → migrate_drive_safety →
seed_dtc_vehicle_overrides → migrate_telemetry → migrate_foresight →
migrate_shop_trust → seed_benchmarks
```

### Key tables

```sql
users            -- id, name, email (unique), password (bcrypt)
vehicles         -- id, user_id, year, make, model, trim, mileage
scan_history     -- id, user_id, vehicle_id, dtc_code, scanned_at
dtc_codes        -- code (PK), short_description, description, possible_causes TEXT[],
                 --   symptoms TEXT[], severity, urgency, repairs JSONB, fair_cost_estimate
telemetry_logs   -- user_id, vehicle_id, logged_at, coolant_temp, rpm, voltage,
                 --   o2_sensor, fuel_trim, engine_load, intake_temp, raw_data
foresight_alerts -- user_id, vehicle_id, sensor, label, severity, detail, reading, resolved
shop_outcomes    -- user_id, shop_id, shop_name, dtc_code, quoted_cost, final_cost,
                 --   fix_success, upsells_reported, upsell_detail
repair_cost_benchmarks -- dtc_code, fair_cost_estimate (used by trust score)
```

### External dependencies

- `GOOGLE_PLACES_API_KEY` — used in `routes/mechanics.js` to proxy Google Places Nearby Search (keeps API key server-side). Searches for `car_repair` type, filters out dealerships/parts stores, returns top 8 shops.

## Environment

`.env` (not committed):
```
DATABASE_URL          # or individual DB_HOST/PORT/NAME/USER/PASSWORD
JWT_SECRET
PORT                  # default 3001
GOOGLE_PLACES_API_KEY
```
