require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');

const steps = [
  'migrate_base',
  'seed_dtc',
  'migrate_dtc_costs',
  'migrate_drive_safety',
  'seed_dtc_vehicle_overrides',
  'migrate_telemetry',
  'migrate_telemetry_extended',
  'migrate_foresight',
  'migrate_shop_trust',
  'seed_benchmarks',
  'migrate_push_tokens',
  'migrate_foresight_training',
];

for (const step of steps) {
  console.log(`\n--- ${step} ---`);
  const result = spawnSync(process.execPath, [path.join(__dirname, `${step}.js`)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\nFailed at step: ${step} (exit code ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nAll migrations and seeds complete.');
