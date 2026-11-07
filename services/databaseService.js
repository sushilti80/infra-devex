const logger = require('../utils/logger');

/**
 * Mock Database Service - No database integration required
 */
class DatabaseService {
  constructor() {
    this.applications = [];
    this.nextId = 1;
    logger.info('Mock database service initialized - No database integration required');
  }

  /**
   * Get all deployed applications
   * @returns {Promise<Array>} Array of application objects
   */
  async getDeployedApplications() {
    logger.info('Returning mock application data (no database required)');
    return this.applications.filter(app => app.status === 'active');
  }

  /**
   * Get a deployed application by ID
   * @param {number} id - Application ID
   * @returns {Promise<Object|null>} Application object or null if not found
   */
  async getDeployedApplicationById(id) {
    const app = this.applications.find(app => app.id === id);
    if (!app) {
      return null;
    }
    return { ...app };
  }

  /**
   * Create a new deployed application
   * @param {Object} applicationData - Application data
   * @returns {Promise<number>} Application ID
   */
  async createDeployedApplication(applicationData) {
    const id = this.nextId++;

    const newApp = {
      id,
      project_name: applicationData.projectName,
      environment: applicationData.environment,
      owner: applicationData.owner,
      template_name: applicationData.templateName,
      correlation_id: applicationData.correlationId,
      workflow_run_id: applicationData.workflowRunId,
      workflow_url: applicationData.workflowUrl,
      pr_number: null,
      pr_url: null,
      lifecycle_phase: 'experimental',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      modules: applicationData.modules ? applicationData.modules.map(m => ({
        id: Math.random().toString(36).substr(2, 9),
        module_name: m.name,
        module_version: m.version || '1.0.0',
        created_at: new Date().toISOString()
      })) : [],
      tags: applicationData.tags ? Object.entries(applicationData.tags).map(([key, value]) => ({
        id: Math.random().toString(36).substr(2, 9),
        tag_key: key,
        tag_value: value,
        created_at: new Date().toISOString()
      })) : []
    };

    this.applications.push(newApp);
    logger.info(`Mock application created with ID: ${id}`);

    return id;
  }

  /**
   * Update a deployed application with PR information
   * @param {string} correlationId - Correlation ID
   * @param {number} prNumber - PR number
   * @param {string} prUrl - PR URL
   * @returns {Promise<boolean>} Success status
   */
  async updateApplicationWithPR(correlationId, prNumber, prUrl) {
    const appIndex = this.applications.findIndex(app => app.correlation_id === correlationId);

    if (appIndex === -1) {
      logger.warn(`No application found with correlation ID: ${correlationId}`);
      return false;
    }

    this.applications[appIndex].pr_number = prNumber;
    this.applications[appIndex].pr_url = prUrl;
    this.applications[appIndex].updated_at = new Date().toISOString();

    logger.info(`Mock application updated with PR info: ${prNumber}`);
    return true;
  }

  /**
   * Request production transition for an application
   * @param {number} applicationId - Application ID
   * @param {string} requestedBy - User who requested the transition
   * @param {string} approvalTicket - Approval ticket ID
   * @param {string} notes - Additional notes
   * @returns {Promise<boolean>} Success status
   */
  async requestProductionTransition(applicationId, requestedBy, approvalTicket, notes) {
    const appIndex = this.applications.findIndex(app => app.id === applicationId);

    if (appIndex === -1) {
      logger.warn(`No application found with ID: ${applicationId}`);
      return false;
    }

    logger.info(`Production transition requested for app ID: ${applicationId} by ${requestedBy}`);
    return true;
  }

  /**
   * Approve production transition for an application
   * @param {number} transitionId - Transition ID
   * @param {string} approvedBy - User who approved the transition
   * @returns {Promise<boolean>} Success status
   */
  async approveProductionTransition(transitionId, approvedBy) {
    logger.info(`Production transition ${transitionId} approved by ${approvedBy}`);
    return true;
  }

  /**
   * Delete (mark as deleted) a deployed application
   * @param {number} applicationId - Application ID
   * @param {string} deletedBy - User who deleted the application
   * @param {string} correlationId - Correlation ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteApplication(applicationId, deletedBy, correlationId) {
    const appIndex = this.applications.findIndex(app => app.id === applicationId);

    if (appIndex === -1) {
      logger.warn(`No application found with ID: ${applicationId}`);
      return false;
    }

    this.applications[appIndex].status = 'deleted';
    this.applications[appIndex].updated_at = new Date().toISOString();

    logger.info(`Mock application ID ${applicationId} marked as deleted by ${deletedBy}`);
    return true;
  }

  /**
   * Create or update a deployed application record
   * @param {Object} appData - Application data
   * @returns {Promise<Object>} - The created or updated application record
   */
  async createOrUpdateDeployedApplication(appData) {
    const existingAppIndex = this.applications.findIndex(app =>
      app.correlation_id === appData.correlationId
    );

    if (existingAppIndex !== -1) {
      // Update existing application
      const appId = this.applications[existingAppIndex].id;

      this.applications[existingAppIndex] = {
        ...this.applications[existingAppIndex],
        status: appData.status || 'deployed',
        pr_number: appData.prNumber,
        pr_url: appData.prUrl,
        workflow_run_id: appData.workflowRunId,
        lifecycle_phase: appData.lifecyclePhase || 'experimental',
        updated_at: new Date().toISOString()
      };

      logger.info(`Mock application updated with ID: ${appId}`);
      return this.getDeployedApplicationById(appId);
    } else {
      // Create new application
      const id = this.nextId++;

      const newApp = {
        id,
        project_name: appData.projectName,
        environment: appData.environment || 'development',
        owner: appData.owner,
        status: appData.status || 'deployed',
        correlation_id: appData.correlationId,
        workflow_run_id: appData.workflowRunId,
        pr_number: appData.prNumber,
        pr_url: appData.prUrl,
        lifecycle_phase: appData.lifecyclePhase || 'experimental',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        modules: appData.modules ? appData.modules.map(m => ({
          id: Math.random().toString(36).substr(2, 9),
          module_name: m.name || m.module_name,
          module_version: m.version || m.module_version || '1.0.0',
          created_at: new Date().toISOString()
        })) : [],
        tags: appData.tags ? Object.entries(appData.tags).map(([key, value]) => ({
          id: Math.random().toString(36).substr(2, 9),
          tag_key: key,
          tag_value: value,
          created_at: new Date().toISOString()
        })) : []
      };

      this.applications.push(newApp);
      logger.info(`Mock application created with ID: ${id}`);

      return newApp;
    }
  }
}

module.exports = new DatabaseService();
