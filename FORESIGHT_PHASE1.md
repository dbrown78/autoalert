# Rule-Based Foresight — Phase 1

Implement the missing Foresight backend pieces. Work inside `/Users/dadon/autoalert/backend/`.

---

## Context

- `services/sensorPreprocessor.js` — already complete. Exports `preprocessSensors(rows)` which returns a map of `sensor → { clean, rawCount, removed, warnings }`.
- `routes/foresight.js` — partially complete. Has `/:vehicle_id` and `/analyze` but the frontend calls `/foresight/health?vehicle_id=` and `/foresight/alerts?vehicle_id=`.
- `services/foresight.js` — does NOT exist yet. The route imports `analyzeVehicle` from it.
- DB tables: `telemetry_logs`, `foresight_alerts` (already migrated).

---

## Task 1 — Create `services/foresight.js`

Create `/Users/dadon/autoalert/backend/services/foresight.js`

### Rule definitions

Define these threshold rules as a flat array. Each rule has:
```js
{
  id: string,           // unique snake_case identifier
  sensor: string,       // matches SENSOR_CONFIG key in sensorPreprocessor
  sensor_label: string, // human-readable name for UI
  system: string,       // 'coolant' | 'battery' | 'oil' | 'brakes'
  severity: string,     // 'high' | 'medium' | 'low'
  rule_description: string, // plain English explanation shown in UI
  detect(values): bool, // returns true if alert should trigger
}
```

### Rules to implement

```
COOLANT SYSTEM:
- coolant_overheat_critical: coolant_temp, HIGH
  detect: any value in last 10 readings > 105°C
  description: "Coolant temperature critically high — engine at risk of overheating"

- coolant_overheat_warning: coolant_temp, MEDIUM
  detect: rolling average of last 10 readings > 95°C
  description: "Coolant running hotter than normal — monitor closely"

- coolant_pressure_high: coolant_pressure, MEDIUM
  detect: any value > 2.0 bar
  description: "Coolant pressure elevated — possible blockage or failing cap"

BATTERY / CHARGING:
- voltage_critical_low: voltage, HIGH
  detect: any value < 11.5V
  description: "Battery voltage critically low — possible charging system failure"

- voltage_low: voltage, MEDIUM
  detect: rolling average < 12.4V
  description: "Battery voltage below optimal — check charging system"

- voltage_high: voltage, LOW
  detect: any value > 15.0V
  description: "Battery voltage elevated — possible overcharging"

OIL SYSTEM:
- oil_pressure_critical: oil_pressure, HIGH
  detect: any value < 0.5 bar
  description: "Oil pressure critically low — stop engine immediately"

- oil_pressure_low: oil_pressure, MEDIUM
  detect: rolling average < 1.0 bar
  description: "Oil pressure below normal range — check oil level"

GENERAL ENGINE:
- rpm_excessive: rpm, MEDIUM
  detect: rolling average of last 5 readings > 4500 RPM
  description: "Engine running at high RPM consistently — check for issues"

- engine_load_high: engine_load, LOW
  detect: rolling average > 85%
  description: "Engine load consistently high — may indicate strain"

- fuel_trim_rich: fuel_trim, LOW
  detect: rolling average > 25%
  description: "Fuel trim running rich — possible sensor or injector issue"

- fuel_trim_lean: fuel_trim, LOW
  detect: rolling average < -25%
  description: "Fuel trim running lean — possible vacuum leak or MAF issue"
```

### `analyzeVehicle(userId, vehicleId)` function

```js
async function analyzeVehicle(userId, vehicleId) {
  // 1. Fetch last 50 telemetry rows for this vehicle, newest-first
  // 2. Pass to preprocessSensors(rows) to get clean values per sensor
  // 3. Run each rule's detect(values) against the clean values for its sensor
  // 4. For each triggered rule: UPSERT into foresight_alerts
  //    - ON CONFLICT (user_id, vehicle_id, rule_id): update severity, detail, reading, updated_at, resolved=false
  //    - reading = latest clean value for that sensor (clean[0] ?? null)
  // 5. For each NOT triggered rule: UPDATE foresight_alerts SET resolved=true
  //    WHERE user_id=$1 AND vehicle_id=$2 AND rule_id=$3 AND resolved=false
  // 6. Return all currently active (unresolved) alerts for this vehicle
}
```

