'use strict';

/**
 * pushNotifications.js
 *
 * Expo Push Notification service for Foresight alerts.
 *
 * Expo Push API docs: https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Flow:
 *   1. App registers its Expo push token via PUT /api/push/token (routes/push.js)
 *   2. When foresight.js triggers a NEW alert, it calls sendForesightAlert()
 *   3. sendForesightAlert() fetches all tokens for the user, builds messages,
 *      and POSTs to the Expo Push API in chunks of ≤ 100
 *   4. Per-message tickets are checked — DeviceNotRegistered tokens are
 *      immediately deleted from device_push_tokens so future sends stay clean
 */

const pool = require('../config/db');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE    = 100; // Expo enforces max 100 messages per request

// Severity → notification presentation
const SEVERITY_CONFIG = {
  high:   { priority: 'high',   sound: 'default', channelId: 'foresight-high'   },
  medium: { priority: 'normal', sound: 'default', channelId: 'foresight-medium' },
  low:    { priority: 'normal', sound: null,       channelId: 'foresight-low'    },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split an array into chunks of at most `size` elements.
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * POST one chunk of messages to the Expo push endpoint.
 * Returns the array of per-message ticket objects.
 * Throws on network failure or non-2xx HTTP response.
 */
async function sendChunk(messages) {
  const res = await fetch(EXPO_PUSH_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Expo push API error ${res.status}: ${text}`);
  }

  const { data } = await res.json();
  return data; // array of tickets, one per message
}

/**
 * Delete tokens that Expo reports as no longer valid.
 * Called after each chunk send to keep the token table clean.
 *
 * @param {string[]} invalidTokens
 */
async function purgeInvalidTokens(invalidTokens) {
  if (invalidTokens.length === 0) return;
  await pool.query(
    `DELETE FROM device_push_tokens WHERE token = ANY($1::text[])`,
    [invalidTokens]
  );
  console.log(`[push] purged ${invalidTokens.length} invalid token(s): ${invalidTokens.join(', ')}`);
}

/**
 * Map severity to a notification title.
 */
function alertTitle(severity) {
  switch (severity) {
    case 'high':   return 'ODIN Foresight: Action Required';
    case 'medium': return 'ODIN Foresight: Warning Detected';
    default:       return 'ODIN Foresight: Notice';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send push notifications for a foresight alert to all of the user's devices.
 *
 * @param {number} userId  - The user whose devices should be notified
 * @param {Object} alert   - A foresight_alerts row (sensor, label, severity, detail, id)
 * @returns {Promise<void>}
 */
async function sendForesightAlert(userId, alert) {
  // Fetch all registered tokens for this user
  const { rows: tokenRows } = await pool.query(
    `SELECT token FROM device_push_tokens WHERE user_id = $1`,
    [userId]
  );

  if (tokenRows.length === 0) return; // user has no registered devices

  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.low;

  const messages = tokenRows.map(({ token }) => ({
    to:        token,
    title:     alertTitle(alert.severity),
    body:      alert.label,
    data: {
      alertId:  alert.id,
      sensor:   alert.sensor,
      severity: alert.severity,
      detail:   alert.detail,
    },
    sound:     cfg.sound,
    priority:  cfg.priority,
    channelId: cfg.channelId, // Android notification channel
  }));

  const chunks = chunk(messages, CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    let tickets;
    try {
      tickets = await sendChunk(chunks[i]);
    } catch (err) {
      // Log but don't throw — a push failure must never crash the analysis path
      console.error(`[push] chunk ${i + 1}/${chunks.length} failed:`, err.message);
      continue;
    }

    // Identify and purge tokens Expo says are invalid
    const invalid = [];
    tickets.forEach((ticket, idx) => {
      if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
      ) {
        invalid.push(chunks[i][idx].to);
      }
    });
    await purgeInvalidTokens(invalid);

    const ok = tickets.filter(t => t.status === 'ok').length;
    console.log(
      `[push] chunk ${i + 1}/${chunks.length}: ${ok} delivered, ` +
      `${tickets.length - ok - invalid.length} other errors, ${invalid.length} invalid tokens purged`
    );
  }
}

module.exports = { sendForesightAlert };
