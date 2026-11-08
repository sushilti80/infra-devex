const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { logMetric } = logger;
const config = require('../config');
const TtlSingleFlightCache = require('../utils/ttlSingleFlightCache');

class GitHubService {
  constructor() {
    this.octokit = null;
    this.codeOctokit = null; // Separate client for code deployment
    // ship-from-repo: per-org Code App installation clients (spec §3.6.2) and rate-limit snapshot (§3.5)
    this.codeAppPrivateKey = null;
    this.codeOrgClients = new Map();
    this.installationCache = new TtlSingleFlightCache({ max: 100, now: () => Date.now() });
    this.rateLimit = { infra: null, code: null };
    this.initialized = false;
    this.initialize().catch(error => {
      logger.error('Failed to initialize GitHub service:', error);
    });
  }

  async initialize() {
    try {
      logger.info('Initializing GitHub clients...', {
        hasAppId: !!config.github.appId,
        hasInstallationId: !!config.github.installationId,
        privateKeyPath: config.github.privateKeyPath,
        hasCodeAppId: !!config.github.codeApp.appId,
        hasCodeInstallationId: !!config.github.codeApp.installationId,
        nodeEnv: process.env.NODE_ENV
      });

      // In test mode, allow server to start without GitHub credentials
      if (process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
        if (!config.github.appId || !config.github.installationId) {
          logger.warn('GitHub App credentials not configured - running in test mode without GitHub integration');
          this.initialized = false;
          return;
        }
      }

      // Initialize main GitHub App (for infrastructure)
      if (!config.github.appId || !config.github.installationId) {
        throw new Error('GitHub App credentials not fully configured');
      }

      // Read private key from file
      let privateKey;
      try {
        const keyPath = path.resolve(process.cwd(), config.github.privateKeyPath || '');
        privateKey = fs.readFileSync(keyPath, 'utf8');
        logger.info('Successfully read GitHub private key');
      } catch (error) {
        if (process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
          logger.warn('Failed to read GitHub private key in test mode - GitHub integration disabled');
          this.initialized = false;
          return;
        }
        throw new Error(`Failed to read GitHub private key: ${error.message}`);
      }

      this.octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.github.appId,
          privateKey: privateKey,
          installationId: config.github.installationId
        },
        log: {
          debug: () => {},
          info: (message) => logger.info(`GitHub API: ${message}`),
          warn: (message) => logger.warn(`GitHub API: ${message}`),
          error: (message) => logger.error(`GitHub API: ${message}`)
        }
      });

      this._trackRateLimit(this.octokit, 'infra');

      // Test the connection
      await this.octokit.rest.apps.getAuthenticated();
      logger.info('Main GitHub App authentication initialized successfully');

      // Initialize code deployment GitHub App (if configured)
      if (config.github.codeApp.appId && config.github.codeApp.installationId && config.github.codeApp.privateKeyPath) {
        try {
          const codeKeyPath = path.resolve(process.cwd(), config.github.codeApp.privateKeyPath);
          const codePrivateKey = fs.readFileSync(codeKeyPath, 'utf8');
          logger.info('Successfully read code deployment GitHub private key');

          this.codeOctokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
              appId: config.github.codeApp.appId,
              privateKey: codePrivateKey,
              installationId: config.github.codeApp.installationId
            },
            log: {
              debug: () => {},
              info: (message) => logger.info(`GitHub Code API: ${message}`),
              warn: (message) => logger.warn(`GitHub Code API: ${message}`),
              error: (message) => logger.error(`GitHub Code API: ${message}`)
            }
          });

          this.codeAppPrivateKey = codePrivateKey;
          this._trackRateLimit(this.codeOctokit, 'code');
          await this.codeOctokit.rest.apps.getAuthenticated();
          logger.info('Code deployment GitHub App authentication initialized successfully');
        } catch (error) {
          logger.warn('Code deployment GitHub App not configured or failed to initialize:', error.message);
          this.codeOctokit = null;
        }
      }

      this.initialized = true;

    } catch (error) {
      logger.error('Failed to initialize GitHub App:', {
        error: error.message,
        stack: error.stack
      });
      this.initialized = false;
      // In test mode, don't throw - allow server to start without GitHub
      if (process.env.NODE_ENV === 'test' || process.env.CI === 'true') {
        logger.warn('GitHub service unavailable in test mode - server will start without GitHub integration');
        return;
      }
      throw error; // Re-throw to allow handling by the caller
    }
  }

  ensureInitialized() {
    if (!this.initialized || !this.octokit) {
      const message = process.env.NODE_ENV === 'test' || process.env.CI === 'true'
        ? 'GitHub client not initialized - running in test mode. Configure GitHub App credentials for full functionality.'
        : 'GitHub client not initialized';
      throw new Error(message);
    }
  }

  async createIssue(repo, title, body, labels = [], correlationId = '') {
    const start = Date.now();
    try {
      this.ensureInitialized();

      const [owner, repoName] = repo.split('/');

      const tag = correlationId ? `[${correlationId}] ` : '';

      logger.info(`${tag}Creating GitHub issue in ${repo}: "${title}"`);

      let timeoutId;

      const createPromise = this.octokit.rest.issues.create({
        owner,
        repo: repoName,
        title,
        body,
        labels
      });

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error('GitHub API request timed out after 10s');
          err.code = 'GITHUB_TIMEOUT';
          reject(err);
        }, 10000);
      });

      const response = await Promise.race([createPromise, timeoutPromise]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);

      logMetric('github_api_call', {
        operation: 'createIssue',
        repo,
        duration_ms: Date.now() - start,
        success: true,
        correlationId: correlationId || 'unknown'
      });

      logger.info(`${tag}GitHub issue created: ${response.data.html_url}`);

      return {
        issueUrl: response.data.html_url,
        issueNumber: response.data.number
      };
    } catch (error) {
      logMetric('github_api_call', {
        operation: 'createIssue',
        repo,
        duration_ms: Date.now() - start,
        success: false,
        error: error.message,
        correlationId: correlationId || 'unknown'
      });

      const tag = correlationId ? `[${correlationId}] ` : '';

      if (error.code === 'GITHUB_TIMEOUT') {
        logger.error(`${tag}GitHub issue creation timed out for ${repo}`);
        throw error;
      }

      if (error.status === 429) {
        error.retryAfter = (error.response && error.response.headers && error.response.headers['retry-after']) || '60';
        logger.warn(`${tag}GitHub rate limit hit creating issue in ${repo}. Retry after: ${error.retryAfter}s`);
        throw error;
      }

      logger.error(`${tag}Failed to create GitHub issue in ${repo}: ${error.message}`);
      throw new Error(`Failed to create GitHub issue: ${error.message}`);
    }
  }

  // secrets-environment-bundles §2.4/§7 (Round 1 Blocking Finding 3): additive, backward-compatible
  // trailing `correlationId` — existing callers that omit it are unaffected (tag defaults to '').
  async createPullRequest(repo, baseBranch, headBranch, title, body, correlationId = '') {
    const tag = correlationId ? `[${correlationId}] ` : '';
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const [owner, repoName] = repo.split('/');

      const response = await this.octokit.rest.pulls.create({
        owner,
        repo: repoName,
        title,
        body,
        head: headBranch,
        base: baseBranch
      });

      logger.info(`${tag}Pull request created: ${response.data.html_url}`);
      return {
        prUrl: response.data.html_url,
        prNumber: response.data.number
      };
    } catch (error) {
      logger.error(`${tag}Failed to create pull request: ${error.message}`);
      throw error;
    }
  }

  async createBranch(repo, baseBranch, newBranch) {
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const [owner, repoName] = repo.split('/');

      // Get the SHA of the base branch
      const baseRef = await this.octokit.rest.git.getRef({
        owner,
        repo: repoName,
        ref: `heads/${baseBranch}`
      });

      // Create new branch from the base branch
      await this.octokit.rest.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${newBranch}`,
        sha: baseRef.data.object.sha
      });

      logger.info(`Branch created: ${newBranch} in ${repo}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create branch: ${error.message}`);
      throw error;
    }
  }

  async createOrUpdateFile(repo, branch, path, content, message, sha = null) {
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const [owner, repoName] = repo.split('/');

      const params = {
        owner,
        repo: repoName,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
        branch
      };

      // If sha is provided, it's an update operation
      if (sha) {
        params.sha = sha;
      }

      const response = await this.octokit.rest.repos.createOrUpdateFileContents(params);

      logger.info(`File ${path} created/updated in ${repo}`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to create/update file: ${error.message}`);
      throw error;
    }
  }

  // secrets-environment-bundles §2.4/§7 (Round 1 Blocking Finding 3): additive, backward-compatible
  // trailing `correlationId` — existing callers that omit it are unaffected.
  async getFileContent(repo, path, branch = process.env.SERVICE_CATALOG_BRANCH || 'main', correlationId = '') {
    const start = Date.now();
    const tag = correlationId ? `[${correlationId}] ` : '';
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const [owner, repoName] = repo.split('/');

      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo: repoName,
        path,
        ref: branch
      });

      // Decode content from base64
      const content = Buffer.from(response.data.content, 'base64').toString();

      logMetric('github_api_call', { operation: 'getFileContent', repo, duration_ms: Date.now() - start, success: true, correlationId: correlationId || 'unknown' });
      return {
        content,
        sha: response.data.sha
      };
    } catch (error) {
      logMetric('github_api_call', { operation: 'getFileContent', repo, duration_ms: Date.now() - start, success: false, error: error.message, correlationId: correlationId || 'unknown' });
      if (error.status === 404) {
        return null; // File doesn't exist
      }
      logger.error(`${tag}Failed to get file content: ${error.message}`);
      throw error;
    }
  }

  /**
   * secrets-environment-bundles §2.4 (resolves OQ-005 and Round 1 Blocking Finding 2): builds one
   * Git tree + one commit + one branch ref covering every included file, using the Git Data API
   * directly (no new GitHub App permission required — see spec.md §2.4 evidence). `files`:
   * [{ path, content }] (plain UTF-8 text; createTree's `content` field creates the blob inline).
   *
   * `expectedFileShas`: Record<path, string|null> — the SHA the caller believes each target path
   * currently has (string), or null if the caller believes the path does not exist yet. A path key
   * omitted entirely skips the write-time CAS check for that path. Best-effort CAS: re-reads every
   * target path's current blob SHA as the last possible read before the mutating calls, and maps a
   * subsequent createRef/updateRef 422 (ref race) to the same CONFLICT code — no automatic retries.
   *
   * `correlationId`: optional, additive, backward-compatible — mirrors the existing createIssue()
   * tag/logMetric convention (Round 1 Blocking Finding 3).
   */
  async createMultiFileCommit(repo, { branchName, baseBranch, files, expectedFileShas, commitMessage, correlationId = '' }) {
    const start = Date.now();
    const tag = correlationId ? `[${correlationId}] ` : '';
    const [owner, repoName] = repo.split('/');
    try {
      const branchAlreadyExists = await this.branchExists(repo, branchName);
      const parentRef = branchAlreadyExists ? `heads/${branchName}` : `heads/${baseBranch}`;
      // bare name — Contents API convention, not the `heads/`-prefixed Git Data API ref form
      const contentApiRef = branchAlreadyExists ? branchName : baseBranch;

      const { data: refData } = await this.octokit.rest.git.getRef({ owner, repo: repoName, ref: parentRef });
      const parentCommitSha = refData.object.sha;
      const { data: commitData } = await this.octokit.rest.git.getCommit({ owner, repo: repoName, commit_sha: parentCommitSha });
      const baseTreeSha = commitData.tree.sha;

      // Write-time CAS (closes Blocking Finding 2): re-read each target path's current blob SHA,
      // on the exact ref this commit will be built on, as the LAST read before any mutating call.
      if (expectedFileShas) {
        const currentFiles = await Promise.all(
          files.map(f => this.getFileContent(repo, f.path, contentApiRef, correlationId))
        );
        const conflicts = [];
        files.forEach((f, i) => {
          if (!(f.path in expectedFileShas)) return; // caller opted out of CAS for this path
          const expected = expectedFileShas[f.path];
          const actual = currentFiles[i] ? currentFiles[i].sha : null;
          if (actual !== expected) conflicts.push({ path: f.path, expected, actual });
        });
        if (conflicts.length > 0) {
          logger.warn(`${tag}createMultiFileCommit: write-time SHA conflict on ${conflicts.length} path(s) in ${repo}: ${conflicts.map(c => c.path).join(', ')}`);
          const error = new Error(`Write-time SHA conflict on ${conflicts.length} path(s)`);
          error.code = 'CONFLICT';
          error.conflicts = conflicts;
          throw error;
        }
      }

      const { data: treeData } = await this.octokit.rest.git.createTree({
        owner, repo: repoName, base_tree: baseTreeSha,
        tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }))
      });

      const { data: newCommit } = await this.octokit.rest.git.createCommit({
        owner, repo: repoName, message: commitMessage, tree: treeData.sha, parents: [parentCommitSha]
      });

      if (branchAlreadyExists) {
        try {
          await this.octokit.rest.git.updateRef({ owner, repo: repoName, ref: `heads/${branchName}`, sha: newCommit.sha, force: false });
        } catch (error) {
          if (error.status === 422) { // non-fast-forward: branch tip moved after our getRef (ref-update race)
            logger.warn(`${tag}createMultiFileCommit: ${branchName} moved concurrently in ${repo} (non-fast-forward)`);
            const conflictErr = new Error(`Branch ${branchName} moved during commit build`);
            conflictErr.code = 'CONFLICT';
            throw conflictErr;
          }
          throw error;
        }
      } else {
        try {
          await this.octokit.rest.git.createRef({ owner, repo: repoName, ref: `refs/heads/${branchName}`, sha: newCommit.sha });
        } catch (error) {
          if (error.status === 422) { // ref already exists: created concurrently by a parallel request
            logger.warn(`${tag}createMultiFileCommit: ${branchName} created concurrently in ${repo}`);
            const conflictErr = new Error(`Branch ${branchName} was created concurrently`);
            conflictErr.code = 'CONFLICT';
            throw conflictErr;
          }
          throw error;
        }
      }

      logger.info(`${tag}Multi-file commit created: ${newCommit.sha} (${files.length} files) on ${branchName} in ${repo}`);
      logMetric('github_api_call', { operation: 'createMultiFileCommit', repo, file_count: files.length, duration_ms: Date.now() - start, success: true, correlationId: correlationId || 'unknown' });
      return { commitSha: newCommit.sha, branchName, branchAlreadyExisted: branchAlreadyExists };
    } catch (error) {
      logMetric('github_api_call', { operation: 'createMultiFileCommit', repo, file_count: files.length, duration_ms: Date.now() - start, success: false, error: error.message, correlationId: correlationId || 'unknown' });
      throw error;
    }
  }

  async triggerWorkflow(repo, workflowId, branch, inputs = {}, useCodeApp = false) {
    const start = Date.now();
    const correlationId = inputs.correlation_id;
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const [owner, repoName] = repo.split('/');

      // Use code deployment GitHub App if specified and available
      let octokitInstance = this.octokit;
      if (useCodeApp && this.codeOctokit) {
        logger.info(`Using code deployment GitHub App for ${repo}`);
        octokitInstance = this.codeOctokit;
      } else if (useCodeApp && !this.codeOctokit) {
        logger.warn(`Code deployment GitHub App not configured, falling back to main app for ${repo}`);
      }

      // Make a copy of inputs to avoid modifying the original
      const workflowInputs = { ...inputs };

      logMetric('github_workflow_dispatch_requested', {
        repo, workflow_id: workflowId, branch, correlationId
      });

      // Use the inputs including correlation_id
      const response = await octokitInstance.rest.actions.createWorkflowDispatch({
        owner,
        repo: repoName,
        workflow_id: workflowId,
        ref: branch,
        inputs: workflowInputs
      });

      logger.info(`Workflow ${workflowId} triggered in ${repo}`);
      logMetric('github_api_call', { operation: 'triggerWorkflow', repo, workflow_id: workflowId, duration_ms: Date.now() - start, success: true, correlationId });

      // Return more information about the workflow
      return {
        success: true,
        workflowId,
        repo,
        branch,
        correlationId: correlationId || 'unknown',
        url: `https://github.com/${repo}/actions/workflows/${encodeURIComponent(workflowId)}`
      };
    } catch (error) {
      logMetric('github_api_call', {
        operation: 'triggerWorkflow', repo, workflow_id: workflowId,
        duration_ms: Date.now() - start, success: false, correlationId,
        level: 'error',
        status_code: Number.isInteger(error.status) ? error.status : undefined
      });
      throw error;
    }
  }

  /**
   * Generate an installation access token for the code deployment GitHub App
   * This token can be used to authenticate git operations in workflows
   */
  async generateInstallationToken(useCodeApp = true) {
    try {
      // Use code deployment app by default for cross-org access
      const octokitInstance = useCodeApp && this.codeOctokit ? this.codeOctokit : this.octokit;

      if (!octokitInstance) {
        throw new Error('GitHub client not initialized');
      }

      // Get installation access token
      const installationId = useCodeApp
        ? config.github.codeApp.installationId
        : config.github.installationId;

      logger.info(`Generating installation access token for installation ID: ${installationId}`);

      // The Octokit auth strategy automatically handles token generation
      // We just need to get the current authentication
      const { token } = await octokitInstance.auth({ type: 'installation' });

      logger.info('Installation access token generated successfully');

      return token;
    } catch (error) {
      logger.error(`Failed to generate installation token: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get installation access token for the specified GitHub App
   * @param {boolean} useCodeApp - Whether to use code deployment app or main app
   * @returns {Promise<string>} The installation access token
   */
  async getInstallationAccessToken(useCodeApp = false) {
    try {
      const octokitInstance = useCodeApp && this.codeOctokit ? this.codeOctokit : this.octokit;

      if (!octokitInstance) {
        throw new Error('GitHub client not initialized');
      }

      // Get the installation access token
      const authResult = await octokitInstance.auth({
        type: 'installation'
      });

      return authResult.token;
    } catch (error) {
      logger.error(`Failed to get installation access token: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create or update a repository secret
   * Used to store the GitHub App token for use in workflows
   */
  async createOrUpdateRepoSecret(repo, secretName, secretValue, useCodeApp = true) {
    try {
      const octokitInstance = useCodeApp && this.codeOctokit ? this.codeOctokit : this.octokit;

      if (!octokitInstance) {
        throw new Error('GitHub client not initialized');
      }

      const [owner, repoName] = repo.split('/');

      logger.info(`Creating/updating secret ${secretName} in ${repo}`);

      // Get the repository's public key for encrypting the secret
      const { data: publicKey } = await octokitInstance.rest.actions.getRepoPublicKey({
        owner,
        repo: repoName
      });

      // Encrypt the secret value using tweetnacl sealed box (libsodium compatible)
      const sodium = require('tweetnacl');
      const sealedbox = require('tweetnacl-sealedbox-js');
      const { decodeBase64, encodeBase64 } = require('tweetnacl-util');

      // Convert the secret and key to Uint8Array
      const messageBytes = Buffer.from(secretValue);
      const keyBytes = decodeBase64(publicKey.key);

      // Encrypt the secret using sealed box (anonymous encryption)
      const encryptedBytes = sealedbox.seal(messageBytes, keyBytes);
      const encryptedValue = encodeBase64(encryptedBytes);

      // Create or update the secret
      await octokitInstance.rest.actions.createOrUpdateRepoSecret({
        owner,
        repo: repoName,
        secret_name: secretName,
        encrypted_value: encryptedValue,
        key_id: publicKey.key_id
      });

      logger.info(`Secret ${secretName} created/updated successfully in ${repo}`);

      return { success: true };
    } catch (error) {
      logger.error(`Failed to create/update repo secret: ${error.message}`);
      throw error;
    }
  }

  async getWorkflowStatusByCorrelationId(correlationId, workflowType = null) {
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      if (!correlationId) {
        throw new Error('Correlation ID is required');
      }

      // Add extra debug logging
      logger.info(`------------------------------------------------------------`);
      logger.info(`WORKFLOW STATUS CHECK: Looking for correlation ID: ${correlationId}`);
      logger.info(`Workflow type: ${workflowType || 'Not specified'}`);
      logger.info(`Timestamp: ${new Date().toISOString()}`);
      logger.info(`------------------------------------------------------------`);

      // Select the correct repository based on workflow type
      // Agent dispatch workflows run in infrastructure-live, create-repo in self-service-catalog, all others in service catalog
      let repoToSearch;
      if (workflowType === 'agent') {
        repoToSearch = config.github.infrastructureLiveRepo;
      } else if (workflowType === 'create-repo') {
        repoToSearch = config.github.codeServiceRepo;
      } else {
        repoToSearch = config.github.serviceRepo;
      }

      const [owner, repoName] = repoToSearch.split('/');

      logger.info(`Searching for workflow with correlation ID: ${correlationId}${workflowType ? ` (${workflowType} workflow)` : ''} in repo: ${repoToSearch}`);

      // Filter workflows based on type if provided
      let workflowFilters = {};
      let workflowFileFilter = '';

      if (workflowType) {
        // All workflow types use workflow_dispatch event
        workflowFilters.event = 'workflow_dispatch';

        // Apply more specific filters based on workflow type
        switch(workflowType) {
          case 'delete':
            workflowFileFilter = 'catalog-delete.yml';
            break;
          case 'promote':
            workflowFileFilter = 'move-to-infralive.yaml';
            break;
          case 'custom':
            workflowFileFilter = 'self-service-custom-infra.yml';
            break;
          case 'template':
            workflowFileFilter = 'self-service-deploy-application.yml';
            break;
          case 'agent':
            workflowFileFilter = 'agent-dispatch.yml';
            break;
          case 'create-repo':
            workflowFileFilter = 'create-app.yml';
            break;
        }

        logger.info(`Using workflow file filter: ${workflowFileFilter || 'none'} for ${workflowType} workflow`);
      }

      // Use code deployment app for create-repo workflows (different GitHub App has access)
      const octokitClient = (workflowType === 'create-repo' && this.codeOctokit)
        ? this.codeOctokit
        : this.octokit;

      // First try to get all workflow runs from the repository with any filters
      const runsResponse = await octokitClient.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo: repoName,
        per_page: 100,
        ...workflowFilters
      });

      if (!runsResponse.data.workflow_runs || runsResponse.data.workflow_runs.length === 0) {
        logger.info(`No workflow runs found in repository ${owner}/${repoName}`);
        return {
          status: 'unknown',
          message: 'No workflow runs found in repository'
        };
      }

      logger.info(`Found ${runsResponse.data.workflow_runs.length} workflow runs in repository`);

      let matchingRun = null;

      // Sort runs by created_at in descending order to process most recent first
      const sortedRuns = [...runsResponse.data.workflow_runs].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );

      // DEBUG: Log the first few runs to help troubleshoot
      sortedRuns.slice(0, 5).forEach((run, index) => {
        logger.info(`DEBUG - Recent run ${index + 1}: ID=${run.id}, Name=${run.name}, Created=${run.created_at}, Title=${run.display_title || 'No title'}, Event=${run.event}`);
      });

      // First priority: Look for runs that were triggered by workflow_dispatch with our correlation ID
      // This is the most reliable method as it directly checks the workflow inputs
      for (const run of sortedRuns) {
        // Only check recently created runs (within the last hour)
        const runCreatedAt = new Date(run.created_at);
        const now = new Date();
        const timeDiffMinutes = (now - runCreatedAt) / (1000 * 60);

        if (timeDiffMinutes > 60) {
          continue; // Skip older runs
        }

        // Check if this is a workflow_dispatch event (manually triggered)
        if (run.event === 'workflow_dispatch') {
          try {
            // Get the workflow run's detailed data including inputs
            const runDetailsResponse = await this.octokit.rest.actions.getWorkflowRun({
              owner,
              repo: repoName,
              run_id: run.id
            });

            const runDetails = runDetailsResponse.data;

            // Check if this workflow run was triggered with our correlation_id as input
            if (runDetails.workflow_id && runDetails.head_branch) {
              try {
                // Get the workflow to get its inputs
                const workflowResponse = await this.octokit.rest.actions.getWorkflow({
                  owner,
                  repo: repoName,
                  workflow_id: runDetails.workflow_id
                });

                if (workflowResponse.data && workflowResponse.data.name) {
                  // Now get the specific run's usage of that workflow
                  const runUsageResponse = await this.octokit.rest.actions.getWorkflowRunUsage({
                    owner,
                    repo: repoName,
                    run_id: run.id
                  });

                  // Check directly in run.html_url which often contains the correlation ID
                  if (run.html_url && run.html_url.includes(correlationId)) {
                    logger.info(`Found matching run by URL containing correlation ID: ${run.html_url}`);
                    matchingRun = run;
                    break;
                  }

                  // Check in run display title which may contain the correlation ID
                  if (run.display_title && run.display_title.includes(correlationId)) {
                    logger.info(`Found matching run by display title containing correlation ID: ${run.display_title}`);
                    matchingRun = run;
                    break;
                  }
                }
              } catch (workflowError) {
                logger.warn(`Error getting workflow details for run ${run.id}: ${workflowError.message}`);
              }
            }
          } catch (runError) {
            logger.warn(`Error getting detailed info for run ${run.id}: ${runError.message}`);
          }
        }
      }

      // Second priority: Check job logs for correlation ID (in case it was printed by the workflow)
      if (!matchingRun) {
        for (const run of sortedRuns.slice(0, 10)) { // Only check 10 most recent runs
          try {
            // Get the jobs for this run
            const jobsResponse = await this.octokit.rest.actions.listJobsForWorkflowRun({
              owner,
              repo: repoName,
              run_id: run.id
            });

            // Check if any job has a step with our correlation ID in name or output
            let foundMatch = false;

            for (const job of jobsResponse.data.jobs) {
              // Check job name
              if (job.name && job.name.includes(correlationId)) {
                logger.info(`Found matching run by job name: ${run.html_url}`);
                matchingRun = run;
                foundMatch = true;
                break;
              }

              // Check steps
              if (job.steps) {
                for (const step of job.steps) {
                  if ((step.name && step.name.includes(correlationId)) ||
                      (step.conclusion && typeof step.conclusion === 'string' && step.conclusion.includes(correlationId))) {
                    logger.info(`Found matching run by step name/conclusion: ${run.html_url}`);
                    matchingRun = run;
                    foundMatch = true;
                    break;
                  }

                  // Check for the specific "🔗 Correlation ID: [correlation-id]" format in step outputs
                  if (step.name && step.name.includes("Print Correlation ID")) {
                    logger.info(`Found a "Print Correlation ID" step. Checking for matching correlation ID.`);

                    // CRITICAL: Verify this step contains OUR correlation ID, not a different one
                    try {
                      const logsResponse = await this.octokit.rest.actions.downloadJobLogsForWorkflowRun({
                        owner,
                        repo: repoName,
                        job_id: job.id
                      });

                      const logsText = logsResponse.data.toString();

                      if (logsText.includes(correlationId)) {
                        logger.info(`Verified logs contain our correlation ID ${correlationId}`);
                        matchingRun = run;
                        foundMatch = true;
                        break;
                      } else {
                        logger.info(`"Print Correlation ID" step found but contains DIFFERENT correlation ID (not ${correlationId})`);
                        // Don't match - this is a different workflow's correlation ID
                      }
                    } catch (logError) {
                      logger.warn(`Error verifying correlation ID in logs: ${logError.message}`);
                      // Don't match on error - we can't verify it's the right correlation ID
                    }
                  }
                }
              }

              if (foundMatch) break;
            }

            if (foundMatch) break;
          } catch (jobError) {
            logger.warn(`Error getting jobs for run ${run.id}: ${jobError.message}`);
          }
        }
      }

      // Third priority: Very recent runs if they match the project name
      if (!matchingRun) {
        for (const run of sortedRuns) {
          // Only consider very recent runs (within 2 minutes)
          const runCreatedAt = new Date(run.created_at);
          const now = new Date();
          const timeDiffMinutes = (now - runCreatedAt) / (1000 * 60);

          if (timeDiffMinutes <= 2) {
            // Extract project name from correlation ID if possible
            const projectNameMatch = correlationId.match(/^([\w-]+)-\d+/);
            const projectName = projectNameMatch ? projectNameMatch[1] : null;

            // If project name is in the run title, it's likely related
            if (projectName && run.display_title && run.display_title.includes(projectName)) {
              logger.info(`Found very recent run (${Math.round(timeDiffMinutes * 60)}s ago) that might match our project: ${run.html_url}`);
              matchingRun = run;
              break;
            }
          }
        }
      }

      // Fourth priority: Check for workflows with "Print Correlation ID" steps
      if (!matchingRun) {
        logger.info(`Looking for workflows with "Print Correlation ID" step that may match our correlation ID: ${correlationId}`);

        for (const run of sortedRuns.slice(0, 5)) { // Check the 5 most recent runs
          try {
            // Only consider recent runs (within 10 minutes)
            const runCreatedAt = new Date(run.created_at);
            const now = new Date();
            const timeDiffMinutes = (now - runCreatedAt) / (1000 * 60);

            if (timeDiffMinutes > 10) {
              continue; // Skip older runs
            }

            // Get the jobs for this run
            const jobsResponse = await this.octokit.rest.actions.listJobsForWorkflowRun({
              owner,
              repo: repoName,
              run_id: run.id
            });

            let foundPrintStep = false;

            for (const job of jobsResponse.data.jobs) {
              // Check steps for a "Print Correlation ID" step
              if (job.steps) {
                for (const step of job.steps) {
                  if (step.name && step.name.includes("Print Correlation ID")) {
                    logger.info(`Found a "Print Correlation ID" step in workflow run: ${run.html_url}`);
                    foundPrintStep = true;

                    // CRITICAL: Check if this step actually contains OUR correlation ID
                    // The step name might be "Print Correlation ID" but it could contain a DIFFERENT correlation ID
                    try {
                      // Get the job logs to verify it contains our specific correlation ID
                      const logsResponse = await this.octokit.rest.actions.downloadJobLogsForWorkflowRun({
                        owner,
                        repo: repoName,
                        job_id: job.id
                      });

                      // Convert logs to string (it's a binary response)
                      const logsText = logsResponse.data.toString();

                      // Check if the logs contain our specific correlation ID
                      if (logsText.includes(correlationId)) {
                        logger.info(`Verified logs contain our correlation ID ${correlationId} in workflow run: ${run.html_url}`);
                        matchingRun = run;
                        break;
                      } else {
                        logger.info(`Found "Print Correlation ID" step but it contains a DIFFERENT correlation ID (not ${correlationId})`);
                      }
                    } catch (logError) {
                      logger.warn(`Error downloading logs to verify correlation ID: ${logError.message}`);
                    }
                  }
                }

                if (matchingRun) break;
              }
            }

            if (matchingRun) break;
          } catch (jobError) {
            logger.warn(`Error checking jobs for run ${run.id}: ${jobError.message}`);
          }
        }
      }

      // If we still haven't found a matching run, try to use the most recent workflow run
      if (!matchingRun) {
        logger.info(`No workflow run found explicitly matching correlation ID: ${correlationId}`);

        // FALLBACK: Use the most recent workflow run that matches our workflow type
        if (workflowType && workflowFileFilter && sortedRuns.length > 0) {
          // Find the most recent run that matches our workflow file
          for (const run of sortedRuns.slice(0, 10)) { // Only check the 10 most recent runs
            try {
              // Get the workflow information
              const workflowResponse = await this.octokit.rest.actions.getWorkflow({
                owner,
                repo: repoName,
                workflow_id: run.workflow_id
              });

              const workflowPath = workflowResponse?.data?.path || '';
              logger.info(`Checking workflow: ${workflowPath} against filter: ${workflowFileFilter}`);

              if (workflowPath.includes(workflowFileFilter)) {
                // Use this run as our match if it was created within the last 5 minutes
                const runCreatedAt = new Date(run.created_at);
                const now = new Date();
                const timeDiffMinutes = (now - runCreatedAt) / (1000 * 60);

                if (timeDiffMinutes <= 5) {
                  logger.info(`Using recent matching workflow run as fallback: ${run.html_url} (created ${Math.round(timeDiffMinutes)} minutes ago)`);
                  matchingRun = run;
                  break;
                }
              }
            } catch (workflowError) {
              logger.warn(`Error getting workflow info: ${workflowError.message}`);
            }
          }
        }

        // If we still don't have a match, assume workflow is pending
        if (!matchingRun) {
          logger.info(`No suitable workflow run found for correlation ID: ${correlationId}`);
          return {
            status: 'pending',
            message: `Workflow may still be initializing. Please check again in a moment. (Correlation ID: ${correlationId})`
          };
        }
      }

      logger.info(`Found workflow run for correlation ID ${correlationId}: ${matchingRun.html_url}`);

      // Try to extract PR URL from workflow logs if the workflow is completed or in progress
      let prUrl = null;
      try {
        // First, try to get the PR URL from the run details if available
        if (matchingRun.head_commit && matchingRun.head_commit.message) {
          const commitMessage = matchingRun.head_commit.message;
          const prUrlMatches = commitMessage.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g);
          if (prUrlMatches && prUrlMatches.length > 0) {
            prUrl = prUrlMatches[0];
            logger.info(`Found PR URL in commit message: ${prUrl}`);
          }
        }

        // If no PR URL found and the workflow is completed or in progress, check the logs
        if (!prUrl && (matchingRun.status === 'completed' || matchingRun.status === 'in_progress')) {
          // Get jobs for this run to check their outputs
          const jobsResponse = await this.octokit.rest.actions.listJobsForWorkflowRun({
            owner,
            repo: repoName,
            run_id: matchingRun.id
          });

          // Check each job for PR URL in its name or conclusion
          for (const job of jobsResponse.data.jobs) {
            if (job.name && job.name.includes('http')) {
              const prUrlMatches = job.name.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g);
              if (prUrlMatches && prUrlMatches.length > 0) {
                prUrl = prUrlMatches[0];
                logger.info(`Found PR URL in job name: ${prUrl}`);
                break;
              }
            }

            // Check steps for PR URL
            if (job.steps) {
              for (const step of job.steps) {
                if (step.name && step.name.includes('http')) {
                  const prUrlMatches = step.name.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g);
                  if (prUrlMatches && prUrlMatches.length > 0) {
                    prUrl = prUrlMatches[0];
                    logger.info(`Found PR URL in step name: ${prUrl}`);
                    break;
                  }
                }

                if (step.conclusion && typeof step.conclusion === 'string' && step.conclusion.includes('http')) {
                  const prUrlMatches = step.conclusion.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g);
                  if (prUrlMatches && prUrlMatches.length > 0) {
                    prUrl = prUrlMatches[0];
                    logger.info(`Found PR URL in step conclusion: ${prUrl}`);
                    break;
                  }
                }
              }
              if (prUrl) break;
            }
          }

          // If still no PR URL, try downloading the logs
          if (!prUrl && matchingRun.status === 'completed') {
            // Skip log downloading as it's causing issues with this version of Octokit
            logger.info(`Skipping log download for run ${matchingRun.id} due to compatibility issues`);

            // Instead, let's try to get the PR URL from the repository's recent PRs
            try {
              // Get recent PRs in the repository
              const prsResponse = await this.octokit.rest.pulls.list({
                owner,
                repo: repoName,
                state: 'all', // Get both open and closed PRs
                sort: 'created',
                direction: 'desc',
                per_page: 20
              });

              // Look for PRs created around the same time as the workflow run
              const workflowCreatedAt = new Date(matchingRun.created_at);
              const recentPrs = prsResponse.data;

              logger.info(`Checking ${recentPrs.length} recent PRs for matches with our workflow`);

              for (const pr of recentPrs) {
                const prCreatedAt = new Date(pr.created_at);
                const timeDiffMinutes = Math.abs(prCreatedAt - workflowCreatedAt) / (1000 * 60);

                // If PR was created within 5 minutes of the workflow, it's likely related
                if (timeDiffMinutes <= 5) {
                  prUrl = pr.html_url;
                  logger.info(`Found PR created around the same time as workflow: ${prUrl}`);

                  // Check if PR is merged - only create database entry for merged PRs
                  if (pr.merged) {
                    logger.info(`PR #${pr.number} is merged, creating database entry`);
                    try {
                      // Get workflow parameters from run details
                      const projectName = matchingRun.display_title ? matchingRun.display_title.split(' ')[0] : 'unknown';
                      const environment = 'dev'; // Default environment
                      const owner = pr.user ? pr.user.login : 'unknown';

                      // Create database entry for the deployed application
                      await logger.info({
                        projectName,
                        environment,
                        owner,
                        templateName: null, // We don't know if it's from template
                        correlationId,
                        workflowRunId: matchingRun.id.toString(),
                        workflowUrl: matchingRun.html_url,
                        prNumber: pr.number,
                        prUrl: pr.html_url,
                        modules: [],
                        tags: {}
                      });

                      logger.info(`Successfully created database entry for merged PR #${pr.number}`);
                    } catch (error) {
                      logger.error(`Failed to create database entry: ${error.message}`);
                    }
                  } else {
                    logger.info(`PR #${pr.number} is not merged yet, skipping database entry`);
                  }

                  break;
                }

                // Also check if PR body or title contains our correlation ID
                if ((pr.body && pr.body.includes(correlationId)) ||
                    (pr.title && pr.title.includes(correlationId))) {
                  prUrl = pr.html_url;
                  logger.info(`Found PR with matching correlation ID: ${prUrl}`);

                  // Check if PR is merged - only create database entry for merged PRs
                  if (pr.merged) {
                    logger.info(`PR #${pr.number} is merged, creating database entry`);
                    try {
                      // Get workflow parameters from run details
                      const projectName = matchingRun.display_title ? matchingRun.display_title.split(' ')[0] : 'unknown';
                      const environment = 'dev'; // Default environment
                      const owner = pr.user ? pr.user.login : 'unknown';

                      // Create database entry for the deployed application
                      await logger.info({
                        projectName,
                        environment,
                        owner,
                        templateName: null, // We don't know if it's from template
                        correlationId,
                        workflowRunId: matchingRun.id.toString(),
                        workflowUrl: matchingRun.html_url,
                        prNumber: pr.number,
                        prUrl: pr.html_url,
                        modules: [],
                        tags: {}
                      });

                      logger.info(`Successfully created database entry for merged PR #${pr.number}`);
                    } catch (error) {
                      logger.error(`Failed to create database entry: ${error.message}`);
                    }
                  } else {
                    logger.info(`PR #${pr.number} is not merged yet, skipping database entry`);
                  }

                  break;
                }
              }
            } catch (prError) {
              logger.warn(`Could not check recent PRs: ${prError.message}`);
            }
          }
        }
      } catch (error) {
        logger.warn(`Error extracting PR URL: ${error.message}`);
      }

      // Add more detailed info about the matching run
      const result = {
        status: matchingRun.status,
        conclusion: matchingRun.conclusion,
        url: matchingRun.html_url,
        prUrl: prUrl,
        runId: matchingRun.id,
        name: matchingRun.name,
        displayTitle: matchingRun.display_title || 'No display title',
        createdAt: matchingRun.created_at,
        updatedAt: matchingRun.updated_at,
        event: matchingRun.event,
        workflowType: workflowType || 'unknown'
      };

      logger.info(`------------------------------------------------------------`);
      logger.info(`WORKFLOW STATUS RESULT: Found matching workflow run`);
      logger.info(`Correlation ID: ${correlationId}`);
      logger.info(`Workflow URL: ${matchingRun.html_url}`);
      logger.info(`Status: ${matchingRun.status}, Conclusion: ${matchingRun.conclusion || 'pending'}`);
      logger.info(`Created at: ${matchingRun.created_at}, Updated at: ${matchingRun.updated_at}`);
      logger.info(`------------------------------------------------------------`);

      return result;
    } catch (error) {
      logger.error(`Failed to get workflow status: ${error.message}`);
      throw error;
    }
  }

  // Keeping the old method for backward compatibility
  async getWorkflowStatus(correlationId) {
    return this.getWorkflowStatusByCorrelationId(correlationId);
  }

  /**
   * Handle GitHub webhook events
   * @param {string} event - The GitHub event type
   * @param {Object} payload - The webhook payload
   */
  async handleWebhookEvent(event, payload) {
    try {
      logger.info(`Processing GitHub webhook event: ${event}`);

      switch (event) {
        case 'pull_request':
          await this.handlePullRequestEvent(payload);
          break;
        case 'pull_request_review':
          await this.handlePullRequestReviewEvent(payload);
          break;
        default:
          logger.debug(`Unhandled webhook event type: ${event}`);
      }
    } catch (error) {
      logger.error(`Error handling webhook event ${event}: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Handle pull request events
   * @param {Object} payload - The webhook payload
   */
  async handlePullRequestEvent(payload) {
    const { action, pull_request: pr, repository } = payload;

    // We're only interested in merged PRs
    if (action !== 'closed' || !pr.merged) {
      return;
    }

    const { number: prNumber, html_url: prUrl, head } = pr;
    const { ref: branch, repo: { name: repoName, owner: { login: owner } } } = head;

    // Extract correlation ID from branch name or PR body
    const correlationId = this.extractCorrelationId(pr.body || '');

    if (!correlationId) {
      logger.warn(`No correlation ID found in PR #${prNumber}`);
      return;
    }

    // Get workflow run ID from the check suites
    const workflowRunId = await this.getWorkflowRunId(owner, repoName, pr.head.sha);

    // Log deployment information since we removed database integration
    logger.info(`Processed merged PR #${prNumber} for correlation ID: ${correlationId}`, {
      projectName: repoName,
      environment: this.extractEnvironmentFromBranch(branch),
      owner,
      correlationId,
      workflowRunId,
      prNumber,
      prUrl,
      status: 'deployed',
      lifecyclePhase: 'experimental'
    });
  }

  /**
   * Extract correlation ID from PR body
   * @param {string} prBody - The PR body text
   * @returns {string|null} - The correlation ID or null if not found
   */
  extractCorrelationId(prBody) {
    const match = prBody.match(/Correlation ID: ([a-f0-9-]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Extract environment from branch name
   * @param {string} branch - The branch name
   * @returns {string} - The environment name
   */
  extractEnvironmentFromBranch(branch) {
    if (branch.includes('production')) return 'production';
    if (branch.includes('staging')) return 'staging';
    if (branch.includes('test')) return 'test';
    return 'development';
  }

  /**
   * Get workflow run ID for a specific commit
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} sha - Commit SHA
   * @returns {Promise<string|null>} - Workflow run ID or null if not found
   */
  async getWorkflowRunId(owner, repo, sha) {
    try {
      const response = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        event: 'push',
        head_sha: sha,
        per_page: 1
      });

      return response.data.workflow_runs[0]?.id?.toString() || null;
    } catch (error) {
      logger.error(`Error getting workflow run ID: ${error.message}`);
      return null;
    }
  }

  /**
   * Handle pull request review events
   * @param {Object} payload - The webhook payload
   */
  async handlePullRequestReviewEvent(payload) {
    // Handle PR review events if needed
    logger.debug('PR review event received', {
      action: payload.action,
      pr: payload.pull_request?.number
    });
  }

  /**
   * List all installations of this GitHub App
   * @returns {Promise<Array>} List of installations
   */
  async listInstallations() {
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      // Get all installations for this GitHub App
      const response = await this.octokit.rest.apps.listInstallations();

      return response.data.map(installation => ({
        id: installation.id,
        account: {
          login: installation.account.login,
          type: installation.account.type,
          id: installation.account.id
        },
        repository_selection: installation.repository_selection,
        created_at: installation.created_at,
        updated_at: installation.updated_at,
        app_slug: installation.app_slug
      }));
    } catch (error) {
      logger.error(`Failed to list GitHub App installations: ${error.message}`);
      throw error;
    }
  }

  /**
   * Test repository access and permissions
   * @param {string} repo - Repository in format "owner/repo"
   * @param {boolean} useCodeApp - Whether to use code deployment GitHub App
   * @returns {Promise<Object>} Access test results
   */
  async testRepositoryAccess(repo, useCodeApp = false) {
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      // Use code deployment GitHub App if specified and available
      let octokitInstance = this.octokit;
      if (useCodeApp && this.codeOctokit) {
        logger.info(`Using code deployment GitHub App for testing ${repo}`);
        octokitInstance = this.codeOctokit;
      } else if (useCodeApp && !this.codeOctokit) {
        return {
          repository: repo,
          error: 'Code deployment GitHub App not configured or failed to initialize',
          tests: {}
        };
      }

      const [owner, repoName] = repo.split('/');
      const results = {
        repository: repo,
        usingCodeApp: useCodeApp && !!this.codeOctokit,
        tests: {}
      };

      // Test 1: Can we get repository info?
      try {
        const repoInfo = await octokitInstance.rest.repos.get({
          owner,
          repo: repoName
        });
        results.tests.repository_access = {
          success: true,
          name: repoInfo.data.full_name,
          private: repoInfo.data.private,
          permissions: repoInfo.data.permissions
        };
      } catch (error) {
        results.tests.repository_access = {
          success: false,
          error: error.message
        };
      }

      // Test 2: Can we list workflows?
      try {
        const workflows = await octokitInstance.rest.actions.listRepoWorkflows({
          owner,
          repo: repoName
        });
        results.tests.workflows_access = {
          success: true,
          count: workflows.data.total_count,
          workflows: workflows.data.workflows.map(w => ({
            name: w.name,
            path: w.path,
            state: w.state
          }))
        };
      } catch (error) {
        results.tests.workflows_access = {
          success: false,
          error: error.message
        };
      }

      // Test 3: Can we get the specific create-app.yml workflow?
      try {
        const workflow = await octokitInstance.rest.actions.getWorkflow({
          owner,
          repo: repoName,
          workflow_id: 'create-app.yml'
        });
        results.tests.create_app_workflow = {
          success: true,
          id: workflow.data.id,
          name: workflow.data.name,
          path: workflow.data.path,
          state: workflow.data.state
        };
      } catch (error) {
        results.tests.create_app_workflow = {
          success: false,
          error: error.message,
          note: 'Workflow file may not exist or GitHub App lacks Actions permissions'
        };
      }

      // Test 4: Can we read .github/workflows directory?
      try {
        const contents = await octokitInstance.rest.repos.getContent({
          owner,
          repo: repoName,
          path: '.github/workflows'
        });
        results.tests.workflows_directory = {
          success: true,
          files: Array.isArray(contents.data)
            ? contents.data.map(f => f.name)
            : [contents.data.name]
        };
      } catch (error) {
        results.tests.workflows_directory = {
          success: false,
          error: error.message
        };
      }

      return results;
    } catch (error) {
      logger.error(`Failed to test repository access for ${repo}: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all workflows in a repository
   * @param {string} repo - Repository in format "owner/repo"
   * @returns {Promise<Array>} List of workflows
   */
  async listWorkflows(repo) {
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const [owner, repoName] = repo.split('/');

      const response = await this.octokit.rest.actions.listRepoWorkflows({
        owner,
        repo: repoName
      });

      return response.data.workflows.map(workflow => ({
        id: workflow.id,
        name: workflow.name,
        path: workflow.path,
        state: workflow.state,
        created_at: workflow.created_at
      }));
    } catch (error) {
      logger.error(`Failed to list workflows in ${repo}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Trigger agent dispatch workflow in infrastructure-live repository
   * @param {string} agentName - Name of the agent to run
   * @param {string} prompt - Formatted prompt with all parameters
   * @param {string} correlationId - Correlation ID for tracking
   * @param {string} triggeredBy - Entra ID email of the requesting user
   * @param {string} jiraTicket - Jira ticket reference
   * @returns {Promise<Object>} - { success, workflowUrl, correlationId }
   */
  async triggerAgentDispatch(agentName, prompt, correlationId, triggeredBy = '', jiraTicket = '') {
    try {
      if (!this.octokit) {
        throw new Error('GitHub client not initialized');
      }

      const repo = config.github.infrastructureLiveRepo;
      if (!repo) {
        throw new Error('Infrastructure live repository not configured');
      }

      const [owner, repoName] = repo.split('/');

      logger.info(`[${correlationId}] Triggering agent dispatch workflow: ${agentName} in ${repo}. triggered_by: "${triggeredBy || '(not set)'}"`);

      // Trigger workflow_dispatch event
      await this.octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo: repoName,
        workflow_id: 'agent-dispatch.yml',
        ref: 'main',
        inputs: {
          agent: agentName,
          prompt: prompt,
          correlation_id: correlationId,
          ...(triggeredBy && { triggered_by: triggeredBy }),
          ...(jiraTicket && { jira_ticket: jiraTicket })
        }
      });

      const workflowUrl = `https://github.com/${repo}/actions/workflows/agent-dispatch.yml`;

      logger.info(`[${correlationId}] Agent dispatch workflow triggered successfully: ${workflowUrl}`);

      return {
        success: true,
        workflowUrl,
        correlationId,
        message: `Agent ${agentName} workflow dispatched successfully`
      };

    } catch (error) {
      logger.error(`[${correlationId}] Failed to trigger agent dispatch: ${error.message}`, {
        error,
        agentName,
        correlationId
      });

      if (error.status === 404) {
        throw new Error('Agent dispatch workflow not found in infrastructure-live repository');
      } else if (error.status === 403) {
        throw new Error('Insufficient permissions to trigger workflow. Check GitHub App permissions.');
      } else {
        throw new Error(`Failed to trigger agent dispatch workflow: ${error.message}`);
      }
    }
  }

  // secret-self-service FR-002(h) / Arch Round 1 B3: check for an existing branch before
  // createBranch(), which throws on an already-existing ref.
  async branchExists(repo, branchName) {
    if (!this.octokit) {
      throw new Error('GitHub client not initialized');
    }
    const [owner, repoName] = repo.split('/');
    try {
      await this.octokit.rest.git.getRef({ owner, repo: repoName, ref: `heads/${branchName}` });
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }

  // secret-self-service FR-002(h) / Arch Round 1 A2: head filter requires the `owner:` prefix.
  async findOpenPullRequest(repo, branchName) {
    if (!this.octokit) {
      throw new Error('GitHub client not initialized');
    }
    const [owner, repoName] = repo.split('/');
    const response = await this.octokit.rest.pulls.list({
      owner,
      repo: repoName,
      head: `${owner}:${branchName}`,
      state: 'open'
    });
    return response.data[0] || null;
  }

  // secret-self-service FR-003(b): one-shot recursive tree enumeration, used instead of path probing.
  async getRepoTree(repo) {
    const start = Date.now();
    if (!this.octokit) {
      throw new Error('GitHub client not initialized');
    }
    const [owner, repoName] = repo.split('/');
    try {
      const { data: repoData } = await this.octokit.rest.repos.get({ owner, repo: repoName });
      const defaultBranch = repoData.default_branch;
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner,
        repo: repoName,
        ref: `heads/${defaultBranch}`
      });
      const { data: treeData } = await this.octokit.rest.git.getTree({
        owner,
        repo: repoName,
        tree_sha: refData.object.sha,
        recursive: 'true'
      });
      logMetric('github_api_call', { operation: 'getRepoTree', repo, duration_ms: Date.now() - start, success: true });
      return { tree: treeData.tree, truncated: !!treeData.truncated };
    } catch (error) {
      logMetric('github_api_call', { operation: 'getRepoTree', repo, duration_ms: Date.now() - start, success: false, error: error.message });
      throw error;
    }
  }

  // secret-self-service FR-001(f): lastUpdated derives from the file's most recent commit.
  async getFileLastCommitDate(repo, filePath) {
    if (!this.octokit) {
      throw new Error('GitHub client not initialized');
    }
    const [owner, repoName] = repo.split('/');
    try {
      const { data } = await this.octokit.rest.repos.listCommits({
        owner,
        repo: repoName,
        path: filePath,
        per_page: 1
      });
      return data[0]?.commit?.committer?.date || null;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // ship-from-repo (docs/architecture/ship-from-repo-spec.md §4.3, §5.1). Additive helpers only.
  // Credential discipline (NFR-003): `codeApp*` helpers use the Code App (per-org installation);
  // every other `ship`/run helper below uses the Infrastructure App (`this.octokit`). A helper never
  // mixes the two clients.
  // ---------------------------------------------------------------------------------------------

  /** Capture x-ratelimit-* response headers per App (Octokit `hook.after`). */
  _trackRateLimit(client, key) {
    if (!client || !client.hook || typeof client.hook.after !== 'function') return;
    client.hook.after('request', (response) => {
      const h = response && response.headers;
      if (h && h['x-ratelimit-remaining'] !== undefined) {
        this.rateLimit[key] = {
          remaining: Number(h['x-ratelimit-remaining']),
          limit: Number(h['x-ratelimit-limit']),
          reset: Number(h['x-ratelimit-reset']),
        };
      }
    });
  }

  /** Latest rate-limit snapshot for the Infrastructure App (or null before the first call). */
  getRateLimitSnapshot() {
    return this.rateLimit.infra;
  }

  _requireInfra() {
    if (!this.octokit) throw new Error('GitHub client not initialized');
    return this.octokit;
  }

  /**
   * Code App client for an allowlisted org's installation (`GET /orgs/{org}/installation`, cached 1 h).
   * Returns null when the Code App is not configured or not installed on the org.
   */
  async getCodeAppClientForOrg(org) {
    if (this.codeOrgClients.has(org)) return this.codeOrgClients.get(org);
    if (!this.codeOctokit || !config.github.codeApp.appId || !this.codeAppPrivateKey) return null;
    const installationId = await this.installationCache.get(`installation:${org}`, async () => {
      try {
        const { token } = await this.codeOctokit.auth({ type: 'app' });
        const res = await this.codeOctokit.request('GET /orgs/{org}/installation', { org, headers: { authorization: `bearer ${token}` } });
        return res.data.id;
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    }, 60 * 60 * 1000);
    if (!installationId) return null;
    const client = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: config.github.codeApp.appId, privateKey: this.codeAppPrivateKey, installationId },
    });
    this._trackRateLimit(client, 'code');
    this.codeOrgClients.set(org, client);
    return client;
  }

  /** Code App: repo metadata `{ defaultBranch, private, fork }` or null (not found / App not installed). */
  async codeAppGetRepo(org, repo) {
    const client = await this.getCodeAppClientForOrg(org);
    if (!client) return null;
    try {
      const { data } = await client.rest.repos.get({ owner: org, repo });
      return { defaultBranch: data.default_branch, private: !!data.private, fork: !!data.fork };
    } catch (error) {
      if (error.status === 404 || error.status === 403) return null;
      throw error;
    }
  }

  /** Code App: one page of branches `{ branches:[{name}], hasNext }`; null when the repo is not reachable. */
  async codeAppListBranches(org, repo, page = 1) {
    const client = await this.getCodeAppClientForOrg(org);
    if (!client) return null;
    try {
      const { data } = await client.rest.repos.listBranches({ owner: org, repo, per_page: 100, page });
      return { branches: data.map((b) => ({ name: b.name })), hasNext: data.length === 100 };
    } catch (error) {
      if (error.status === 404 || error.status === 403) return null;
      throw error;
    }
  }

  /** Code App: `GET /repos/{o}/{r}/branches/{b}` existence check for a typed branch. */
  async codeAppBranchExists(org, repo, branch) {
    const client = await this.getCodeAppClientForOrg(org);
    if (!client) return false;
    try {
      await client.rest.repos.getBranch({ owner: org, repo, branch });
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }

  /** Infrastructure-App call with the standard `github_api_call` metric (operation, repo, duration, success[, status_code]). */
  async _infraCall(operation, repo, correlationId, fn) {
    const start = Date.now();
    try {
      const result = await fn(this._requireInfra());
      logMetric('github_api_call', { operation, repo, duration_ms: Date.now() - start, success: true, correlationId: correlationId || 'unknown' });
      return result;
    } catch (error) {
      logMetric('github_api_call', {
        operation, repo, duration_ms: Date.now() - start, success: false, error: error.message, correlationId: correlationId || 'unknown',
        level: Number.isInteger(error.status) && error.status < 500 ? 'warn' : 'error', // 404/409/422 are routine here (log not ready, run already finished)
        status_code: Number.isInteger(error.status) ? error.status : undefined,
      });
      throw error;
    }
  }

  /** Infrastructure App: one page of workflow runs for a dispatch-only workflow within a `created` window. */
  async listWorkflowRunsInWindow(repo, workflowFile, { created, page = 1, perPage = 100, correlationId }) {
    const [owner, repoName] = repo.split('/');
    const { data } = await this._infraCall('listWorkflowRuns', repo, correlationId, (octokit) => octokit.rest.actions.listWorkflowRuns({
      owner, repo: repoName, workflow_id: workflowFile, event: 'workflow_dispatch', created, per_page: perPage, page,
    }));
    return data.workflow_runs || [];
  }

  /** Infrastructure App: jobs (with steps) of a run, latest attempt only. */
  async listJobsForRun(repo, runId, correlationId) {
    const [owner, repoName] = repo.split('/');
    const { data } = await this._infraCall('listJobsForRun', repo, correlationId, (octokit) => octokit.rest.actions.listJobsForWorkflowRun({
      owner, repo: repoName, run_id: runId, filter: 'latest', per_page: 100,
    }));
    return data.jobs || [];
  }

  /** Infrastructure App: check-run annotations of a job (a job id is a check-run id). */
  async listJobAnnotations(repo, jobId, correlationId) {
    const [owner, repoName] = repo.split('/');
    const { data } = await this._infraCall('listJobAnnotations', repo, correlationId, (octokit) => octokit.rest.checks.listAnnotations({
      owner, repo: repoName, check_run_id: jobId, per_page: 50,
    }));
    return data || [];
  }

  /** Infrastructure App: job log text (redirect followed server-side); null when not available yet. */
  async downloadJobLogs(repo, jobId, correlationId) {
    const [owner, repoName] = repo.split('/');
    try {
      const { data } = await this._infraCall('downloadJobLogs', repo, correlationId, (octokit) => octokit.rest.actions.downloadJobLogsForWorkflowRun({ owner, repo: repoName, job_id: jobId }));
      if (typeof data === 'string') return data;
      return data ? Buffer.from(data).toString('utf8') : null;
    } catch (error) {
      if (error.status === 404 || error.status === 410) return null;
      throw error;
    }
  }

  /** Infrastructure App: cancel a workflow run. */
  async cancelWorkflowRun(repo, runId, correlationId) {
    const [owner, repoName] = repo.split('/');
    await this._infraCall('cancelWorkflowRun', repo, correlationId, (octokit) => octokit.rest.actions.cancelWorkflowRun({ owner, repo: repoName, run_id: runId }));
  }

  /** Infrastructure App: newest PR for a head branch → `{ number, url, state: open|merged|closed }` or null. */
  async findPullRequestForBranch(repo, branchName, state = 'all', correlationId) {
    const [owner, repoName] = repo.split('/');
    const { data } = await this._infraCall('findPullRequestForBranch', repo, correlationId, (octokit) => octokit.rest.pulls.list({
      owner, repo: repoName, head: `${owner}:${branchName}`, state, per_page: 1,
    }));
    const pr = data[0];
    if (!pr) return null;
    return { number: pr.number, url: pr.html_url, state: pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed' };
  }

  /** Infrastructure App: does a path exist at a ref? */
  async pathExists(repo, path, ref) {
    const [owner, repoName] = repo.split('/');
    try {
      await this._requireInfra().rest.repos.getContent({ owner, repo: repoName, path, ref });
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }
}

module.exports = new GitHubService();
