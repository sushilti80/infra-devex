const { validateToken, extractToken } = require('../utils/jwtValidator');
const logger = require('../utils/logger');

/**
 * Authentication Middleware for Entra ID
 * Implements stateless JWT Bearer token validation
 * No session storage required - validates token on each request
 */

/**
 * Require authentication middleware
 * Validates JWT token and adds user to request object
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Next middleware function
 */
async function requireAuth(req, res, next) {
  try {
    // Extract token from Authorization header
    const token = extractToken(req.headers.authorization);

    if (!token) {
      logger.warn(`[${req.correlationId}] No authentication token provided`);
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'No Bearer token provided in Authorization header',
        correlationId: req.correlationId,
      });
    }

    // Validate token and extract user claims
    const user = await validateToken(token);

    // Attach user to request object
    req.user = user;

    // Log authenticated request
    logger.info(`[${req.correlationId}] Authenticated request from: ${user.email}`);

    next();
  } catch (error) {
    logger.error(`[${req.correlationId}] Authentication failed: ${error.message}`);
    
    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: 'Invalid or expired token',
      correlationId: req.correlationId,
    });
  }
}

/**
 * Require specific role middleware
 * Checks if user has required role in token claims
 * 
 * @param {string} role - Required role name
 * @returns {function} - Express middleware function
 */
function requireRole(role) {
  return async (req, res, next) => {
    try {
      // First ensure user is authenticated
      if (!req.user) {
        logger.warn(`[${req.correlationId}] Role check attempted without authentication`);
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          correlationId: req.correlationId,
        });
      }

      // Check if user has required role
      const userRoles = req.user.roles || [];
      
      if (!userRoles.includes(role)) {
        logger.warn(`[${req.correlationId}] User ${req.user.email} lacks required role: ${role}`);
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          message: `Role '${role}' is required for this operation`,
          correlationId: req.correlationId,
        });
      }

      logger.info(`[${req.correlationId}] Role check passed for ${req.user.email}: ${role}`);
      next();
    } catch (error) {
      logger.error(`[${req.correlationId}] Role check error: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: 'Authorization error',
        correlationId: req.correlationId,
      });
    }
  };
}

/**
 * Optional authentication middleware
 * Attempts to authenticate but doesn't fail if no token provided
 * Useful for endpoints that work with or without authentication
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Next middleware function
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req.headers.authorization);

    if (token) {
      const user = await validateToken(token);
      req.user = user;
      logger.info(`[${req.correlationId}] Optional auth: Authenticated as ${user.email}`);
    } else {
      logger.debug(`[${req.correlationId}] Optional auth: No token provided, continuing as anonymous`);
    }

    next();
  } catch (error) {
    // Log but don't fail - continue as anonymous
    logger.debug(`[${req.correlationId}] Optional auth: Token validation failed, continuing as anonymous`);
    next();
  }
}

module.exports = {
  requireAuth,
  requireRole,
  optionalAuth,
};
