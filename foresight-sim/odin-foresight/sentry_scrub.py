"""PII scrubbing for Sentry events from the Foresight service."""
import re

VIN_RE    = re.compile(r'\b[A-HJ-NPR-Z0-9]{17}\b', re.IGNORECASE)
EMAIL_RE  = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')
TOKEN_RE  = re.compile(r'\b(Bearer\s+)?[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\b')
COORD_RE  = re.compile(r'\b-?\d{1,3}\.\d{4,}\b')
REDACTED_KEYS = {'password', 'authorization', 'token', 'secret', 'refresh_token'}


def _redact_str(s: str) -> str:
    s = VIN_RE.sub('[VIN]', s)
    s = EMAIL_RE.sub('[EMAIL]', s)
    s = TOKEN_RE.sub('[TOKEN]', s)
    s = COORD_RE.sub('[COORD]', s)
    return s


def _redact_value(v):
    if isinstance(v, str):
        return _redact_str(v)
    if isinstance(v, dict):
        return _redact_dict(v)
    if isinstance(v, list):
        return [_redact_value(i) for i in v]
    return v


def _redact_dict(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        if k.lower() in REDACTED_KEYS:
            out[k] = '[REDACTED]'
        else:
            out[k] = _redact_value(v)
    return out


def scrub_pii(event, hint):
    try:
        if 'request' in event:
            req = event['request']
            if 'headers' in req:
                req['headers'] = _redact_dict(req['headers'])
            if 'data' in req:
                req['data'] = _redact_value(req['data'])
            if 'url' in req:
                req['url'] = _redact_str(req['url'])
        if 'user' in event:
            event['user'].pop('email', None)
            event['user'].pop('ip_address', None)
    except Exception:
        return None
    return event
