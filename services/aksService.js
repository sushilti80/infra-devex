const githubService = require('./githubService');
const config = require('../config');
const logger = require('../utils/logger');
const { logMetric } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const TtlSingleFlightCache = require('../utils/ttlSingleFlightCache');

// Immutable once a run's job log is final: 24 h, LRU (ship-from-repo spec §3.6.3 rule 2)
const triggeredByCache = new TtlSingleFlightCache({ max: 500, now: () => Date.now() });

class AksService {
  /**
   * Deploy application to AKS by triggering workflow in aya-flux repository
   */
  async deployToAks(
    envname, appname, namespace, isWebApp, imageName, imageTag,
    teamLabel, port, healthPath, externalSecretEnabled, kvSecrets, envVars, secretEnvVars,
    agentName, poolName, allowUpdate,
    workloadIdentityGrants, exposureMode, createPostgresDb,
    correlationId, triggeredBy = ''
  ) {
    const deployStart = Date.now();
    let phase = 'validation';
    try {
      logger.info(`[AKS Service] Starting AKS deployment: ${appname} to ${envname}`, { correlationId });

      // Validate inputs
      this._validateInputs(envname, appname, namespace, imageName, imageTag);
      exposureMode = exposureMode || 'legacy';
      if (!['legacy', 'private-gateway'].includes(exposureMode)) throw new Error('Invalid exposure mode');
      // Keep server-side policy aligned with the trusted sand/devsand profiles
      // in aya-flux. The client-side environment choices are not an authorization gate.
      if (exposureMode === 'private-gateway' &&
          (!['sand', 'devsand'].includes(envname) || appname !== namespace ||
            !(isWebApp === true || isWebApp === 'true') ||
            allowUpdate === true || allowUpdate === 'true')) {
        throw new Error('Private gateway requires a new sand or devsand web app with matching namespace and no overwrite');
      }
      if (!['true', 'false', true, false, undefined].includes(createPostgresDb)) throw new Error('Invalid PostgreSQL database selection');
      if ((createPostgresDb === 'true' || createPostgresDb === true) &&
          (!['sand', 'devsand'].includes(envname) || appname !== namespace ||
           !(isWebApp === true || isWebApp === 'true') ||
           allowUpdate === true || allowUpdate === 'true' || appname.length > 60)) {
        throw new Error('PostgreSQL database requires a new sand/devsand web app with matching namespace');
      }
      phase = 'dispatch';

      // Determine which workflow to use based on deployment type
      const workflowFile = isWebApp ? 'generate-webapp-config.yaml' : 'generate-agent-config.yaml';
      const deploymentType = isWebApp ? 'app' : 'agent';

      // Prepare workflow inputs based on deployment type
      let workflowInputs;

      if (isWebApp) {
        // Web App workflow inputs
        workflowInputs = {
          envname: envname,
          appname: appname,
          namespace: namespace,
          teamLabel: teamLabel || 'software-engineering',
          is_web_app: 'true',
          image_name: imageName,
          image_tag: imageTag,
          port: String(port || '80'),
          health_path: healthPath || '/healthz',
          externalSecret_enabled: externalSecretEnabled === 'true' ? 'true' : 'false',
          kv_secrets: kvSecrets || '[]',
          env_vars: envVars || '[]',
          secret_env_vars: secretEnvVars || '[]',
          workload_identity_grants: workloadIdentityGrants || '[]',
          exposure_mode: exposureMode,
          create_postgres_db: createPostgresDb === 'true' || createPostgresDb === true ? 'true' : 'false',
          correlation_id: correlationId,
          triggered_by: triggeredBy || 'system'
        };
      } else {
        // Agent workflow inputs
        workflowInputs = {
          envname: envname,
          appname: appname,
          namespace: namespace,
          agentname: agentName || `${appname}-agent`,
          poolname: poolName || 'DevOpsPool',
          agentimagesource: imageName,
          agentimagetag: imageTag,
          teamLabel: teamLabel || 'software-engineering',
          externalSecret_enabled: externalSecretEnabled === 'true' ? 'true' : 'false',
          kv_secrets: kvSecrets || '[]',
          workload_identity_grants: workloadIdentityGrants || '[]',
          correlation_id: correlationId,
          triggered_by: triggeredBy || 'system',
          allow_update: allowUpdate === 'true' ? 'true' : 'false'
        };
      }

      // Get repository information
      const repoPath = config.aks.fluxRepo; // This will be "Aya-DevOpsTeam/aya-flux"

      logger.info(`[AKS Service] Triggering workflow in ${repoPath}, workflow: ${workflowFile}`, { correlationId });
      logger.info(`[AKS Service] Full workflow path will be: ${repoPath}/.github/workflows/${workflowFile}`, { correlationId });
      logger.info(`[AKS Service] Branch: main`, { correlationId });

      // Trigger workflow dispatch
      // IMPORTANT: The workflow files must have 'workflow_dispatch' trigger configured
      //
      // Web App Workflow (generate-webapp-config.yaml) inputs:
      //   - envname, appname, namespace, is_web_app, image_name, image_tag
      //
      // Agent Workflow (generate-agent-config.yaml) inputs:
      //   - envname, appname, namespace, agentname, poolname, agentimagesource, agentimagetag
      const fluxBranch = config.aks.fluxBranch;
      logger.info(`[AKS Service] Using aya-flux branch: ${fluxBranch}`, { correlationId });

      const workflowResult = await githubService.triggerWorkflow(
        repoPath,
        workflowFile,
        fluxBranch,
        workflowInputs
      );

      logger.info(`[AKS Service] Workflow triggered successfully:`, {
        workflowId: workflowResult.workflowId,
        correlationId
      });

      logMetric('aks_deployment_dispatched', {
        event: 'aks_deployment_dispatched',
        envname,
        appname,
        deploymentType,
        workflowFile,
        repository: repoPath,
        branch: fluxBranch,
        duration_ms: Date.now() - deployStart,
        success: true,
        correlationId
      });

      return {
        success: true,
        workflowId: workflowResult.workflowId,
        workflowUrl: workflowResult.url,
        correlationId: correlationId,
        message: `AKS ${deploymentType} deployment workflow started for ${appname} in ${envname}`,
        repository: config.aks.fluxRepo,
        workflowFile: workflowFile,
        deploymentType: deploymentType,
        inputs: workflowInputs
      };

    } catch (error) {
      logMetric('aks_deployment_dispatched', {
        event: 'aks_deployment_dispatched',
        envname,
        appname,
        duration_ms: Date.now() - deployStart,
        success: false,
        level: 'error',
        phase,
        status_code: Number.isInteger(error.status) ? error.status : undefined,
        correlationId
      });

      throw new Error(`AKS deployment failed: ${error.message}`);
    }
  }

