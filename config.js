require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Function to read private key from file if path is provided
function getGitHubPrivateKey() {
  const keyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
  if (keyPath) {
    try {
      return fs.readFileSync(path.resolve(process.cwd(), keyPath), 'utf8');
    } catch (error) {
      console.error(`Error reading GitHub private key from ${keyPath}:`, error.message);
      return null;
    }
  }
  return process.env.GITHUB_PRIVATE_KEY;
}

// Read GitHub private key
let githubPrivateKey;
const privateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
if (privateKeyPath) {
  try {
    githubPrivateKey = fs.readFileSync(path.resolve(process.cwd(), privateKeyPath), 'utf8');
    console.log('Successfully loaded GitHub private key from file');
  } catch (error) {
    console.error(`Error reading GitHub private key from ${privateKeyPath}:`, error.message);
    githubPrivateKey = null;
  }
} else {
  githubPrivateKey = (process.env.GITHUB_PRIVATE_KEY || '').replace(/\\\\n/g, '\\n');
}

// Function to load environments configuration from environments.json
function loadEnvironmentsConfig() {
  // Default fallback configuration
  const defaultConfig = {
    subscriptions: {},
    defaultEnvironment: '',
    defaultSubscriptionId: '',
    environments: [],
    supportedAksEnvironments: [],
    supportedShipEnvironments: []
  };

  try {
    // Try to load from environments.json file
    const envPath = path.join(__dirname, 'data', 'environments.json');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envData = JSON.parse(envContent);

      // Extract subscriptions mapping from enabled environments
      const subscriptions = {};
      const enabledEnvs = envData.environments.filter(env => env.enabled);

      enabledEnvs.forEach(env => {
        subscriptions[env.id] = env.subscriptionId;
      });

      // Extract AKS-enabled environments
      const aksEnvironments = enabledEnvs
        .filter(env => env.features && env.features.aks)
        .map(env => env.id);

      // Ship-from-repo environments: enabled AND aks AND features.shipFromRepo (spec §4.4, DD-12)
      const shipEnvironments = enabledEnvs
        .filter(env => env.features && env.features.aks && env.features.shipFromRepo === true)
        .map(env => env.id);

      console.log('Loaded environments from environments.json:', enabledEnvs.length, 'enabled');

      return {
        subscriptions,
        defaultEnvironment: envData.defaultEnvironment || '',
        defaultSubscriptionId: envData.defaultSubscriptionId,
        environments: envData.environments,
        supportedAksEnvironments: aksEnvironments,
        supportedShipEnvironments: shipEnvironments
      };
    } else {
      console.warn('environments.json not found, using default configuration');
    }

    // Try to load from environment variable (legacy support)
    if (process.env.AZURE_SUBSCRIPTION_IDS) {
      try {
        const subscriptions = JSON.parse(process.env.AZURE_SUBSCRIPTION_IDS);
        defaultConfig.subscriptions = subscriptions;
        console.log('Loaded subscription IDs from environment variable');
      } catch (e) {
        console.warn('Failed to parse AZURE_SUBSCRIPTION_IDS environment variable:', e.message);
      }
    }

    // Try to load default subscription from environment variable
    if (process.env.AZURE_DEFAULT_SUBSCRIPTION) {
      defaultConfig.defaultSubscriptionId = process.env.AZURE_DEFAULT_SUBSCRIPTION;
    }

    return defaultConfig;
  } catch (error) {
    console.error('Error loading environments configuration:', error);
    return defaultConfig;
  }
}

const environmentConfig = loadEnvironmentsConfig();

// ship-from-repo helpers: every value comes from an env var with a fail-closed default.
const csv = (value) => (value || '').split(',').map(v => v.trim()).filter(Boolean);
const intEnv = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    console.warn('Ignoring invalid JSON in SHIP_PREVIEW_HOSTS');
    return {};
  }
}

