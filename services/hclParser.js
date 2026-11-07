const { readFileSync } = require('fs');
const path = require('path');
const hclParser = require('hcl2-parser');
const config = require('../config');
const logger = require('../utils/logger');
const githubService = require('./githubService');

class HclParser {
  constructor() {
    this.octokit = githubService.octokit;
  }

  /**
   * Parse HCL content and extract application metadata
   * @param {string} content - HCL content to parse
   * @returns {Object|null} Extracted metadata or null if parsing fails
   */
  parseHclContent(content) {
    try {
      const parsed = hclParser.parseToObject(content);
      if (!parsed || parsed.length === 0) return null;

      // Extract the first module block as our app metadata
      const moduleBlock = parsed.find(block => block.module);
      if (!moduleBlock) return null;

      const appName = Object.keys(moduleBlock.module)[0];
      const appConfig = moduleBlock.module[appName];

      return {
        name: appName,
        source: appConfig.source,
        version: appConfig.version,
        // Add other metadata fields as needed
      };
    } catch (error) {
      logger.error('Error parsing HCL content:', error);
      return null;
    }
  }

  /**
   * Find all env.hcl files in the infrastructure directory
   * @param {string} repo - Repository name
   * @param {string} ref - Git reference (branch/tag)
   * @returns {Promise<Array>} Array of found env.hcl files
   */
  async findEnvHclFiles(repo, ref = process.env.SERVICE_CATALOG_BRANCH || 'main') {
    try {
      const org = config.github.serviceRepo.split('/')[0];
      const basePath = 'infrastructure';
      const allEnvFiles = [];

      logger.info(`🔍 Searching in ${org}/${repo}/${basePath}`);

      try {
        // List all directories in the infrastructure path
        const { data: items } = await this.octokit.repos.getContent({
          owner: org,
          repo,
          path: basePath,
          ref,
        });

        if (!Array.isArray(items)) {
          logger.warn(`Expected an array of items in ${basePath}`);
          return [];
        }

        const appDirs = items.filter(item => item.type === 'dir');
        logger.info(`📁 Found ${appDirs.length} application directories`);

        // TEMPORARY DEBUG: List contents of the first app directory
        if (appDirs.length > 0) {
          const firstAppDirPath = `${basePath}/${appDirs[0].name}`;
          logger.info(`[TEMP DEBUG] Listing contents of: ${firstAppDirPath}`);
          try {
            const { data: firstAppDirContents } = await this.octokit.repos.getContent({
              owner: org,
              repo,
              path: firstAppDirPath,
              ref,
            });
            logger.info(`[TEMP DEBUG] Contents of ${firstAppDirPath}: ${JSON.stringify(firstAppDirContents.map(item => ({ name: item.name, type: item.type, path: item.path })), null, 2)}`);
          } catch (e) {
            logger.error(`[TEMP DEBUG] Error listing contents of ${firstAppDirPath}: ${e.message}`);
          }
        }
        // END TEMPORARY DEBUG

        // Check each app directory for env.hcl
        for (const dir of appDirs) {
          const envFilePath = `${basePath}/${dir.name}/env.hcl`;
          logger.info(`🔍 Checking application: ${dir.name}...`);

          try {
            const { data: file } = await this.octokit.repos.getContent({
              owner: org,
              repo,
              path: envFilePath,
              ref,
            });

            if (file && file.name === 'env.hcl') {
              logger.info(`✅ Found env.hcl for application: ${dir.name}`);
              allEnvFiles.push({
                path: file.path,
                sha: file.sha,
                url: file.html_url,
                appName: dir.name
              });
            }
          } catch (error) {
            if (error.status === 404) {
              logger.warn(`❌ env.hcl not found at path: ${envFilePath} (404). GitHub API response: ${JSON.stringify(error.response?.data, null, 2)}`);
            } else {
              logger.error(`Error reading file ${envFilePath}. Status: ${error.status || 'N/A'}. Message: ${error.message}. Full error: ${JSON.stringify({
                requestPath: error.request?.url, // Log the actual URL requested by Octokit
                responseHeaders: error.response?.headers,
                responseData: error.response?.data
              }, null, 2)}`);
            }
          }
        }
      } catch (error) {
        if (error.status === 404) {
          logger.warn(`Infrastructure directory not found in ${repo}`);
        } else {
          logger.error('Error accessing repository:', error);
        }
        return [];
      }

      return allEnvFiles;
    } catch (error) {
      logger.error('Unexpected error in findEnvHclFiles:', error);
      return [];
    }
  }

  /**
   * Get all applications from a GitHub repository
   * @param {string} repo - Repository name (optional, defaults to service repo)
   * @param {string} ref - Git reference (branch/tag)
   * @returns {Promise<Array>} Array of application objects
   */
  async getApplicationsFromRepo(repo, ref = process.env.SERVICE_CATALOG_BRANCH || 'main') {
    try {
      // If repo is not provided, use the service repo from config
      const targetRepo = repo || config.github.serviceRepo;

      // If the repo is in 'org/repo' format, extract just the repo name
      const repoName = targetRepo.includes('/') ? targetRepo.split('/')[1] : targetRepo;
      const org = config.github.serviceRepo.split('/')[0];

      logger.info(`🔍 Searching for applications in ${targetRepo}@${ref}`);

      // Find all env.hcl files in the repository
      const envFiles = await this.findEnvHclFiles(repoName, ref);
      logger.info(`✅ Found ${envFiles.length} applications in ${targetRepo}@${ref}`);

      if (envFiles.length === 0) {
        return [];
      }

      // Parse each env.hcl file and extract application metadata
      const applications = [];
      for (const file of envFiles) {
        try {
          // Get the file content
          const { data: fileContent } = await this.octokit.repos.getContent({
            owner: org,
            repo: repoName,
            path: file.path,
            ref,
          });

          // Decode the content (it's base64 encoded)
          const content = Buffer.from(fileContent.content, 'base64').toString('utf8');

          // Parse the HCL content
          const appMetadata = this.parseHclContent(content);
          if (appMetadata) {
            applications.push({
              ...appMetadata,
              name: file.appName, // Use directory name as app name
              path: file.path,
              url: file.url,
              commitSha: file.sha,
            });
          }
        } catch (error) {
          logger.error(`Error processing ${file.path}:`, error);
        }
      }

      return applications;
    } catch (error) {
      logger.error('Error getting applications from repo:', error);
      throw error;
    }
  }
}

module.exports = new HclParser();
