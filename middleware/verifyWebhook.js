const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Middleware to verify GitHub webhook signature
 */
function verifyWebhook(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    logger.warn('Missing X-Hub-Signature-256 header');
    return res.status(401).json({ error: 'Missing signature header' });
  }

  const hmac = crypto.createHmac('sha256', config.webhook.secret);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');

  if (signature !== digest) {
    logger.warn('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = verifyWebhook;