### `getHealthScores(userId, vehicleId)` function

Returns health scores for 4 systems: coolant, battery, oil, brakes.

Health score per system = 1.0 minus the worst active alert penalty:
- No active alerts for that system → 1.0 (100%)
- LOW severity alert active → 0.75
- MEDIUM severity alert active → 0.5
- HIGH severity alert active → 0.2

```js
async function getHealthScores(userId, vehicleId) {
  // Query active foresight_alerts for this vehicle
  // Group by system
  // Compute health score per system
  // Return { coolant, battery, oil, brakes }
}
```

---

## Task 2 — Update `routes/foresight.js`

The frontend calls:
- `GET /api/foresight/health?vehicle_id=X` 
- `GET /api/foresight/alerts?vehicle_id=X`

Add these two endpoints. Keep the existing `/:vehicle_id` and `/analyze` routes.

### GET /api/foresight/health

```js
router.get('/health', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.query.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'vehicle_id is required' });
  // Call getHealthScores(req.userId, vehicleId)
  // Return { health: { coolant, battery, oil, brakes } }
});
```

### GET /api/foresight/alerts

```js
router.get('/alerts', authenticateToken, async (req, res) => {
  const vehicleId = parseInt(req.query.vehicle_id, 10);
  if (isNaN(vehicleId)) return res.status(400).json({ message: 'vehicle_id is required' });
  // Query foresight_alerts WHERE user_id, vehicle_id, resolved=false
  // Order by severity (high first), then updated_at DESC
  // Return { alerts: rows }
});
```

**IMPORTANT**: These two new routes (`/health` and `/alerts`) must be registered BEFORE the `/:vehicle_id` route in the file, otherwise Express will match `health` and `alerts` as vehicle_id parameters.

---

## Task 3 — DB migration for `rule_id` column

The UPSERT in analyzeVehicle needs `ON CONFLICT (user_id, vehicle_id, rule_id)`.

Check if `foresight_alerts` already has a `rule_id` column:
```bash
cd /Users/dadon/autoalert/backend
node -e "const pool = require('./config/db'); pool.query('SELECT column_name FROM information_schema.columns WHERE table_name = \\'foresight_alerts\\'').then(r => { console.log(r.rows); pool.end(); })"
```

If `rule_id` is missing, add it:
```sql
ALTER TABLE foresight_alerts ADD COLUMN IF NOT EXISTS rule_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_foresight_alerts_unique 
  ON foresight_alerts(user_id, vehicle_id, rule_id) 
  WHERE resolved = FALSE;
```

Run this directly via node, similar to the check above.

---

## Task 4 — Seed test telemetry data

So the Foresight screen has data to display in the simulator, seed one high-severity alert:

```js
// Insert a test telemetry row with a high coolant temp to trigger the rule
// Only if telemetry_logs has a vehicle belonging to the test user
// Use: INSERT INTO telemetry_logs (user_id, vehicle_id, coolant_temp, voltage, rpm, engine_load)
//      SELECT user_id, id, 108, 12.6, 1200, 45 FROM vehicles LIMIT 1
//      ON CONFLICT DO NOTHING
```

Then call `analyzeVehicle` for that vehicle to generate the alert.

---

## Verification

```bash
cd /Users/dadon/autoalert/backend
node server.js
```

Test endpoints manually:
```bash
# Get a JWT first by hitting /api/auth/login, then:
curl "http://localhost:3001/api/foresight/health?vehicle_id=1" -H "Authorization: Bearer <token>"
curl "http://localhost:3001/api/foresight/alerts?vehicle_id=1" -H "Authorization: Bearer <token>"
```

Both should return valid JSON. Server should start with no errors.

---

## Done

All 4 tasks complete when:
- [ ] `services/foresight.js` exists with `analyzeVehicle` and `getHealthScores`
- [ ] `/api/foresight/health` and `/api/foresight/alerts` endpoints respond correctly
- [ ] `/health` and `/alerts` routes registered before `/:vehicle_id`
- [ ] `rule_id` column exists on `foresight_alerts`
- [ ] Server starts cleanly
