import fs from 'node:fs';
import path from 'node:path';

const project = (process.env.PROJECT_NAME || '').toLowerCase();
const environment = (process.env.ENVIRONMENT || '').toLowerCase();
if (!/^[a-z0-9_-]+$/.test(project) || !/^[a-z0-9_-]+$/.test(environment)) {
  throw new Error('Invalid project or environment');
}
const directory = path.join('infrastructure', project, environment);
if (!fs.existsSync(path.join(directory, 'env.hcl'))) {
  throw new Error('Template env.hcl is missing');
}
const metadata = {
  project,
  environment,
  app_metadata: {
    name: project,
    description: process.env.PROJECT_DESC || project,
    owner: process.env.OWNER || '',
    commit_sha: process.env.GITHUB_SHA || '',
    deployed_at: new Date().toISOString(),
    cost_center: 'self-service',
    lifecycle: 'experimental',
    environment
  }
};
fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');