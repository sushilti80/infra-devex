import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const safeName = /^[a-z0-9][a-z0-9-]{0,39}$/;
const hclString = value => JSON.stringify(value).replace(/\$\{|%\{/g, match => match[0] + match);
const csv = value => [...new Set(String(value || '').split(',').map(v => v.trim()).filter(Boolean))];

export function generateRequest(options) {
  const project = String(options.project || '').toLowerCase();
  const environment = String(options.environment || '').toLowerCase();
  if (!safeName.test(project) || !safeName.test(environment)) throw new Error('Invalid project or environment');
  if (!/^[0-9a-f]{40}$/i.test(options.commit || '')) throw new Error('Invalid source commit');
  for (const field of ['description', 'owner', 'moduleVersion']) {
    if (typeof options[field] !== 'string' || options[field].length > 512 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(options[field])) throw new Error(`Invalid ${field}`);
  }
  const modules = csv(options.modules);
  const rbacPairs = csv(options.rbacPairs);
  const repository = path.resolve(options.repository);
  const envDir = path.join(repository, 'infrastructure', project, environment);
  const metadataPath = path.join(repository, 'docs', 'metadata', `${project}-${environment}.json`);
  let data = { project, environment, modules: [], rbac_pairs: [], commitshas: [], version: '0.0', meta: {} };
  if (fs.existsSync(metadataPath)) data = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (!Array.isArray(data.commitshas)) throw new Error('Invalid existing metadata commit history');
  const meta = { name: options.project, description: options.description, owner: options.owner, commit_sha: options.commit,
    deployed_at: options.timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), cost_center: 'self-service', lifecycle: 'experimental', environment };
  const fields = Object.entries(meta).map(([key, value]) => `    ${key} = ${hclString(value)}`).join('\n');
  const hcl = `locals {\n  common_vars = read_terragrunt_config(find_in_parent_folders("common.hcl"))\n  envName = "\u0024{basename(dirname(get_original_terragrunt_dir()))}"\n  parentdir = "\u0024{get_terragrunt_dir()}/../"\n  prefix = lower(basename(dirname(local.parentdir)))\n  currentsubID = lookup(local.common_vars.locals.subscriptions, local.envName, "")\n  module_version = ${hclString(options.moduleVersion)}\n  location = local.common_vars.locals.location\n  alias = local.common_vars.locals.alias\n  app_metadata = {\n${fields}\n  }\n  extra_tags = local.app_metadata\n}\n`;
  data.project = project;
  data.environment = environment;
  data.modules = modules;
  data.rbac_pairs = rbacPairs;
  if (!data.commitshas.includes(options.commit)) data.commitshas.push(options.commit);
  data.version = `${data.commitshas.length}.0`;
  data.meta = meta;
  fs.mkdirSync(envDir, { recursive: true });
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(path.join(envDir, 'env.hcl'), hcl);
  fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2) + '\n');
  return { envDir, metadataPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    generateRequest({ repository: process.cwd(), project: process.env.PROJECT_NAME, environment: process.env.ENVIRONMENT,
      description: process.env.PROJECT_DESC || '', owner: process.env.OWNER || '', moduleVersion: process.env.MODULE_VERSION || 'main',
      modules: process.env.MODULES || '', rbacPairs: process.env.RBAC_PAIRS || '', commit: process.env.GITHUB_SHA });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
