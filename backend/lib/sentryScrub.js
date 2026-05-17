// Redacts PII from Sentry events before they leave the process.
// Covers: JWTs/tokens, emails, VINs, GPS coordinates, Authorization headers.
const VIN_RE    = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
const EMAIL_RE  = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const TOKEN_RE  = /\b(Bearer\s+)?[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\b/g;
const COORD_RE  = /\b-?\d{1,3}\.\d{4,}\b/g;

function redactString(s) {
  return s
    .replace(VIN_RE,   '[VIN]')
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(TOKEN_RE, '[TOKEN]')
    .replace(COORD_RE, '[COORD]');
}

function redactValue(v) {
  if (typeof v === 'string') return redactString(v);
  if (v && typeof v === 'object') return redactObj(v);
  return v;
}

function redactObj(obj) {
  if (Array.isArray(obj)) return obj.map(redactValue);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (['password', 'authorization', 'token', 'secret', 'refresh_token'].includes(lk)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactValue(v);
    }
  }
  return out;
}

function scrubPII(event) {
  try {
    if (event.request) {
      if (event.request.headers) event.request.headers = redactObj(event.request.headers);
      if (event.request.data)    event.request.data    = redactValue(event.request.data);
      if (event.request.url)     event.request.url     = redactString(event.request.url);
    }
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }
    if (event.extra) event.extra = redactObj(event.extra);
    if (event.contexts) event.contexts = redactObj(event.contexts);
  } catch {
    // Never let scrubbing crash — drop the event if something goes wrong
    return null;
  }
  return event;
}

module.exports = { scrubPII };
