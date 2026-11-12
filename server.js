require('dotenv').config();

// Datadog APM tracer — must be initialised before any other require.
// dotenv is loaded first so DD_* variables from .env are available.
// Wrapped in try/catch so a missing optional native dep never crashes startup.
//
// Transport priority:
//   1. Unix Domain Socket at DD_TRACE_AGENT_URL (or /var/run/datadog/apm.socket)
//      — preferred in AKS where the Datadog Agent DaemonSet exposes a hostPath socket.
//   2. TCP fallback to DD_AGENT_HOST:DD_AGENT_PORT (default localhost:8126)
//      — used in local dev or environments without UDS.
if (process.env.DD_TRACE_ENABLED !== 'false') {
  try {
    const fs = require('fs');
    const udsPath = '/var/run/datadog/apm.socket';
    const traceOpts = {
      service: process.env.DD_SERVICE || 'self-service-infra',
      env: process.env.DD_ENV || process.env.NODE_ENV || 'development',
      version: process.env.DD_VERSION || require('./package.json').version,
      logInjection: true,
      runtimeMetrics: true,
    };

    // Prefer UDS if the socket file exists (AKS with Datadog Agent DaemonSet).
    if (process.env.DD_TRACE_AGENT_URL) {
      traceOpts.url = process.env.DD_TRACE_AGENT_URL;
    } else if (fs.existsSync(udsPath)) {
      traceOpts.url = `unix://${udsPath}`;
    } else {
      // TCP fallback for local dev / non-AKS environments.
      traceOpts.hostname = process.env.DD_AGENT_HOST || 'localhost';
      traceOpts.port = process.env.DD_AGENT_PORT || 8126;
    }

    require('dd-trace').init(traceOpts);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Datadog tracing failed to initialise, continuing without APM:', err && err.message ? err.message : err);
  }
}

const config = require('./config');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Import routes
const apiRoutes = require('./routes/api');
const logger = require('./utils/logger');

// Import authentication middleware (optional - enable when ready)
// const { requireAuth, optionalAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// CORS configuration - allow Authorization header for JWT tokens
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Log Entra ID configuration at startup (for debugging)
console.log('=== Entra ID Configuration ===');
console.log('VITE_ENTRA_CLIENT_ID:', process.env.VITE_ENTRA_CLIENT_ID ? `${process.env.VITE_ENTRA_CLIENT_ID.substring(0, 8)}...` : 'NOT SET');
console.log('VITE_ENTRA_TENANT_ID:', process.env.VITE_ENTRA_TENANT_ID ? `${process.env.VITE_ENTRA_TENANT_ID.substring(0, 8)}...` : 'NOT SET');
console.log('VITE_ENTRA_AUTHORITY:', process.env.VITE_ENTRA_AUTHORITY || 'NOT SET');
console.log('AZURE_AD_CLIENT_ID (fallback):', process.env.AZURE_AD_CLIENT_ID ? `${process.env.AZURE_AD_CLIENT_ID.substring(0, 8)}...` : 'NOT SET');
console.log('AZURE_AD_TENANT_ID (fallback):', process.env.AZURE_AD_TENANT_ID ? `${process.env.AZURE_AD_TENANT_ID.substring(0, 8)}...` : 'NOT SET');
console.log('==============================');

// Add correlation ID to each request
app.use((req, res, next) => {
  req.correlationId = uuidv4();
  next();
});

// Normalise a raw path to a low-cardinality route template for aggregation.
// Prefers the Express matched route template; falls back to replacing dynamic
// segments (UUIDs, correlation IDs like cid-…, and bare numeric IDs) with
// typed placeholders so log aggregators can group requests correctly.
function normalizeRoutePath(req) {
  if (req.route && req.route.path) {
    return (req.baseUrl || '') + req.route.path;
  }
  return req.path
    .replace(/\/cid-[a-z0-9-]+/gi, '/:correlationId')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d+/g, '/:id');
}

// Request lifecycle metrics — logs method, route template, status, duration after each response
app.use((req, res, next) => {
  const startMs = Date.now();
  res.on('finish', () => {
    const duration_ms = Date.now() - startMs;
    const event = res.statusCode >= 500 ? 'http_request_error'
      : res.statusCode >= 400 ? 'http_request_client_error'
      : 'http_request_completed';
    logger.info(event, {
      event,
      method: req.method,
      path: normalizeRoutePath(req),
      status_code: res.statusCode,
      duration_ms,
      correlation_id: req.correlationId
    });
  });
  next();
});

// Serve Vue.js build artifacts (legacy public/ removed)
const staticDir = path.join(__dirname, 'dist');
app.use(express.static(staticDir));

// Health check endpoint for Docker and Kubernetes probes
app.get('/health', async (req, res) => {
  const fs = require('fs');
  const githubService = require('./services/githubService');

  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: {
      app: require('./package.json').version,
      container: fs.existsSync(path.join(__dirname, 'VERSION'))
        ? fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim()
        : 'unknown',
      node: process.version
    },
    services: {
      github: {
        status: 'unknown',
        initialized: false
      }
    }
  };

  // Check GitHub connectivity (non-blocking)
  try {
    if (githubService.initialized && githubService.octokit) {
      if (config.github.personalAccessToken) {
        await githubService.octokit.rest.users.getAuthenticated();
      } else {
        await githubService.octokit.rest.apps.getAuthenticated();
      }
      healthData.services.github.status = 'connected';
      healthData.services.github.initialized = true;
    } else {
      healthData.services.github.status = 'not_initialized';
    }
  } catch (error) {
    healthData.services.github.status = 'error';
    healthData.services.github.error = error.message;
  }

  res.status(200).json(healthData);
});

// API routes
app.use('/api', apiRoutes);

// Add 404 handler for non-existent API routes (must be after API routes, before SPA catch-all)
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.path,
    correlationId: req.correlationId
  });
});

// Runtime configuration endpoint for Entra ID
// Injects environment variables at runtime (works with FluxCD/Kustomize ConfigMaps)
app.get('/config.js', (req, res) => {
  const clientId = process.env.VITE_ENTRA_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID || '';
  const tenantId = process.env.VITE_ENTRA_TENANT_ID || process.env.AZURE_AD_TENANT_ID || '';
  const authority = process.env.VITE_ENTRA_AUTHORITY ||
    (process.env.AZURE_AD_TENANT_ID ? `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}` : '');

  // Log config for debugging (mask most of the IDs for security)
  console.log('[Config Endpoint] Serving runtime config:', {
    clientId: clientId ? `${clientId.substring(0, 8)}...` : 'MISSING',
    tenantId: tenantId ? `${tenantId.substring(0, 8)}...` : 'MISSING',
    authority: authority || 'MISSING'
  });

  const config = `// Runtime configuration injected by server
window.ENV_CONFIG = {
  VITE_ENTRA_CLIENT_ID: '${clientId}',
  VITE_ENTRA_TENANT_ID: '${tenantId}',
  VITE_ENTRA_AUTHORITY: '${authority}'
};
`;

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(config);
});

// Serve Vue.js SPA for all routes
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Error [${req.correlationId}]:`, err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    correlationId: req.correlationId
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
