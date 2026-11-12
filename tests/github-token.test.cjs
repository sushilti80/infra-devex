const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('personal token can initialize GitHub and dispatch in the same repository without an App', async () => {
  const load = Module._load;
  let authUsed;
  let dispatch;
  class FakeOctokit {
    constructor(options) {
      authUsed = options.auth;
      this.rest = {
        users: { getAuthenticated: async () => ({ data: { login: 'example' } }) },
        actions: { createWorkflowDispatch: async request => { dispatch = request; return { status: 204 }; } }
      };
    }
  }
  const config = { github: { personalAccessToken: 'test-token', appId: '', installationId: '', codeApp: {} } };
  const logger = { info() {}, warn() {}, error() {}, logMetric() {} };
  Module._load = function(request, parent, isMain) {
    if (request === '@octokit/rest') return { Octokit: FakeOctokit };
    if (request === '@octokit/auth-app') return { createAppAuth() {} };
    if (request === '../config' && parent?.filename.endsWith('githubService.js')) return config;
    if (request === '../utils/logger' && parent?.filename.endsWith('githubService.js')) return logger;
    return load.call(this, request, parent, isMain);
  };
  try {
    const service = require('../services/githubService');
    await service.initialize();
    assert.equal(service.initialized, true);
    assert.equal(authUsed, 'test-token');
    await service.triggerWorkflow('owner/infra-devex', 'self-service-custom-infra.yml', 'main', { project_name: 'demo' });
    assert.deepEqual({ owner: dispatch.owner, repo: dispatch.repo, workflow: dispatch.workflow_id, ref: dispatch.ref },
      { owner: 'owner', repo: 'infra-devex', workflow: 'self-service-custom-infra.yml', ref: 'main' });
  } finally { Module._load = load; }
});
