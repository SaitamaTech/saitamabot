const SENSITIVE_KEYS = /pairing.?code|password|token|secret|auth|credential|cookie/i;

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : scrub(item)]));
  }
  if (typeof value === 'string') return value.replace(/\b\d{8}\b/g, '[REDACTED]');
  return value;
}

export const logger = {
  info(message, details = {}) { console.info(JSON.stringify({ level: 'info', time: new Date().toISOString(), message, ...scrub(details) })); },
  warn(message, details = {}) { console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), message, ...scrub(details) })); },
  error(message, details = {}) { console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), message, ...scrub(details) })); },
};