const config = {
  app: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
  },
  github: {
    appId: process.env.GITHUB_APP_ID || '',
    privateKey: githubPrivateKey,
    privateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || '',
    installationId: process.env.GITHUB_INSTALLATION_ID || '',
    // Separate GitHub App for code deployment in AyaHealthcare org
    codeApp: {
      appId: process.env.GITHUB_CODE_APP_ID || '',
      privateKeyPath: process.env.GITHUB_CODE_PRIVATE_KEY_PATH || '',
      installationId: process.env.GITHUB_CODE_INSTALLATION_ID || ''
    },
    serviceRepo: process.env.GITHUB_SERVICE_REPO || 'Aya-DevOpsTeam/service-catalog',
    selfServiceRepo: process.env.GITHUB_SELF_SERVICE_REPO || 'Aya-DevOpsTeam/self-service-infra',
    modulesRepo: process.env.GITHUB_MODULES_REPO || 'Aya-DevOpsTeam/terraform-modules',
    infrastructureLiveRepo: process.env.GITHUB_INFRA_LIVE_REPO || 'Aya-DevOpsTeam/infrastructure-live'
  },
  aks: {
    fluxRepo: process.env.AKS_FLUX_REPO || 'Aya-DevOpsTeam/aya-flux',
    fluxBranch: process.env.AKS_FLUX_BRANCH || 'main',
    defaultEnvironment: process.env.AKS_DEFAULT_ENV || environmentConfig.defaultEnvironment || '',
    defaultImageRegistry: process.env.AKS_DEFAULT_REGISTRY || 'sharedwus3acr2.azurecr.io',
    supportedEnvironments: environmentConfig.supportedAksEnvironments,
    workflows: {
      app: 'generate-webapp-config.yaml',
      agent: 'generate-agent-config.yaml'
    }
  },
  // ship-from-repo (docs/architecture/ship-from-repo-spec.md §4.5). Read at call time by the ship
  // services, so every default here is fail-closed: no orgs, no platform members, identity `none`,
  // no preview host, watchdog cancel and ACR reads off, default workflow ref refused.
  ship: {
    workflowRepo: process.env.AKS_FLUX_REPO || 'Aya-DevOpsTeam/aya-flux',
    workflowFile: 'ship-from-repo.yaml',
    workflowRef: process.env.SHIP_WORKFLOW_REF || process.env.AKS_FLUX_BRANCH || 'main',
    allowedOrgs: csv(process.env.SHIP_ALLOWED_ORGS),
    registry: process.env.SHIP_REGISTRY || process.env.AKS_DEFAULT_REGISTRY || 'sharedwus3acr2.azurecr.io',
    acrRepoPrefix: 'selfserve',
    previewHosts: parseJsonObject(process.env.SHIP_PREVIEW_HOSTS),
    platformRoles: csv(process.env.SHIP_PLATFORM_ROLES),
    platformGroupIds: csv(process.env.SHIP_PLATFORM_GROUP_IDS),
    identityProvider: process.env.SHIP_IDENTITY_PROVIDER || 'none',
    acrReadEnabled: process.env.SHIP_ACR_READ_ENABLED === 'true',
    maxStartsPerHour: intEnv(process.env.SHIP_MAX_STARTS_PER_HOUR, 12),
    maxActiveGlobal: intEnv(process.env.SHIP_MAX_ACTIVE_GLOBAL, 10),
    maxActivePerUser: intEnv(process.env.SHIP_MAX_ACTIVE_PER_USER, 3),
    maxStartsPerUserPerHour: intEnv(process.env.SHIP_MAX_STARTS_PER_USER_PER_HOUR, 6),
    rateLimitGuardRemaining: intEnv(process.env.SHIP_RATE_LIMIT_GUARD_REMAINING, 1000),
    retryWindowHours: intEnv(process.env.SHIP_RETRY_WINDOW_HOURS, 24),
    retentionDays: intEnv(process.env.SHIP_RETENTION_DAYS, 90),
    watchdogCancelEnabled: process.env.SHIP_WATCHDOG_CANCEL_ENABLED === 'true',
    // Verification-gate switches (spec §2.4 / §11 Phase 2). Both stay false until the gate PASS is
    // recorded in the runbook: V-3 = trusted ship.result annotations are readable by the Infrastructure
    // App; V-4 = queue/concurrency semantics (watchdog, SUPERSEDED, queuedBehind). While false the
    // status resolver does not read annotations / does not derive those queue signals.
    annotationsVerified: process.env.SHIP_GATE_V3_PASSED === 'true',
    queueSignalsVerified: process.env.SHIP_GATE_V4_PASSED === 'true',
    allowDefaultRef: process.env.SHIP_ALLOW_DEFAULT_REF === 'true',
    reservedNamespaces: csv(process.env.SHIP_RESERVED_NAMESPACES),
    supportedLanguages: csv(process.env.SHIP_SUPPORTED_LANGUAGES || 'Node.js,Python,Java,Go,.NET,Ruby,PHP'),
    supportedShipEnvironments: environmentConfig.supportedShipEnvironments
  },
  webhook: {
    secret: process.env.GITHUB_WEBHOOK_SECRET || 'your_webhook_secret_here'
  },
  azure: {
    tenantId: process.env.AZURE_TENANT_ID,
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    ...environmentConfig
  },
  database: {
    server: process.env.DB_SERVER || 'your-server.database.windows.net',
    database: process.env.DB_NAME || 'infra-catalog-db',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    // SQL Authentication credentials
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || '',
    // Managed Identity settings
    useManagedIdentity: process.env.USE_MANAGED_IDENTITY === 'true',
    managedIdentityClientId: process.env.USER_ASSIGNED_IDENTITY_CLIENT_ID,
    options: {
      encrypt: process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.NODE_ENV === 'development',
      connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '30000', 10),
      requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT || '30000', 10)
    }
  },

  // secret-self-service: SOPS master key used to encrypt each secret value independently.
  sops: {
    keyVaultUrl: process.env.SOPS_KEYVAULT_URL || '',
    keyName: process.env.SOPS_KEY_NAME || 'sops-master-key',
    keyVersion: process.env.SOPS_KEY_VERSION || ''
  }
};

module.exports = config;
