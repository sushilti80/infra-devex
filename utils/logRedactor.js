/**
 * Build-log redaction (ship-from-repo spec §7.3, BT-15). ANSI escapes are stripped first, then every
 * line is redacted independently so redaction is deterministic and offset-stable for append-only
 * logs. The one stateful case is a PEM private-key block, whose state depends only on earlier lines
 * of the same text (still append-stable).
 */
const REPLACEMENT = '***REDACTED***';

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g; // OSC body stops at ESC ⇒ linear

const PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PAT
  /\bAuthorization:\s*(?:Bearer|Basic|token)\s+\S+/gi, // auth headers
  /(?<=:\/\/)[^\s/@:]+:[^\s/@]+(?=@)/g, // URL userinfo user:pass@
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key ids
  /\bAccountKey=[^;\s]+/gi, // Azure storage account key
  /\bsig=[A-Za-z0-9%+/=_-]{8,}/g, // Azure SAS signature
  // JWT. The lookbehind lets a match start only at the beginning of a base64url run, so a hostile run of "eyJ-eyJ-…"
  // is scanned once, not once per "eyJ" (linear time; QA-002).
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /_authToken\s*=\s*\S+/gi, // npm
  // generic (§7.3, no leading boundary so GITHUB_TOKEN=/DB_PASSWORD= match). Widened beyond §7.3: an optional short
  // _SUFFIX (AWS_SECRET_ACCESS_KEY=), an optional quote (0–7 backslashes before it, QA-012) before the separator ("password":"…",
  // \"password\":\"…\" — JSON embedded in a JSON string) and a quoted value taken whole ("my secret value"). Characters glued
  // to the closing quote (shell concatenation, SQL-style doubled quote) belong to the same word and are taken too, but a
  // JSON/list delimiter ends it. The suffix is bounded {0,32} so a hostile "tokentoken…" stays linear.
  /(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)(?:[_-][A-Za-z0-9_-]{0,32})?(?:\\{0,7}["'])?\s*[:=]\s*(?:(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(\\{1,7})"(?:(?!\1")[^])*\1")(?:[^\s,;)}\]]\S*)?|\S+)/gi,
  /\b[A-Za-z0-9_]*_SECRET\s*=\s*\S+/g, // Wiz/other *_SECRET= env echoes
];

const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/;

function stripAnsi(text) {
  return String(text).replace(ANSI_REGEX, '');
}

function redactLine(line) {
  try {
    return PATTERNS.reduce((acc, re) => acc.replace(re, REPLACEMENT), line);
  } catch (error) {
    // A multi-megabyte single line can overflow V8's regexp backtrack stack (RangeError). Fail closed for THAT line only
    // (QA-009): the rest of the log stays readable and nothing unredacted is returned.
    if (error instanceof RangeError) return REPLACEMENT;
    throw error;
  }
}

/** Strip ANSI, then redact line by line (keeps line structure, so character offsets stay stable). */
function redactText(text) {
  let inPem = false;
  return stripAnsi(text)
    .split('\n')
    .map((line) => {
      if (inPem) {
        if (PEM_END.test(line)) inPem = false;
        return REPLACEMENT;
      }
      if (PEM_BEGIN.test(line)) {
        inPem = !PEM_END.test(line);
        return REPLACEMENT;
      }
      return redactLine(line);
    })
    .join('\n');
}

module.exports = { REPLACEMENT, PATTERNS, stripAnsi, redactLine, redactText };
