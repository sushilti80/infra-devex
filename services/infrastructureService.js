const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const githubService = require('./githubService');
const config = require('../config');
const logger = require('../utils/logger');

class InfrastructureService {
  /**
   * Fetch a JSON data file from the service-catalog GitHub repo on SERVICE_CATALOG_BRANCH.
   * Falls back to the local data/ copy if GitHub is unavailable.
   * @param {string} fileName - File name under data/ (e.g. 'modules.json')
   * @returns {Promise<any>} Parsed JSON
   */
  async _fetchDataFile(fileName) {
    const branch = process.env.SERVICE_CATALOG_BRANCH || 'main';
    const remotePath = `data/${fileName}`;
    const localPath = path.join(__dirname, '../data', fileName);

    if (githubService.initialized) {
      try {
        const result = await githubService.getFileContent(config.github.selfServiceRepo, remotePath, branch);
        if (result) {
          logger.info(`Loaded ${fileName} from GitHub (${config.github.selfServiceRepo}@${branch})`);
          return JSON.parse(result.content);
        }
      } catch (err) {
        logger.warn(`Failed to fetch ${fileName} from GitHub, falling back to local file: ${err.message}`);
      }
    }

    // Local fallback
    if (!fs.existsSync(localPath)) {
      logger.warn(`Data file not found locally: ${localPath}`);
      return null;
    }
    logger.info(`Loaded ${fileName} from local data/ folder`);
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  }

