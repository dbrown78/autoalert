const pool = require('../config/db');

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------
// Cost accuracy:  0–40 pts  (how close final_cost is to ODIN benchmark)
// Fix success:    0–40 pts  (% of repairs that resolved the issue)
// Upsell penalty: 0–20 pts  (deducted based on upsell report rate)
//
// Total: 0–100. Tiers: Trusted ≥80 | Good ≥60 | Fair ≥40 | Flagged <40
// ---------------------------------------------------------------------------

const TIERS = [
  { min: 80, label: 'Trusted',  color: '#27ae60' },
  { min: 60, label: 'Good',     color: '#2ecc71' },
  { min: 40, label: 'Fair',     color: '#f39c12' },
  { min: 0,  label: 'Flagged',  color: '#e74c3c' },
];

function tier(score) {
  return TIERS.find(t => score >= t.min);
}

/**
 * Cost accuracy score (0–40).
 * Compared against the ODIN fair_cost_estimate for each DTC.
 * Outcomes without a benchmark or without a final_cost are skipped.
 */
function costAccuracyScore(outcomes, benchmarkMap) {
  const scoreable = outcomes.filter(
    o => o.final_cost != null && benchmarkMap[o.dtc_code]
  );
  if (scoreable.length === 0) return { score: 20, sampleSize: 0, detail: 'No cost data yet — defaulting to neutral.' };

  const ratios = scoreable.map(o => {
    const fair = parseFloat(benchmarkMap[o.dtc_code].fair_cost_estimate);
    return parseFloat(o.final_cost) / fair; // 1.0 = exactly fair
  });

  const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;

  let score;
  if      (avgRatio <= 1.10) score = 40; // within 10%
  else if (avgRatio <= 1.25) score = 32; // within 25%
  else if (avgRatio <= 1.50) score = 20; // within 50%
  else if (avgRatio <= 2.00) score = 8;  // up to 2×
  else                       score = 0;  // price gouging

  const pct = ((avgRatio - 1) * 100).toFixed(0);
  const sign = avgRatio >= 1 ? '+' : '';
  const detail = `Average charge is ${sign}${pct}% vs ODIN benchmark (${scoreable.length} repair${scoreable.length !== 1 ? 's' : ''} with cost data)`;

  return { score, sampleSize: scoreable.length, avgRatio, detail };
}

/**
 * Fix success score (0–40).
 */
function fixSuccessScore(outcomes) {
  if (outcomes.length === 0) return { score: 20, rate: null, detail: 'No outcomes yet — defaulting to neutral.' };

  const successes = outcomes.filter(o => o.fix_success).length;
  const rate = successes / outcomes.length;
  const score = Math.round(rate * 40);
  const detail = `${successes}/${outcomes.length} repairs resolved the issue (${Math.round(rate * 100)}% success rate)`;

  return { score, rate, detail };
}

/**
 * Upsell penalty (0–20 pts deducted).
 */
function upsellPenalty(outcomes) {
  if (outcomes.length === 0) return { penalty: 0, rate: null, detail: 'No upsell reports yet.' };

  const reported = outcomes.filter(o => o.upsells_reported).length;
  const rate = reported / outcomes.length;
  const penalty = Math.round(rate * 20);
  const detail = reported === 0
    ? 'No upsells reported.'
    : `${reported}/${outcomes.length} customers reported unnecessary upsells (${Math.round(rate * 100)}%)`;

  return { penalty, rate, detail };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate and return the trust score for a shop.
 * Returns null score components when there is insufficient data (< MIN_OUTCOMES).
 */
async function calculateTrustScore(shopId) {
  const MIN_OUTCOMES = 1; // require at least 1 outcome to show a real score

  const [outcomesResult, benchmarksResult] = await Promise.all([
    pool.query(
      `SELECT dtc_code, final_cost, quoted_cost, fix_success, upsells_reported, upsell_detail
       FROM shop_outcomes
       WHERE shop_id = $1
       ORDER BY created_at DESC`,
      [shopId]
    ),
    pool.query('SELECT dtc_code, fair_cost_estimate FROM repair_cost_benchmarks'),
  ]);

  const outcomes = outcomesResult.rows;
  const benchmarkMap = Object.fromEntries(
    benchmarksResult.rows.map(r => [r.dtc_code, r])
  );

  if (outcomes.length < MIN_OUTCOMES) {
    return {
      shop_id: shopId,
      score: null,
      tier: null,
      outcome_count: outcomes.length,
      message: 'Not enough data yet — be the first to submit an outcome for this shop.',
      components: null,
    };
  }

  const cost   = costAccuracyScore(outcomes, benchmarkMap);
  const fix    = fixSuccessScore(outcomes);
  const upsell = upsellPenalty(outcomes);

  const raw   = cost.score + fix.score - upsell.penalty;
  const score = Math.max(0, Math.min(100, raw));
  const t     = tier(score);

  return {
    shop_id: shopId,
    score,
    tier: t.label,
    tier_color: t.color,
    outcome_count: outcomes.length,
    components: {
      cost_accuracy: { score: cost.score,      max: 40, detail: cost.detail },
      fix_success:   { score: fix.score,       max: 40, detail: fix.detail },
      upsell:        { penalty: upsell.penalty, max: 20, detail: upsell.detail },
    },
  };
}

module.exports = { calculateTrustScore };
