import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const starter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = (name) => path.join('.github/workflows/scripts', name);

test('clean catalog generates and selects a reviewable stack without Azure or GitHub credentials', () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-devex-install-'));
  const env = { PATH: process.env.PATH, HOME: repository, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1' };
  const run = (command, args, extra = {}) => execFileSync(command, args, { cwd: repository, env: { ...env, ...extra }, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    for (const source of ['catalog', 'infrastructure', '.github/workflows/scripts']) {
      fs.cpSync(path.join(starter, source), path.join(repository, source), { recursive: true });
    }
    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.name', 'Example User']);
    run('git', ['config', 'user.email', 'example@example.com']);
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'starter']);
    const base = run('git', ['rev-parse', 'HEAD']);
    const request = { PROJECT_NAME: 'demo', ENVIRONMENT: 'dev', MODULES: 'storageV2', OWNER: 'Example User', PROJECT_DESC: 'Example infrastructure', MODULE_VERSION: 'main', GITHUB_SHA: base };
    run('node', ['catalog/generate.mjs'], request);
    run('python3', [script('reconcile_custom_infra.py'), '--project', 'demo', '--environment', 'dev', '--modules', 'storageV2', '--source-commit', base, '--run-id', '1', '--correlation-id', 'test']);
    run('node', [script('generate_request.mjs')], request);
    const stack = path.join(repository, 'infrastructure/demo/dev');
    for (const file of ['env.hcl', 'resourcegroups/terragrunt.hcl', 'storagev2/terragrunt.hcl']) assert.ok(fs.existsSync(path.join(stack, file)), file);
    const metadata = JSON.parse(fs.readFileSync(path.join(repository, 'docs/metadata/demo-dev.json'), 'utf8'));
    assert.deepEqual(metadata.modules, ['storageV2']);
    assert.equal(metadata.environment, 'dev');
    assert.match(fs.readFileSync(path.join(stack, 'env.hcl'), 'utf8'), /lookup\(local.common_vars.locals.subscriptions, local.envName, ""\)/);
    run('git', ['checkout', '-b', 'request-demo-dev']);
    run('git', ['add', '-A']);
    run('git', ['commit', '-m', 'generate proposal']);
    const selected = run('node', [script('select_iac_stacks.mjs')], { BASE_SHA: base });
    assert.match(selected, /"directory":"infrastructure\/demo\/dev"/);
    assert.match(selected, /count=1/);
    assert.equal(fs.existsSync(path.join(repository, '.terraform')), false);
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});