  /**
   * Get available templates dynamically from the service-catalog repo (data/templates.json),
   * falling back to the local data/ copy.
   */
  async getTemplates() {
    try {
      const data = await this._fetchDataFile('templates.json');
      return data || [];
    } catch (error) {
      logger.error(`Failed to get templates: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get available modules dynamically from the service-catalog repo (data/modules.json),
   * falling back to the local data/ copy.
   */
  async getModules() {
    try {
      const data = await this._fetchDataFile('modules.json');
      return data || [];
    } catch (error) {
      logger.error(`Failed to get modules: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get available agents dynamically from the service-catalog repo (data/agents.json),
   * falling back to the local data/ copy.
   */
  async getAgents() {
    try {
      const data = await this._fetchDataFile('agents.json');
      return data?.agents || [];
    } catch (error) {
      logger.error(`Failed to get agents: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get available RBAC roles dynamically from the service-catalog repo (data/roles.json),
   * falling back to the local data/ copy.
   */
  async getRoles() {
    try {
      const data = await this._fetchDataFile('roles.json');
      return data || { roles: [], scopes: [] };
    } catch (error) {
      logger.error(`Failed to get roles: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get available environments dynamically from the service-catalog repo (data/environments.json),
   * falling back to the local data/ copy.
   * Returns only enabled environments for frontend consumption.
   */
  async getEnvironments() {
    const emptyFallback = {
      environments: [],
      defaultEnvironment: '',
      defaultSubscriptionId: ''
    };

    try {
      // Environment configuration is the local runtime source of truth. Keep
      // this read aligned with config.js so API consumers and backend
      // validation cannot resolve different catalogs.
      const envPath = path.join(__dirname, '../data/environments.json');
      const envData = fs.existsSync(envPath)
        ? JSON.parse(fs.readFileSync(envPath, 'utf8'))
        : null;
      if (!envData) return emptyFallback;
      return {
        ...envData,
        environments: envData.environments.filter(env => env.enabled)
      };
    } catch (error) {
      logger.error(`Failed to get environments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get installed applications by reading files from the docs/metadata folder in the GitHub repository
   * Each file contains app details in JSON format
   */
  async getInstalledApps() {
    try {
      // Check if GitHub service is initialized
      if (!githubService.initialized) {
        await githubService.initialize();
      }

      // Get the repository details from config
      const [owner, repo] = config.github.serviceRepo.split('/');

      logger.info(`Fetching application metadata from GitHub repository: ${owner}/${repo} in docs/metadata folder`);

      // List files in the docs/metadata folder
      const { data: contents } = await githubService.octokit.rest.repos.getContent({
        owner,
        repo,
        path: 'docs/metadata'
      });

      // Filter for JSON files
      const jsonFiles = contents.filter(file =>
        file.type === 'file' && file.name.endsWith('.json')
      );

      logger.info(`Found ${jsonFiles.length} JSON files in docs/metadata folder`);

      // Fetch and parse each JSON file
      const appPromises = jsonFiles.map(async (file) => {
        try {
          // Get file content
          const { data: fileData } = await githubService.octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.path
          });

          // Decode content from base64
          const content = Buffer.from(fileData.content, 'base64').toString('utf8');
          const appData = JSON.parse(content);

          // Transform to expected format for the frontend
          return {
            projectName: appData.projectName || appData.project, // Support both formats
            environment: appData.environment,
            owner: appData.owner || appData.meta?.owner || "Unknown",
            createdAt: appData.createdAt || appData.meta?.deployed_at || new Date().toISOString(),
            status: appData.status || 'active',
            lifecycle: appData.lifecycle || appData.meta?.lifecycle || 'experimental', // Use value from metadata, default to 'experimental'
            description: appData.description || appData.meta?.description || `${appData.projectName || appData.project} infrastructure in ${appData.environment}`, // Add description field
            modules: this._normalizeModules(appData.modules || appData.meta?.modules || 'azure-vm, azure-storage'), // Normalize modules to consistent format
            // Add age as a top-level property so it's easily accessible in the frontend
            age: appData.age || appData.meta?.age || "Unknown",
            // Add additional metadata
            githubUser: appData.githubUser || appData.meta?.githubuser,
            commitSha: appData.commitSha || appData.meta?.commit_sha,
            costCenter: appData.tags?.costCenter || appData.meta?.cost_center
          };
        } catch (fileError) {
          logger.error(`Error processing metadata file ${file.name}: ${fileError.message}`);
          return null;
        }
      });

      // Wait for all promises and filter out any null values (errors)
      const apps = (await Promise.all(appPromises)).filter(app => app !== null);

      // Structured metric event — consumed by Datadog log-based metric for app_list_fetched rate
      logger.logMetric('app_list_fetched', {
        app_count: apps.length,
        source: 'github',
        repo: `${owner}/${repo}`
      });

      return apps;
    } catch (error) {
      logger.error(`Failed to get installed apps from GitHub: ${error.message}`);
      // Return empty array instead of throwing error to prevent UI issues
      return [];
    }
  }

  /**
   * Get AKS deployed applications by reading files from selfserve-metadata/ in the flux-config repo.
   * Mirrors how getInstalledApps() reads from docs/metadata/ in service-catalog.
   */
  async getAKSInstalledApps() {
    try {
      if (!githubService.initialized) {
        await githubService.initialize();
      }

      const [owner, repo] = config.aks.fluxRepo.split('/');
      const branch = 'main';

      logger.info(`Fetching AKS metadata from ${owner}/${repo} selfserve-metadata/`);

      let contents;
      try {
        const response = await githubService.octokit.rest.repos.getContent({
          owner,
          repo,
          path: 'selfserve-metadata',
          ref: branch
        });
        contents = response.data;
      } catch (err) {
        if (err.status === 404) {
          logger.info('selfserve-metadata folder not found in flux-config — no AKS apps yet');
          return [];
        }
        throw err;
      }

      const jsonFiles = Array.isArray(contents)
        ? contents.filter(f => f.type === 'file' && f.name.endsWith('.json'))
        : [];

      logger.info(`Found ${jsonFiles.length} AKS metadata files`);

      const appPromises = jsonFiles.map(async (file) => {
        try {
          const { data: fileData } = await githubService.octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.path,
            ref: branch
          });
          const raw = Buffer.from(fileData.content, 'base64').toString('utf8');
          const r = JSON.parse(raw);
          const meta = r.meta || {};
          // Derive URLs only for approved private-gateway environments.
          // Metadata alone does not prove the Flux exposure rollout is Ready.
          const appName = meta.appname || r.project || '';
          const privateZoneByEnv = config.aks.privateZones || {};
          const privateZone = Object.prototype.hasOwnProperty.call(privateZoneByEnv, r.environment)
            ? privateZoneByEnv[r.environment] : null;
          const privateGateway = meta.exposure_mode === 'private-gateway' &&
            Boolean(privateZone) &&
            appName === meta.namespace &&
            /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/.test(appName);

          // Normalise the flux-config selfserve-metadata schema into the UI shape
          return {
            project:               r.project || meta.appname || '',
            appname:               meta.appname || r.project || '',
            namespace:             meta.namespace || '',
            environment:           r.environment || '',
            deploymentType:        r.type === 'webapp' ? 'app' : 'agent',
            imageName:             meta.image_name || '',
            imageTag:              meta.image_tag || '',
            port:                  meta.port || '',
            healthPath:            meta.health_path || '',
            teamLabel:             meta.teamLabel || '',
            externalSecretEnabled: meta.externalSecret_enabled === 'true',
            version:               r.version || '',
            commitSha:             meta.commit_sha || '',
            commitShas:            r.commitshas || [],
            owner:                 meta.triggered_by || '',
            deployedAt:            meta.deployed_at || '',
            correlationId:         meta.correlation_id || '',
            exposureMode:          privateGateway ? 'private-gateway' : 'legacy',
            exposureUrl:           privateGateway ? `https://${appName}.${privateZone}` : null,
            gitops:                r.gitops || null,
            resourceInventory:     r.resourceInventory || null,
            postgresDatabase:      meta.postgres_database || null,
            lifecycle:             r.lifecycle || null,
            deletionEligible:      Boolean(r.gitops?.namespaceOwned &&
                                      r.gitops?.owners?.some(o => o.role === 'workload' && o.prune === true) &&
                                      r.lifecycle?.status !== 'deleting'),
            status:                r.status || 'deployed'
          };
        } catch (fileError) {
          logger.error(`Error processing AKS metadata file ${file.name}: ${fileError.message}`);
          return null;
        }
      });

      const apps = (await Promise.all(appPromises)).filter(a => a !== null);
      return apps;
    } catch (error) {
      logger.error(`Failed to get AKS installed apps: ${error.message}`);
      return [];
    }
  }

  /**
   * Build custom infrastructure by directly triggering a workflow
   */
  async buildCustomInfrastructure(projectName, descriptiveName, environment, modules, owner, crNumber, projectAge, correlationId, rbacPairs = '', triggeredBy = '') {
    try {
      // Generate correlation ID if not provided
      if (!correlationId) {
        correlationId = uuidv4();
      }

      // Get terraform branch from environment variable
      const terraformBranch = process.env.TERRAFORM_BRANCH || 'main';

      // Ensure descriptiveName has a value, use fallback if not provided
      const finalDescriptiveName = descriptiveName || projectName || 'Unnamed Project';

      logger.info(`Triggering custom infrastructure workflow for ${projectName} (${finalDescriptiveName}) in ${environment} with modules: ${modules.join(', ')}`);
      if (rbacPairs) {
        logger.info(`RBAC relationships: ${rbacPairs}`);
      }
      logger.info(`Using terraform branch: ${terraformBranch}`);

      // Prepare workflow inputs
      const workflowInputs = {
        project_name: projectName,
        project_desc: finalDescriptiveName, // Use project_desc as the key for descriptiveName
        environment: environment,
        modules: modules.map(m => m.replace(/[\[\]]/g, '')).join(','), // Remove brackets and join with commas
        owner: owner,
        cr: crNumber,
        age: projectAge <= 3 ? "3 days" :
            projectAge <= 30 ? "1 month" : "3 months",
        correlation_id: correlationId,
        terraform_branch: terraformBranch, // Add terraform branch parameter
        triggered_by: triggeredBy // Authenticated user email for PR description
      };

      // Add RBAC pairs if provided
      if (rbacPairs && rbacPairs.trim() !== '') {
        workflowInputs.rbac_pairs = rbacPairs;
      }

      // Get service catalog branch from environment variable
      const serviceCatalogBranch = process.env.SERVICE_CATALOG_BRANCH || 'main';

      // In infrastructureService.js, update the triggerWorkflow call:
      // In buildCustomInfrastructure method, update the modules parameter:
      const result = await githubService.triggerWorkflow(
        config.github.serviceRepo,
        'self-service-custom-infra.yml',
        serviceCatalogBranch,  // Use configured branch for workflow dispatch
        workflowInputs
      );

      logger.info(`Custom infrastructure workflow triggered for ${projectName} with correlation ID: ${correlationId}`);

      // We will only add database entries after PR is merged, not when workflow is triggered

      return {
        success: true,
        correlationId: correlationId,
        message: `Workflow triggered successfully. Correlation ID: ${correlationId}`
      };
    } catch (error) {
      logger.error(`Failed to trigger custom infrastructure workflow: ${error.message}`);
      throw error;
    }
  }

  /**
  * Deploy from a template by directly triggering a workflow
  */
  async deployFromTemplate(templateName, projectName, descriptiveName, environment, owner, projectAge, correlationId, jira = '', triggeredBy = '') {
    try {
      // Get the template details to include module information
      const templates = await this.getTemplates();
      const template = templates.find(t => t.name === templateName);

      if (!template) {
        throw new Error(`Template ${templateName} not found`);
      }

      logger.info(`Triggering template deployment workflow for template ${templateName}, project ${projectName} in ${environment}`);

      // Convert numeric project age to the expected string format
      let ageString;
      if (projectAge <= 3) {
        ageString = "3 days";
      } else if (projectAge <= 30) {
        ageString = "1 month";
      } else {
        ageString = "3 months";
      }

      // Trigger the workflow directly with all parameters as inputs
      // Get service catalog branch from environment variable
      const serviceCatalogBranch = process.env.SERVICE_CATALOG_BRANCH || 'main';

      const result = await githubService.triggerWorkflow(
        config.github.serviceRepo,
        'self-service-deploy-application.yml',
        serviceCatalogBranch,  // Use configured branch for workflow dispatch
        {
          project_name: projectName,
          project_desc: descriptiveName, // Changed from descriptive_name to project_desc
          owner: owner,
          environment: environment,
          template_application: templateName,
          jira: jira,  // Pass the Jira/CR number from the form
          age: ageString,
          correlation_id: correlationId,
          triggered_by: triggeredBy // Authenticated user email for PR description
        }
      );

      logger.info(`Template deployment workflow triggered for ${projectName} with correlation ID: ${correlationId}`);

      // We will only add database entries after PR is merged, not when workflow is triggered

      return {
        success: true,
        correlationId: correlationId,
        message: `Workflow triggered successfully. Correlation ID: ${correlationId}`
      };
    } catch (error) {
      logger.error(`Failed to trigger template deployment workflow: ${error.message}`);
      throw error;
    }
  }

  /**
  * Delete infrastructure by directly triggering a workflow
  */  async deleteInfrastructure(projectName, environment, correlationId, triggeredBy = '') {
   try {
     // Generate correlation ID if not provided (for internal tracking only)
     if (!correlationId) {
       correlationId = uuidv4();
     }

     logger.info(`Triggering infrastructure deletion workflow for ${projectName} in ${environment}`);

     // Trigger the workflow with project_name, environment, and correlation_id parameters
     // Get service catalog branch from environment variable
     const serviceCatalogBranch = process.env.SERVICE_CATALOG_BRANCH || 'main';

     const result = await githubService.triggerWorkflow(
       config.github.serviceRepo,
       'catalog-delete.yml',
       serviceCatalogBranch,  // Use configured branch for workflow dispatch
       {
         project_name: projectName,
         environment: environment,
         correlation_id: correlationId, // Still pass correlation ID for internal tracking
         triggered_by: triggeredBy // Authenticated user email for PR description
       }
     );

     logger.info(`Infrastructure deletion workflow triggered for ${projectName} with correlation ID: ${correlationId}`);

     return {
       success: true,
       message: `Deletion request submitted successfully for ${projectName} in ${environment}.`
     };
   } catch (error) {
     logger.error(`Failed to trigger infrastructure deletion workflow: ${error.message}`);
     throw error;
   }
 }

  /**
   * Generate env.hcl content with metadata
   */
  _generateEnvHcl(projectName, owner, crNumber, projectAge) {
    return `# Environment configuration for ${projectName}
# Generated by Self-Service Infrastructure Catalog

locals {
  project_name = "${projectName}"
  extra_tags = {
    Owner = "${owner}"
    CR = "${crNumber}"
    ProjectAge = "${projectAge}"
    CreatedBy = "self-service-catalog"
    CreatedAt = "${new Date().toISOString()}"
  }
}
`;
  }

  /**
   * Normalize modules data to ensure consistent format
   * @param {string|Array} modules - The modules data from metadata
   * @returns {Array} - Array of module names
   */
  _normalizeModules(modules) {
    if (!modules) {
      return [];
    }

    // If it's already an array, return it
    if (Array.isArray(modules)) {
      // If it's an array of objects with name property, extract names
      if (modules.length > 0 && typeof modules[0] === 'object' && modules[0].name) {
        return modules.map(m => this._stripQuotes(m.name));
      }
      return modules.map(m => this._stripQuotes(m));
    }

    // If it's a string, split by comma
    if (typeof modules === 'string') {
      return modules.split(',').map(m => this._stripQuotes(m));
    }

    // Default to empty array if unknown format
    return [];
  }

  /**
   * Submit agent-based infrastructure change request
   * @param {Object} params - The change request parameters
   * @param {string} params.agentName - Name of the agent to use
   * @param {Object} params.inputs - User-provided input values
   * @param {string} params.correlationId - Correlation ID for tracking
   * @param {string} params.triggeredBy - Entra ID email of the requesting user (optional)
   * @param {string} params.jiraTicket - Jira ticket reference (optional)
   * @returns {Promise<Object>} - Result with workflow URL
   */
  async submitAgentChange({ agentName, inputs, correlationId, triggeredBy = '', jiraTicket = '' }) {
    try {
      logger.info(`[${correlationId}] Submitting agent change: ${agentName}`);

      // Load agent definitions
      const agentsList = await this.getAgents();
      const agent = agentsList.find(a => a.agentName === agentName);

      if (!agent) {
        throw new Error(`Agent not found: ${agentName}`);
      }

      logger.info(`[${correlationId}] Found agent: ${agent.agentName}, building prompt`);

      // Build the prompt using prompt builder utility
      const { buildAgentPrompt, validateRequiredInputs } = require('../utils/promptBuilder');

      // Validate required inputs
      const validation = validateRequiredInputs(agent, inputs);
      if (!validation.valid) {
        throw new Error(`Missing required fields: ${validation.missingFields.join(', ')}`);
      }

      // Build the prompt
      const prompt = buildAgentPrompt({
        agent,
        formData: inputs,
        correlationId
      });

      logger.info(`[${correlationId}] Prompt built, length: ${prompt.length} characters`);

      // Trigger the agent dispatch workflow
      const result = await githubService.triggerAgentDispatch(
        agentName,
        prompt,
        correlationId,
        triggeredBy,
        jiraTicket
      );

      logger.info(`[${correlationId}] Agent dispatch workflow triggered successfully`);

      return {
        success: true,
        workflowUrl: result.workflowUrl,
        correlationId,
        message: `Infrastructure change request submitted using ${agentName} agent`
      };

    } catch (error) {
      logger.error(`[${correlationId}] Failed to submit agent change: ${error.message}`, {
        error,
        agentName,
        correlationId
      });
      throw error;
    }
  }

  /**
   * Generate terragrunt.hcl content for a module
   */
  _generateTerragruntHcl(moduleName, environment) {
    return `# Terragrunt configuration for ${moduleName}
# Generated by Self-Service Infrastructure Catalog

include {
  path = find_in_parent_folders()
}

terraform {
  source = "git::https://github.com/example/terraform-modules.git//modules/${moduleName}?ref=v1.0.0"
}

inputs = {
  environment = "${environment}"

  # Default module configuration
  # These values should be customized as needed
}
`;
  }

  /**
   * Get application details by project name and environment
   * @param {string} projectName - The name of the project
   * @param {string} environment - The environment (e.g., 'dev', 'test', 'prod')
   * @returns {Promise<Object|null>} - The application details or null if not found
   */
  async getApplicationDetails(projectName, environment) {
    try {
      // Check if GitHub service is initialized
      if (!githubService.initialized) {
        await githubService.initialize();
      }

      // Get the repository details from config
      const [owner, repo] = config.github.serviceRepo.split('/');

      logger.info(`Fetching application details for ${projectName} in ${environment}`);

      // FR-007: Primary lookup — docs/metadata/{projectName}-{environment}.json (direct, no N+1)
      try {
        const { data: fileData } = await githubService.octokit.rest.repos.getContent({
          owner,
          repo,
          path: `docs/metadata/${projectName}-${environment}.json`
        });

        // Decode content from base64
        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        const appData = JSON.parse(content);

        logger.info(`Found metadata via primary path for ${projectName}-${environment}`);
        return this._normalizeAppDetails(appData);
      } catch (fileError) {
        // HTTP 404 means not found — fall through to directory scan
        if (fileError.status !== 404) {
          throw fileError;
        }
        logger.info(`No primary match for ${projectName}-${environment}.json, searching all files in docs/metadata`);
      }

      // FR-007: Fallback — full directory scan (legacy files without env suffix)
      const { data: contents } = await githubService.octokit.rest.repos.getContent({
        owner,
        repo,
        path: 'docs/metadata'
      });

      // Filter for JSON files
      const jsonFiles = contents.filter(file =>
        file.type === 'file' && file.name.endsWith('.json')
      );

      // Search through each file
      for (const file of jsonFiles) {
        try {
          // Get file content
          const { data: fileData } = await githubService.octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.path
          });

          // Decode content from base64
          const content = Buffer.from(fileData.content, 'base64').toString('utf8');
          const appData = JSON.parse(content);

          // Check if this is the app we're looking for (both old and new field names)
          const name = appData.projectName || appData.project;
          if (name === projectName && appData.environment === environment) {
            return this._normalizeAppDetails(appData);
          }
        } catch (parseError) {
          logger.error(`Error parsing metadata file ${file.name}: ${parseError.message}`);
        }
      }

      // If we get here, no matching application was found
      logger.warn(`No application found with name ${projectName} in ${environment}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get application details: ${error.message}`);
      return null;
    }
  }

  /**
   * Normalize raw metadata JSON into the canonical AppDetails shape.
   * Used by getApplicationDetails() so both primary-path and fallback-scan
   * return the same structure.
   * @param {Object} appData - Raw parsed JSON from docs/metadata
   * @returns {Object} Normalized app details
   */
  _normalizeAppDetails(appData) {
    return {
      name: this._stripQuotes(appData.projectName || appData.project),
      environment: appData.environment,
      description: this._stripQuotes(appData.description || appData.meta?.description || ''),
      owner: this._stripQuotes(appData.owner || appData.meta?.owner || ''),
      lifecycle: appData.lifecycle || appData.meta?.lifecycle || 'experimental',
      modules: this._normalizeModules(appData.modules),
      rbacPairs: this._normalizeRbacPairs(appData.rbac_pairs || appData.rbacPairs),
      costCenter: appData.tags?.costCenter || appData.meta?.cost_center || 'self-service',
      commitSha: appData.meta?.commit_sha || appData.commitSha || '',
      deployedAt: appData.createdAt || appData.meta?.deployed_at || appData.timestamp || ''
    };
  }

  /**
   * Strip a single layer of matching leading/trailing quote characters (" or ')
   * left over from upstream metadata that was shell/JSON double-encoded before
   * being written to docs/metadata/*.json. Only strips when both ends match,
   * so legitimate values (e.g. names containing an apostrophe) are untouched.
   * @param {string} value
   * @returns {string}
   */
  _stripQuotes(value) {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return trimmed.slice(1, -1).trim();
      }
    }
    return trimmed;
  }

  /**
   * Normalize RBAC pair metadata for frontend restore flow.
   *
   * Canonical metadata format is an array of pipe-delimited strings:
   *   "sourceModule|targetModule|Role Name"
   * (e.g. "appServiceWindows|keyvault|Key Vault Secrets User")
   *
   * Object form (sourceName/targetName/role) is also accepted for forward
   * compatibility and existing test fixtures.
   *
   * @param {Array} rbacPairs
   * @returns {Array<{id: string, sourceId: string, sourceName: string, targetId: string, targetName: string, role: string, description?: string}>}
   */
  _normalizeRbacPairs(rbacPairs) {
    if (!Array.isArray(rbacPairs)) {
      return [];
    }

    return rbacPairs
      .map((pair, index) => {
        let sourceName = '';
        let targetName = '';
        let role = '';
        let sourceId = '';
        let targetId = '';
        let id = '';
        let description;

        if (typeof pair === 'string') {
          const parts = pair.split('|').map(p => this._stripQuotes(p));
          if (parts.length < 3) {
            return null;
          }
          [sourceName, targetName, role] = parts;
        } else if (pair && typeof pair === 'object') {
          sourceName = this._stripQuotes(String(pair.sourceName || pair.source || pair.principal || ''));
          targetName = this._stripQuotes(String(pair.targetName || pair.target || pair.scope || ''));
          role = this._stripQuotes(String(pair.role || pair.roleName || ''));
          sourceId = this._stripQuotes(String(pair.sourceId || pair.source_id || ''));
          targetId = this._stripQuotes(String(pair.targetId || pair.target_id || ''));
          id = this._stripQuotes(String(pair.id || ''));
          description = pair.description || undefined;
        } else {
          return null;
        }

        if (!sourceName || !targetName || !role) {
          return null;
        }

        return {
          id: id || `prefill-rbac-${index + 1}`,
          sourceId: sourceId || sourceName,
          sourceName,
          targetId: targetId || targetName,
          targetName,
          role,
          description: description || undefined
        };
      })
      .filter(Boolean);
  }

  /**
   * Environment folders a developer may copy into infrastructure-live (data/infraLiveEnvironments.json)
   * @returns {string[]}
   */
  getInfraLiveEnvironments() {
    const file = path.join(__dirname, '../data/infraLiveEnvironments.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')).targets;
  }

  /**
   * Promote an application to infrastructure-live by triggering the move-to-infralive workflow
   * @param {string} projectName - The name of the project
   * @param {string} environment - The source environment folder in service-catalog (e.g. 'devsand')
   * @param {string} crNumber - The Change Request number for production deployment
   * @param {string} correlationId - Optional correlation ID for tracking
   * @param {string} triggeredBy - Authenticated user email
   * @param {string[]} targetEnvironments - Environment folders to generate from the source environment
   * @returns {Promise<Object>} - The result of the workflow trigger
   */
  async promoteToProduction(projectName, environment, crNumber, correlationId, triggeredBy = '', targetEnvironments = []) {
    try {
      // Generate correlation ID if not provided (for internal tracking only)
      if (!correlationId) {
        correlationId = uuidv4();
      }

      logger.info(`Triggering production promotion workflow for ${projectName} from ${environment} with CR: ${crNumber}`);

      // Trigger the workflow with the required input parameters
      // Note: The workflow requires application_folder and cr_number parameters
      const result = await githubService.triggerWorkflow(
        config.github.serviceRepo,
        'move-to-infralive.yaml',
        'main',
        {
          application_folder: projectName,
          source_environment: environment,
          target_environments: targetEnvironments.join(','),
          cr_number: crNumber,
          correlation_id: correlationId, // Still pass correlation ID for internal tracking
          triggered_by: triggeredBy // Authenticated user email for PR description
        }
      );

      logger.info(`Production promotion workflow triggered for ${projectName} (${environment}) with CR: ${crNumber}, correlation ID: ${correlationId}`);

      return {
        success: true,
        projectName: projectName,
        environment: environment,
        crNumber: crNumber,
        targetEnvironments: targetEnvironments,
        message: `Move to infrastructure-live submitted for ${projectName} (${environment} -> ${targetEnvironments.join(', ')}).`
      };
    } catch (error) {
      logger.error(`Failed to trigger production promotion workflow: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new InfrastructureService();