  /**
   * Validate AKS deployment inputs
   */
  _validateInputs(envname, appname, namespace, imageName, imageTag) {
    // Validate environment
    if (!config.aks.supportedEnvironments.includes(envname)) {
      throw new Error(`Unsupported environment: ${envname}. Supported: ${config.aks.supportedEnvironments.join(', ')}`);
    }

    // Validate app name (Kubernetes naming conventions)
    const kubernetesNamePattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
    if (!kubernetesNamePattern.test(appname)) {
      throw new Error('App name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric characters');
    }

    // Validate namespace (same as app name pattern)
    if (!kubernetesNamePattern.test(namespace)) {
      throw new Error('Namespace must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric characters');
    }

    // Validate image name (basic container registry format)
    const imageNamePattern = /^[a-zA-Z0-9._/-]+$/;
    if (!imageNamePattern.test(imageName)) {
      throw new Error('Invalid image name format');
    }

    // Validate image tag (basic validation)
    const imageTagPattern = /^[a-zA-Z0-9._-]+$/;
    if (!imageTagPattern.test(imageTag)) {
      throw new Error('Invalid image tag format');
    }

    // Length validations
    if (appname.length > 63) {
      throw new Error('App name cannot exceed 63 characters');
    }

    if (namespace.length > 63) {
      throw new Error('Namespace cannot exceed 63 characters');
    }
  }

