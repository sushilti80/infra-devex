/**
 * API-level errors for the ship routes (spec §4.2). `ShipError` maps 1:1 onto the
 * `{ success:false, error:{ code, message, details?, hint? }, correlationId }` envelope.
 */
class ShipError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code  catalogue code (§4.2)
   * @param {string} message
   * @param {{ details?: object, hint?: string, retryAfterSec?: number }} [extra]
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'ShipError';
    this.status = status;
    this.code = code;
    this.details = extra.details;
    this.hint = extra.hint;
    this.retryAfterSec = extra.retryAfterSec;
  }
}

/** Translate a GitHub client error: rate limit → 429, outage/network → 503 (both PLATFORM_RATE_LIMITED), else UNKNOWN 500. */
function mapGithubError(error) {
  if (error instanceof ShipError) return error;
  const status = error && error.status;
  const headers = (error && error.response && error.response.headers) || {};
  const rateLimited = status === 429 || (status === 403 && (headers['x-ratelimit-remaining'] === '0' || /rate limit/i.test(error.message || '')));
  if (rateLimited) {
    const retryAfterSec = Number(headers['retry-after']) || 60;
    return new ShipError(429, 'PLATFORM_RATE_LIMITED', 'GitHub is rate limiting the platform. Try again shortly.', { details: { limit: 'github' }, retryAfterSec });
  }
  if (!status || status >= 500) {
    return new ShipError(503, 'PLATFORM_RATE_LIMITED', 'GitHub is temporarily unavailable. Try again shortly.', { details: { limit: 'github' }, retryAfterSec: 30 });
  }
  return new ShipError(500, 'UNKNOWN', 'Unexpected error.');
}

module.exports = { ShipError, mapGithubError };
