/**
 * QA harness for the independent ship-from-repo adversarial specs (the shipQa*.spec.ts files under tests/integration).
 * Drives the real routers with `router.handle` (no sockets); GitHub, the identity provider and the JWT validator are
 * doubles. Call it from a spec AFTER setting `process.env.GITHUB_APP_ID = ''` (keeps githubService from initialising).
 */
const { Writable } = require('node:stream');

// assembled at runtime so secret scanners do not flag a test-only sentinel
const SENTINEL_TOKEN = ['SENTINEL', 'BEARER', '9f3a7c1e'].join('-');

const ID = {
  sam: '11111111-2222-3333-4444-555555555555',
  reader: '99999999-2222-3333-4444-555555555555',
  admin: 'aaaaaaaa-2222-3333-4444-555555555555',
  stranger: 'bbbbbbbb-2222-3333-4444-555555555555',
  obrien: 'cccccccc-2222-3333-4444-555555555555',
  underscore: 'dddddddd-2222-3333-4444-555555555555',
  bob: 'eeeeeeee-2222-3333-4444-555555555555',
};

function createHarness() {
  const users = {
    sam: { id: ID.sam, email: 'Sam@Example.com', roles: [], groups: [] },
    reader: { id: ID.reader, email: 'reader@x.com', roles: [], groups: [] },
    admin: { id: ID.admin, email: 'admin@x.com', roles: ['Platform.Admin'], groups: [] },
    stranger: { id: ID.stranger, email: 'nobody@x.com', roles: [], groups: [] },
    // two different people whose e-mails sanitise identically (o'brien@x vs o_brien@x)
    obrien: { id: ID.obrien, email: "o'brien@x.com", roles: [], groups: [] },
    underscore: { id: ID.underscore, email: 'o_brien@x.com', roles: [], groups: [] },
    bob: { id: ID.bob, email: 'bob@x.com', roles: [], groups: [] },
  };
  const jwt = require('../../utils/jwtValidator');
  // the bearer token itself is sentinel-shaped for `sentinel` so leakage into responses/logs is detectable
  const hook = { override: null };
  jwt.validateToken = async (token) => {
    if (hook.override) return hook.override(token);
    const key = token === SENTINEL_TOKEN ? 'sam' : token;
    if (!users[key]) throw new Error('invalid');
    return users[key];
  };
  for (const m of ['../../middleware/auth', '../../routes/ship', '../../routes/api']) delete require.cache[require.resolve(m)];

  const config = require('../../config');
  const logger = require('../../utils/logger');
  const githubService = require('../../services/githubService');
  const aksService = require('../../services/aksService');
  const identity = require('../../services/shipIdentityService');
  const shipService = require('../../services/shipService');
  const shipStatus = require('../../services/shipStatusService');
  const { createTestProvider } = require('./shipIdentityTestDouble');
  const fx = require('./shipFixtures');
  const shipRouter = require('../../routes/ship');
  const apiRouter = require('../../routes/api');

  function caller(router) {
    return (method, url, { token = 'sam', body = {}, query = {} } = {}) =>
      new Promise((resolve) => {
        const req = { method, url, originalUrl: url, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query, correlationId: 'req-1' };
        const res = {
          statusCode: 200, headers: {},
          status(c) { this.statusCode = c; return this; },
          set(k, v) { this.headers[k] = v; return this; },
          setHeader(k, v) { this.headers[k] = v; },
          json(b) { this.body = b; resolve(this); return this; },
          send(b) { this.text = b; resolve(this); return this; },
        };
        router.handle(req, res, () => resolve({ statusCode: 404, body: { unmatched: true } }));
      });
  }

  /** Capture everything the winston logger emits (all levels it is configured for) as JSON lines. */
  function captureLogs() {
    const winston = require('winston');
    const lines = [];
    const transport = new winston.transports.Stream({ stream: new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } }) });
    logger.add(transport);
    return { lines, stop: () => logger.remove(transport) };
  }

  /** The state every spec starts from: flag ON for devsand, one allowed org, test identity provider wired but NOT active. */
  function wire(w) {
    const dispatched = [];
    identity.registerProvider('test', createTestProvider({
      links: { [ID.sam]: 'octocat', [ID.reader]: 'reader-login', [ID.admin]: 'admin-login', [ID.bob]: 'bob-login' },
      repos: { octocat: [{ fullName: 'organization/my-svc', org: 'organization', name: 'my-svc', defaultBranch: 'main', private: true }] },
      permissions: { 'octocat:organization/my-svc': 'admin', 'reader-login:organization/my-svc': 'read', 'admin-login:organization/my-svc': 'write', 'bob-login:organization/my-svc': 'write' },
    }));
    githubService.codeAppGetRepo = async () => ({ defaultBranch: 'main', private: true, fork: false });
    githubService.codeAppBranchExists = async () => true;
    githubService.triggerWorkflow = async (repo, wf, ref, inputs) => { dispatched.push({ repo, wf, ref, inputs }); return { success: true }; };
    aksService.getAppState = async () => ({ appState: 'new' });
    Object.assign(config.ship, {
      allowedOrgs: ['organization'], supportedShipEnvironments: ['devsand'], workflowRef: 'ship/v1', allowDefaultRef: false,
      annotationsVerified: true, queueSignalsVerified: false, platformRoles: ['Platform.Admin'], platformGroupIds: [],
      identityProvider: 'none', previewHosts: {}, reservedNamespaces: [],
    });
    shipStatus._resetForTests();
    shipService._resetForTests();
    return { dispatched, w };
  }

  return {
    users, ID, config, logger, githubService, aksService, identity, shipService, shipStatus, fx, createTestProvider,
    hook, shipRouter, apiRouter, ship: caller(shipRouter), api: caller(apiRouter), captureLogs, wire,
  };
}

module.exports = { createHarness, ID, SENTINEL_TOKEN };