  /**
   * Get AKS deployment status by workflow run ID
   */
  async getDeploymentStatus(workflowRunId) {
    try {
      const [owner, repo] = config.aks.fluxRepo.split('/');
      const workflowRun = await githubService.getWorkflowRun(owner, repo, workflowRunId);

      // Transform GitHub status into frontend-expected format
      let frontendStatus;
      if (workflowRun.status === 'completed') {
        frontendStatus = workflowRun.conclusion === 'success' ? 'success' : 'failure';
      } else if (workflowRun.status === 'in_progress') {
        frontendStatus = 'in_progress';
      } else {
        frontendStatus = 'pending';
      }

      return {
        status: frontendStatus, // Transformed status for frontend
        githubStatus: workflowRun.status, // Raw GitHub status
        conclusion: workflowRun.conclusion, // Raw GitHub conclusion
        url: workflowRun.html_url,
        createdAt: workflowRun.created_at,
        updatedAt: workflowRun.updated_at
      };
    } catch (error) {
      logger.error(`[AKS Service] Failed to get deployment status:`, { error: error.message });
      throw new Error(`Failed to get deployment status: ${error.message}`);
    }
  }

  /**
   * Get AKS deployment status by correlation ID (for polling)
   * Uses the same reliable tracking pattern as custom infrastructure
   */
  async getDeploymentStatusByCorrelationId(correlationId) {
    const start = Date.now();
    try {
      const [owner, repo] = config.aks.fluxRepo.split('/');

      logger.info(`[AKS Service] Searching for workflow with correlation ID: ${correlationId} in ${config.aks.fluxRepo}`);

      // Use the SAME reliable search pattern as custom infrastructure
      // This searches workflow runs, jobs, and logs systematically
      const workflowStatus = await this.searchWorkflowByCorrelationId(owner, repo, correlationId);
      const status = workflowStatus?.status || 'not_found';
      logMetric('aks_deployment_status', {
        correlationId,
        repository: config.aks.fluxRepo,
        status,
        github_status: workflowStatus?.githubStatus,
        conclusion: workflowStatus?.conclusion,
        duration_ms: Date.now() - start,
        level: status === 'error' || status === 'failure' ? 'error' : 'info'
      });

      if (!workflowStatus || workflowStatus.status === 'not_found') {
        logger.warn(`[AKS Service] No workflow found for correlation ID: ${correlationId}`);
        return {
          status: 'not_found',
          message: 'Workflow run not found. Please check DevOps for PR approval.'
        };
      }

      logger.info(`[AKS Service] Found workflow for ${correlationId}:`, {
        status: workflowStatus.status,
        url: workflowStatus.url
      });

      return workflowStatus;
    } catch (error) {
      logMetric('aks_deployment_status', {
        correlationId,
        status: 'error',
        level: 'error',
        duration_ms: Date.now() - start,
        status_code: Number.isInteger(error.status) ? error.status : undefined
      });
      throw error;
    }
  }

  /**
   * Search for workflow by correlation ID using EXACT same pattern as custom infrastructure
   * This searches job logs for the printed correlation ID - the PROVEN reliable method
   */
  async searchWorkflowByCorrelationId(owner, repo, correlationId) {
    try {
      // Get recent workflow runs
      const runsResponse = await githubService.octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        event: 'workflow_dispatch',
        per_page: 50
      });

      if (!runsResponse.data.workflow_runs || runsResponse.data.workflow_runs.length === 0) {
        logger.info(`[AKS Service] No workflow runs found in ${owner}/${repo}`);
        return { status: 'not_found', message: 'No workflow runs found' };
      }

      logger.info(`[AKS Service] Found ${runsResponse.data.workflow_runs.length} workflow runs, searching...`);

