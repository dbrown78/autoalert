require('dotenv').config();
const pool = require('./config/db');

async function seed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dtc_vehicle_overrides (
      id                    SERIAL PRIMARY KEY,
      dtc_code              VARCHAR(10) NOT NULL REFERENCES dtc_codes(code),
      make                  VARCHAR(50) NOT NULL,
      model                 VARCHAR(50),
      year_min              INTEGER,
      year_max              INTEGER,
      possible_causes       TEXT[],
      symptoms              TEXT[],
      oem_cost_min          INTEGER,
      oem_cost_max          INTEGER,
      aftermarket_cost_min  INTEGER,
      aftermarket_cost_max  INTEGER,
      labor_hours_min       NUMERIC(4,1),
      labor_hours_max       NUMERIC(4,1),
      diy_difficulty        VARCHAR(10) CHECK (diy_difficulty IN ('easy', 'moderate', 'hard')),
      notes                 TEXT
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dtc_vehicle_overrides_lookup
      ON dtc_vehicle_overrides (dtc_code, LOWER(make))
  `);
  console.log('Table ready');

  // Truncate so the seed is idempotent
  await pool.query('TRUNCATE TABLE dtc_vehicle_overrides RESTART IDENTITY');

  const overrides = [
    // 1. P0420 — Toyota (2000-2015)
    // Toyota OEM cats are uniquely expensive; aftermarket varies widely by brand.
    {
      dtc_code: 'P0420', make: 'Toyota', model: null, year_min: 2000, year_max: 2015,
      possible_causes: [
        'Worn OEM catalytic converter (Toyota cats degrade slowly but are costly to replace)',
        'Faulty upstream or downstream O2 sensor',
        'Exhaust manifold leak before the converter',
        'Oil consumption contaminating the catalyst',
      ],
      symptoms: null,
      oem_cost_min: 1200, oem_cost_max: 2500,
      aftermarket_cost_min: 300, aftermarket_cost_max: 900,
      labor_hours_min: 1.5, labor_hours_max: 3.0,
      diy_difficulty: 'moderate',
      notes: 'Toyota OEM catalytic converters carry a significant price premium. High-quality direct-fit aftermarket units (MagnaFlow, Walker) are a popular alternative at roughly 25–40% of OEM cost. Verify O2 sensors before replacing the converter — a faulty sensor can set this code even with a healthy cat.',
    },

    // 2. P0171 — Ford F-150 (2004-2014, 5.4L / 4.6L)
    // Lower intake manifold gasket leak is the classic cause on these engines.
    {
      dtc_code: 'P0171', make: 'Ford', model: 'F-150', year_min: 2004, year_max: 2014,
      possible_causes: [
        'Lower intake manifold gasket leak at EGR port (very common on 5.4L 3V)',
        'Cracked or disconnected PCV hose',
        'Dirty or failing mass airflow sensor',
        'Weak fuel pressure from aging pump',
      ],
      symptoms: [
        'Check engine light on',
        'Rough idle especially when cold',
        'Hesitation on acceleration',
        'Hissing sound at idle (vacuum/intake leak)',
        'Reduced fuel economy',
      ],
      oem_cost_min: 250, oem_cost_max: 700,
      aftermarket_cost_min: 100, aftermarket_cost_max: 350,
      labor_hours_min: 2.0, labor_hours_max: 5.0,
      diy_difficulty: 'moderate',
      notes: 'The Ford 5.4L 3V engine has a well-documented intake manifold gasket failure at the EGR crossover port. A smoke test will confirm the leak. The intake manifold gasket set costs $40–$80 in parts; labor is substantial because the upper intake must be removed. Check and clean the MAF sensor first as a free diagnostic step.',
    },

    // 3. P0300 — Chevrolet / GMC V8 (2007-2014, AFM/DOD engines)
    // Active Fuel Management lifter collapse is a known, expensive failure.
    {
      dtc_code: 'P0300', make: 'Chevrolet', model: null, year_min: 2007, year_max: 2014,
      possible_causes: [
        'AFM/DOD lifter collapse (collapsing lifter on cylinder-deactivation bank)',
        'AFM camshaft lobe wear from lifter failure',
        'Oil pressure issues caused by failed lifter blocking oil passage',
        'Worn spark plugs or ignition coils (rule out first)',
      ],
      symptoms: [
        'Rough idle or shaking',
        'Ticking or knocking noise from valvetrain',
        'Check engine light on or flashing',
        'Loss of power, especially under load',
        'Oil consumption above normal',
      ],
      oem_cost_min: 2500, oem_cost_max: 6000,
      aftermarket_cost_min: 1500, aftermarket_cost_max: 4000,
      labor_hours_min: 8.0, labor_hours_max: 20.0,
      diy_difficulty: 'hard',
      notes: 'GM 5.3L and 6.0L AFM (Active Fuel Management) engines produced 2007–2014 have a well-known lifter collapse failure. The fix typically involves replacing all 16 AFM lifters, the camshaft, and disabling AFM with a delete kit and tune. Many owners proactively disable AFM before failure. This is a major engine-out job — plan for 10–20 shop hours.',
    },

    // 4. P0442 — Honda (any model, any year)
    // Honda gas caps and EVAP purge solenoids are common culprits.
    {
      dtc_code: 'P0442', make: 'Honda', model: null, year_min: null, year_max: null,
      possible_causes: [
        'OEM Honda gas cap seal has hardened or cracked (very common)',
        'Faulty EVAP purge solenoid (common on Civics and Accords)',
        'Cracked EVAP line near the fuel tank',
        'Loose gas cap (tighten and clear — code may not return)',
      ],
      symptoms: null,
      oem_cost_min: 15, oem_cost_max: 200,
      aftermarket_cost_min: 10, aftermarket_cost_max: 80,
      labor_hours_min: 0.25, labor_hours_max: 1.5,
      diy_difficulty: 'easy',
      notes: 'Honda EVAP systems frequently trigger P0442 from a worn gas cap seal — Honda OEM caps are known to fail after 5–7 years. Try an OEM Honda gas cap ($25–$40) before any other repair. If the code returns, the purge solenoid (located on the intake manifold) is the next most likely cause and is a straightforward DIY replacement.',
    },

    // 5. P0128 — BMW (any model, any year)
    // BMW electronic (map-controlled) thermostats fail more often and cost more.
    {
      dtc_code: 'P0128', make: 'BMW', model: null, year_min: null, year_max: null,
      possible_causes: [
        'Failed electronic (map-controlled) thermostat — BMW-specific failure',
        'Faulty coolant temperature sensor (CTS)',
        'Coolant level low causing slow warm-up',
        'Thermostat housing coolant leak',
      ],
      symptoms: [
        'Temperature gauge stays below normal operating range',
        'Heater output poor in cold weather',
        'Increased fuel consumption',
        'Check engine light on',
        'Plastic thermostat housing may show visible cracks or leaks',
      ],
      oem_cost_min: 350, oem_cost_max: 800,
      aftermarket_cost_min: 150, aftermarket_cost_max: 450,
      labor_hours_min: 1.0, labor_hours_max: 2.5,
      diy_difficulty: 'moderate',
      notes: "BMW uses an electronically map-controlled thermostat rather than a traditional wax-element unit. When it fails it typically sticks open, causing under-temperature codes. OEM Mahle or Wahler thermostats are recommended — cheap aftermarket units tend to fail quickly. The thermostat is often sold as a complete housing assembly. Burping the coolant system properly after replacement is critical.",
    },

    // 6. P0420 — Subaru (2000-2010, EJ-series engines)
    // Head gasket coolant leak kills the catalytic converter.
    {
      dtc_code: 'P0420', make: 'Subaru', model: null, year_min: 2000, year_max: 2010,
      possible_causes: [
        'Head gasket failure allowing coolant into exhaust, poisoning the catalyst',
        'Worn catalytic converter from years of coolant contamination',
        'Faulty downstream O2 sensor misreporting converter efficiency',
        'Exhaust leak upstream of the converter',
      ],
      symptoms: [
        'Check engine light on',
        'White or sweet-smelling exhaust (coolant burning)',
        'Coolant loss without visible external leaks',
        'Rough idle or overheating if head gasket is severe',
        'May fail emissions test',
      ],
      oem_cost_min: 900, oem_cost_max: 2000,
      aftermarket_cost_min: 300, aftermarket_cost_max: 800,
      labor_hours_min: 2.0, labor_hours_max: 4.0,
      diy_difficulty: 'moderate',
      notes: "Subaru SOHC EJ engines (EJ22, EJ25) produced 2000–2010 have a well-documented head gasket failure that allows coolant to enter the exhaust and poison the catalytic converter. Always diagnose and address a potential head gasket issue before replacing the catalytic converter — a new cat will fail again quickly if the root cause isn't fixed. A combustion leak test (Block Check test) can confirm coolant-in-exhaust without tearing down the engine.",
    },

    // 7. P0301 — Volkswagen (2006-2013, 2.0T TSI direct injection)
    // Carbon buildup on intake valves causes single-cylinder misfires.
    {
      dtc_code: 'P0301', make: 'Volkswagen', model: null, year_min: 2006, year_max: 2013,
      possible_causes: [
        'Carbon buildup on intake valves (direct injection has no port wash)',
        'Faulty ignition coil (N70 coil packs are a known weak point)',
        'Failing high-pressure fuel injector',
        'Stretched timing chain or tensioner failure',
      ],
      symptoms: [
        'Rough idle and shaking, especially when cold',
        'Check engine light on or flashing',
        'Loss of power, hesitation under load',
        'Hard cold start',
      ],
      oem_cost_min: 300, oem_cost_max: 1200,
      aftermarket_cost_min: 200, aftermarket_cost_max: 700,
      labor_hours_min: 2.0, labor_hours_max: 8.0,
      diy_difficulty: 'hard',
      notes: "VW 2.0T TSI engines use direct injection, which means fuel never washes the intake valves. Carbon deposits build up over 60–80k miles and restrict airflow to individual cylinders, causing misfires. The fix is walnut blasting or manual scraping of the intake ports — a labor-intensive job (3–6 hrs). Ignition coils (especially the Hella-Gutmann N70 pack) are also a common and cheaper cause to rule out first.",
    },

    // 8. P0340 — Nissan (2002-2008, QR25DE / VQ35DE)
    // Cam position sensor is a very common failure on these engines.
    {
      dtc_code: 'P0340', make: 'Nissan', model: null, year_min: 2002, year_max: 2008,
      possible_causes: [
        'Faulty camshaft position sensor (high failure rate on QR25DE/VQ35DE)',
        'Damaged or corroded sensor wiring harness connector',
        'Timing chain stretch causing erratic cam signal',
        'Worn reluctor ring on camshaft',
      ],
      symptoms: null,
      oem_cost_min: 60, oem_cost_max: 250,
      aftermarket_cost_min: 20, aftermarket_cost_max: 80,
      labor_hours_min: 0.5, labor_hours_max: 1.0,
      diy_difficulty: 'easy',
      notes: "The Nissan QR25DE (Altima, Sentra) and VQ35DE (350Z, Maxima) engines from this era have a high cam sensor failure rate. The sensor is inexpensive and accessible on most models — typically a 30-minute DIY repair. Inspect the connector for oil contamination or corrosion before condemning the sensor itself. If the code returns after sensor replacement, inspect for timing chain slack.",
    },

    // 9. P0401 — Toyota Tacoma (1995-2004, 3.4L 5VZ-FE)
    // EGR passage carbon clogging is endemic to this engine.
    {
      dtc_code: 'P0401', make: 'Toyota', model: 'Tacoma', year_min: 1995, year_max: 2004,
      possible_causes: [
        'Carbon-clogged EGR passages in the intake manifold (endemic to 5VZ-FE)',
        'Stuck-closed EGR valve from carbon deposits',
        'Faulty EGR vacuum modulator',
        'Blocked EGR temperature sensor port',
      ],
      symptoms: [
        'Check engine light on',
        'Engine ping or knock under load',
        'Rough idle',
        'Failed emissions test',
      ],
      oem_cost_min: 80, oem_cost_max: 400,
      aftermarket_cost_min: 40, aftermarket_cost_max: 200,
      labor_hours_min: 2.0, labor_hours_max: 5.0,
      diy_difficulty: 'moderate',
      notes: "Toyota 3.4L V6 (5VZ-FE) Tacomas and 4Runners are notorious for EGR passage clogging. Carbon accumulates in the cast passages inside the intake manifold and the EGR pipe. The fix involves removing the upper intake and using a pick and carb cleaner to clean the passages — no parts needed in many cases. This is a well-documented DIY job on Tacoma forums with step-by-step guides available.",
    },

    // 10. P0171 — Chevrolet Colorado / GMC Canyon (2004-2012, 3.5L / 3.7L)
    // Intake manifold gasket failure is the primary cause on the inline-5.
    {
      dtc_code: 'P0171', make: 'Chevrolet', model: 'Colorado', year_min: 2004, year_max: 2012,
      possible_causes: [
        'Intake manifold gasket leak (primary cause on 3.5L/3.7L inline-5)',
        'Cracked or collapsed lower intake air boot',
        'Dirty or failing MAF sensor',
        'PCV system failure causing lean condition',
      ],
      symptoms: [
        'Check engine light on',
        'Rough or lopey idle',
        'Hesitation under acceleration',
        'Hissing or whistle at idle',
        'Reduced power and fuel economy',
      ],
      oem_cost_min: 150, oem_cost_max: 500,
      aftermarket_cost_min: 60, aftermarket_cost_max: 250,
      labor_hours_min: 2.0, labor_hours_max: 4.0,
      diy_difficulty: 'moderate',
      notes: "The 3.5L and 3.7L inline-5 engines in the Chevrolet Colorado and GMC Canyon have a known intake manifold gasket failure pattern, especially after 80k miles. The gasket tends to fail at the rear of the manifold. A smoke test confirms the leak quickly. The intake manifold gasket set is inexpensive ($30–$60); labor is the main cost. Clean the throttle body while the intake is off.",
    },
  ];

  for (const o of overrides) {
    await pool.query(
      `INSERT INTO dtc_vehicle_overrides
         (dtc_code, make, model, year_min, year_max,
          possible_causes, symptoms,
          oem_cost_min, oem_cost_max, aftermarket_cost_min, aftermarket_cost_max,
          labor_hours_min, labor_hours_max, diy_difficulty, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        o.dtc_code, o.make, o.model, o.year_min, o.year_max,
        o.possible_causes, o.symptoms,
        o.oem_cost_min, o.oem_cost_max, o.aftermarket_cost_min, o.aftermarket_cost_max,
        o.labor_hours_min, o.labor_hours_max, o.diy_difficulty, o.notes,
      ]
    );
    const label = o.model ? `${o.make} ${o.model}` : o.make;
    console.log(`  seeded ${o.dtc_code} / ${label}`);
  }

  console.log(`Done — ${overrides.length} vehicle overrides seeded.`);
  await pool.end();
}

seed().catch(err => { console.error(err); process.exit(1); });
