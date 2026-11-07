/**
 * Ship ID = RFC 9562 UUIDv7 (ship-from-repo spec DD-17, §3.5, §4.4, BT-26).
 * The first 48 bits are the mint time (ms), so a status lookup can derive a bounded
 * GitHub run-search window from the ID alone — no client hint, no storage.
 */
const { v7 } = require('uuid');

const SHIP_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const LOOKBACK_MS = 3 * 60 * 1000; // ASM-13: skew ≤ 2 min + ≤ 1 min dispatch/queue latency
const FUTURE_SKEW_MS = 2 * 60 * 1000; // ASM-13
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Explicit `msecs` keeps uuid's v7 stateless: no process-global monotonic state that could carry an ID's embedded
// timestamp ahead of the wall clock (the status lookup window and future-ID rejection both trust that timestamp).
function mintShipId() {
  return v7({ msecs: Date.now() });
}

function isShipId(value) {
  return typeof value === 'string' && SHIP_ID_REGEX.test(value);
}

/** Mint time (epoch ms) embedded in a UUIDv7; throws for anything that is not a v7 ship ID. */
function shipIdTimestamp(id) {
  if (!isShipId(id)) throw new Error('Not a UUIDv7 ship ID');
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

/**
 * 'invalid' (not a v7) | 'future' (> now + 2 min) | 'expired' (older than retention) | 'ok'.
 * 'future'/'expired' are answered 404 with no GitHub call.
 */
function classifyShipId(id, { now = Date.now(), retentionDays = 90 } = {}) {
  if (!isShipId(id)) return 'invalid';
  const t = shipIdTimestamp(id);
  if (t > now + FUTURE_SKEW_MS) return 'future';
  if (t < now - retentionDays * DAY_MS) return 'expired';
  return 'ok';
}

// GitHub's `created` search qualifier takes second precision; floor the lower bound and ceil the
// upper bound so the window can only widen, never lose a run.
const toIsoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Run-search window `[t − 3 min, min(now, t + retryWindowHours + 1 h)]` as a GitHub `created=` value.
 */
function runSearchWindow(id, { now = Date.now(), retryWindowHours = 24 } = {}) {
  const t = shipIdTimestamp(id);
  const fromMs = Math.floor((t - LOOKBACK_MS) / 1000) * 1000;
  const toMs = Math.ceil(Math.min(now, t + retryWindowHours * HOUR_MS + HOUR_MS) / 1000) * 1000;
  return { from: toIsoSeconds(fromMs), to: toIsoSeconds(toMs), created: `${toIsoSeconds(fromMs)}..${toIsoSeconds(toMs)}` };
}

module.exports = {
  SHIP_ID_REGEX,
  LOOKBACK_MS,
  FUTURE_SKEW_MS,
  mintShipId,
  isShipId,
  shipIdTimestamp,
  classifyShipId,
  runSearchWindow,
};