      // Sort runs by created_at descending (most recent first)
      const sortedRuns = [...runsResponse.data.workflow_runs].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );

      let matchingRun = null;
      let matchingJob = null; // ship-from-repo (B-5): additive, lets the route read the owner

      // EXACT SAME PATTERN AS CUSTOM INFRASTRUCTURE:
      // Search job logs for the "Print Correlation ID" step
      logger.info(`[AKS Service] Searching job logs for correlation ID...`);
      for (const run of sortedRuns.slice(0, 10)) { // Check 10 most recent runs
        const runAge = (Date.now() - new Date(run.created_at).getTime()) / (1000 * 60);
        if (runAge > 60) continue; // Skip runs older than 1 hour

        try {
          // Get jobs for this run
          const jobsResponse = await githubService.octokit.rest.actions.listJobsForWorkflowRun({
            owner,
            repo,
            run_id: run.id
          });

          let foundMatch = false;

          for (const job of jobsResponse.data.jobs) {
            // Quick check: job name contains correlation ID
            if (job.name && job.name.includes(correlationId)) {
              logger.info(`[AKS Service] Found match in job name: ${job.name}`);
              matchingRun = run;
              matchingJob = job;
              foundMatch = true;
              break;
            }

            // Check steps for "Print Correlation ID" step (same as custom infra)
            if (job.steps) {
              for (const step of job.steps) {
                if (step.name && step.name.includes('Print Correlation ID')) {
                  logger.info(`[AKS Service] Found "Print Correlation ID" step, downloading logs...`);

                  // CRITICAL: Download and search job logs (same as custom infra)
                  try {
                    const logsResponse = await githubService.octokit.rest.actions.downloadJobLogsForWorkflowRun({
                      owner,
                      repo,
                      job_id: job.id
                    });

                    const logsText = logsResponse.data.toString();

                    if (logsText.includes(correlationId)) {
                      logger.info(`[AKS Service] ✓ Verified logs contain correlation ID: ${correlationId}`);
                      matchingRun = run;
                      matchingJob = job;
                      foundMatch = true;
                      break;
                    } else {
                      logger.info(`[AKS Service] ✗ Logs contain different correlation ID (not ${correlationId})`);
                    }
                  } catch (logError) {
                    logger.warn(`[AKS Service] Could not download logs: ${logError.message}`);
                  }
                }
              }
            }

            if (foundMatch) break;
          }

          if (foundMatch) break;
        } catch (jobError) {
          logger.warn(`[AKS Service] Could not check run ${run.id}: ${jobError.message}`);
        }
      }

      if (!matchingRun) {
        logger.warn(`[AKS Service] No matching workflow found for correlation ID: ${correlationId}`);
        return { status: 'not_found', message: 'Workflow run not found' };
      }

      // Transform GitHub status to frontend format
      let frontendStatus;
      if (matchingRun.status === 'completed') {
        frontendStatus = matchingRun.conclusion === 'success' ? 'success' : 'failure';
      } else if (matchingRun.status === 'in_progress') {
        frontendStatus = 'in_progress';
      } else {
        frontendStatus = 'pending';
      }

      // Get PR info if available
      let prUrl = null;
      if (matchingRun.pull_requests && matchingRun.pull_requests.length > 0) {
        prUrl = matchingRun.pull_requests[0].url;
      }

      return {
        status: frontendStatus,
        githubStatus: matchingRun.status,
        conclusion: matchingRun.conclusion,
        url: matchingRun.html_url,
        prUrl: prUrl,
        message: `Workflow ${frontendStatus}`,
        createdAt: matchingRun.created_at,
        updatedAt: matchingRun.updated_at,
        // additive (B-5): consumed by the legacy status route's ownership check, stripped before responding
        displayTitle: matchingRun.display_title || matchingRun.name || '',
        jobId: matchingJob ? matchingJob.id : null
      };
    } catch (error) {
      logMetric('aks_workflow_search_failed', {
        correlationId, level: 'error',
        status_code: Number.isInteger(error.status) ? error.status : undefined
      });
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  /**
   * OLD METHOD - REMOVED (replaced with searchWorkflowByCorrelationId)
   * This section left as placeholder for reference
   */
  async _oldGetDeploymentStatusMethod() {
    // This method has been replaced with searchWorkflowByCorrelationId
    // which uses the proven pattern from custom infrastructure tracking
    return null;
  }

  /**
   * ship-from-repo (B-5, spec §3.6.3 rule 2): the `Triggered by: <value>` line the config workflows print in
   * their `Print Correlation ID` step — used only when the run-name carries no `by=`. Cached 24 h.
   * Returns null when logs are unavailable (caller must then require platform membership).
   */
  async getTriggeredByFromJobLog(jobId) {
    if (!jobId) return null;
    const [owner, repo] = config.aks.fluxRepo.split('/');
    return triggeredByCache.get(`triggeredBy:${jobId}`, async () => {
      try {
        const response = await githubService.octokit.rest.actions.downloadJobLogsForWorkflowRun({ owner, repo, job_id: jobId });
        const text = typeof response.data === 'string' ? response.data : Buffer.from(response.data || '').toString('utf8');
        const match = /Triggered by:\s*(\S+)/.exec(text);
        return match ? match[1] : null;
      } catch (error) {
        logger.warn(`[AKS Service] Could not read Triggered-by log line for job ${jobId}: ${error.message}`);
        return null;
      }
    }, (value) => (value ? 24 * 60 * 60 * 1000 : 0));
  }

  /**
   * ship-from-repo (§3.6.4): app state on aya-flux, Infrastructure App.
   * `new` (no dir, no PR) · `preview_open` (open PR) · `merged` (dir, no open PR) · `closed_unmerged` (PR closed, no dir).
   * For `merged`, `effectiveSettings` come from selfserve-metadata/<app>-<env>.json; `imageName` (additive) feeds
   * the bring-your-own-image ownership signal.
   */
  async getAppState(env, app) {
    const flux = config.aks.fluxRepo;
    const ref = config.aks.fluxBranch;
    const appPath = `clusters/${env}/${env}-wus3-aks-1/apps/${app}`;
    const [dirExists, pr] = await Promise.all([
      githubService.pathExists(flux, appPath, ref),
      githubService.findPullRequestForBranch(flux, `auto/gen-${env}-${app}`, 'all'),
    ]);
    if (pr && pr.state === 'open') return { appState: 'preview_open', prNumber: pr.number };
    if (dirExists) {
      const result = { appState: 'merged' };
      const file = await githubService.getFileContent(flux, `selfserve-metadata/${app}-${env}.json`, ref);
      if (file) {
        try {
          const meta = (JSON.parse(file.content) || {}).meta || {};
          if (meta.port && meta.health_path) result.effectiveSettings = { port: Number(meta.port), healthPath: String(meta.health_path) };
          if (meta.image_name) result.imageName = String(meta.image_name);
        } catch (error) {
          logger.warn(`[AKS Service] Unparseable selfserve-metadata for ${app}-${env}: ${error.message}`);
        }
      }
      return result;
    }
    if (pr && pr.state === 'closed') return { appState: 'closed_unmerged', prNumber: pr.number };
    return { appState: 'new' };
  }

  /**
   * List deployed applications from the aya-flux repository
   */
  async getDeployedApps(environment = 'sand') {
    try {
      logger.info(`[AKS Service] Fetching deployed apps for environment: ${environment}`);

      const [owner, repo] = config.aks.fluxRepo.split('/');
      const appsPath = `clusters/${environment}/${environment}-wus3-aks-1/apps`;

      // List directories in the apps folder
      const contents = await githubService.getRepositoryContents(owner, repo, appsPath);

      if (!Array.isArray(contents)) {
        return [];
      }

      // Filter only directories (applications)
      const apps = contents
        .filter(item => item.type === 'dir')
        .map(item => ({
          name: item.name,
          environment: environment,
          path: item.path,
          lastModified: new Date().toISOString(), // We could fetch this from git history if needed
          status: 'deployed'
        }));

      logger.info(`[AKS Service] Found ${apps.length} deployed apps in ${environment}`);
      return apps;

    } catch (error) {
      logger.error(`[AKS Service] Failed to get deployed apps:`, { error: error.message });
      return []; // Return empty array instead of throwing to prevent UI issues
    }
  }
}

module.exports = new AksService();
