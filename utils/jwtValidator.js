const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const logger = require('./logger');

/**
 * JWT Validator for Entra ID (Azure AD) authentication
 * Implements stateless Bearer token validation without sessions
 */

// JWKS client to fetch Entra ID public keys
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

/**
 * Get signing key from JWKS endpoint
 * @param {object} header - JWT header with kid (key ID)
 * @param {function} callback - Callback function
 */
function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      logger.error('Failed to get signing key:', err);
      return callback(err);
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Validate JWT token from Entra ID
 * @param {string} token - JWT Bearer token
 * @returns {Promise<object>} - Decoded token with user claims
 */
async function validateToken(token) {
  return new Promise((resolve, reject) => {
    // Verify token signature and claims
    const validAudiences = [
      process.env.AZURE_AD_CLIENT_ID,
      `api://${process.env.AZURE_AD_CLIENT_ID}`
    ];
    
    // Support both v1 and v2 token formats
    const validIssuers = [
      `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      `https://sts.windows.net/${process.env.AZURE_AD_TENANT_ID}/` // v1 endpoint
    ];
    
    jwt.verify(
      token,
      getKey,
      {
        audience: validAudiences,
        issuer: validIssuers,
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) {
          logger.warn('Token validation failed:', err.message);
          return reject(err);
        }

        // Extract user information from token claims
        const user = {
          id: decoded.oid || decoded.sub, // Object ID or subject
          email: decoded.email || decoded.preferred_username,
          name: decoded.name,
          tenantId: decoded.tid,
          roles: decoded.roles || [],
          groups: decoded.groups || [],
        };

        logger.info(`Token validated for user: ${user.email}`);
        resolve(user);
      }
    );
  });
}

/**
 * Extract Bearer token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} - JWT token or null
 */
function extractToken(authHeader) {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

module.exports = {
  validateToken,
  extractToken,
};
