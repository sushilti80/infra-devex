const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.app.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: process.env.DD_SERVICE || 'self-service-infra',
    env: process.env.DD_ENV || config.app.environment,
    version: process.env.DD_VERSION || require('../package.json').version
  },
  transports: [
    new winston.transports.Console()
  ]
});

/**
 * Emit a structured metric event with consistent field schema.
 * Fields: timestamp (ISO), level (defaults to info), event, correlation_id, duration_ms, plus any extras.
 * Example: logMetric('github_api_call', { operation, repo, duration_ms, success, correlationId })
 */
function logMetric(event, fields = {}) {
  const { correlationId, level = 'info', ...rest } = fields;
  logger.log(level, event, {
    event,
    correlation_id: correlationId || undefined,
    ...rest
  });
}

module.exports = logger;
module.exports.logMetric = logMetric;
