import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const catalog = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(catalog, '.github/workflows/scripts');
const templates = ['webapp-storage', 'webapp-basic', 'webapp-full'];
function temporary(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-iac-'));
  try { run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function execute(script, cwd, variables) {
  return execFileSync(process.execPath, [path.join(scripts, script)], {
    cwd, env: { ...process.env, GITHUB_OUTPUT: '', ...variables }, encoding: 'utf8', stdio: 'pipe'
  });
}

test('all templates preserve resource locals when deployment metadata is generated', () => temporary(directory => {
  for (const template of templates) {
    const destination = path.join(directory, 'infrastructure', template, 'devsand');
    fs.cpSync(path.join(catalog, '_templates', template), destination, { recursive: true });
    const original = fs.readFileSync(path.join(destination, 'env.hcl'), 'utf8');
    execute('generate_template_metadata.mjs', directory, {
      PROJECT_NAME: template, ENVIRONMENT: 'devsand', PROJECT_DESC: 'quoted "description"', OWNER: 'Example User'
    });
    assert.equal(fs.readFileSync(path.join(destination, 'env.hcl'), 'utf8'), original);
    const metadata = JSON.parse(fs.readFileSync(path.join(destination, 'metadata.json')));
    assert.equal(metadata.app_metadata.description, 'quoted "description"');
    assert.equal(metadata.project, template);
  }
}));

test('metadata rejects path traversal', () => temporary(directory => {
  assert.throws(() => execute('generate_template_metadata.mjs', directory, {
    PROJECT_NAME: '../escape', ENVIRONMENT: 'dev'
  }));
}));

test('template common-local references exist in shared configuration', () => {
  const common = fs.readFileSync(path.join(catalog, 'infrastructure/common.hcl'), 'utf8');
  const declared = new Set([...common.matchAll(/^\s*([A-Za-z_]\w*)\s*=/gm)].map(match => match[1]));
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.hcl')) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/local\.common_(?:vars|locals)\.locals\.(\w+)/g)) {
          assert.ok(declared.has(match[1]), `${file}: missing common local ${match[1]}`);
        }
        if (entry.name === 'terragrunt.hcl') {
          const environment = fs.readFileSync(path.join(path.dirname(directory), 'env.hcl'), 'utf8');
          const environmentLocals = new Set([...environment.matchAll(/^\s*([A-Za-z_]\w*)\s*=/gm)].map(match => match[1]));
          for (const match of source.matchAll(/local\.config\.locals\.(\w+)/g)) {
            assert.ok(environmentLocals.has(match[1]), `${file}: missing environment local ${match[1]}`);
          }
        }
        if (entry.name === 'terragrunt.hcl') {
          assert.match(source, /find_in_parent_folders\("root\.hcl"\)/);
          assert.doesNotMatch(source, /organization\/terraform-modules/);
        }
      }
    }
  }
  walk(path.join(catalog, '_templates'));
});

test('manual selection distinguishes live and retired stacks and rejects traversal', () => temporary(directory => {
  for (const prefix of ['infrastructure', 'recycle-bin']) {
    const stack = `${prefix}/demo/dev`;
    fs.mkdirSync(path.join(directory, stack), { recursive: true });
    const output = execute('select_iac_stacks.mjs', directory, { MANUAL_DIRECTORY: stack });
    const selected = JSON.parse(output.split('\n')[0].slice('stacks='.length));
    assert.equal(selected[0].retired, prefix === 'recycle-bin');
  }
  assert.throws(() => execute('select_iac_stacks.mjs', directory, { MANUAL_DIRECTORY: '../escape' }));
}));

test('shared configuration changes select every live stack', () => temporary(directory => {
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  for (const app of ['first', 'second']) {
    fs.mkdirSync(path.join(directory, `infrastructure/${app}/dev/resourcegroups`), { recursive: true });
    fs.writeFileSync(path.join(directory, `infrastructure/${app}/dev/resourcegroups/terragrunt.hcl`), 'terraform {}\n');
  }
  fs.writeFileSync(path.join(directory, 'infrastructure/common.hcl'), 'locals {}\n');
  git(['add', '.']); git(['commit', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  fs.appendFileSync(path.join(directory, 'infrastructure/common.hcl'), '\n');
  git(['add', '.']); git(['commit', '-m', 'shared change']);
  assert.match(execute('select_iac_stacks.mjs', directory, { BASE_SHA: base, MANUAL_DIRECTORY: '' }), /count=2/);
  assert.match(execute('select_iac_stacks.mjs', directory, { BASE_SHA: '0'.repeat(40), MANUAL_DIRECTORY: '' }), /count=2/);
}));

test('plans cannot auto-approve and writes retain backend locking', () => temporary(directory => {
  const bin = path.join(directory, 'bin');
  const log = path.join(directory, 'calls.jsonl');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(directory, 'infrastructure/demo/dev'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'terragrunt'), '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.TEST_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n', { mode: 0o755 });
  for (const [operation, retired, command] of [['plan', 'false', 'plan'], ['apply', 'false', 'apply'], ['apply', 'true', 'destroy']]) {
    execFileSync('bash', [path.join(scripts, 'run_terraform.sh')], {
      cwd: directory,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log, OPERATION: operation,
        STACK_DIRECTORY: 'infrastructure/demo/dev', STACK_RETIRED: retired, REMOVAL_REQUESTS: '[]', PLAN_OUTPUT_ROOT: '' },
      stdio: 'pipe'
    });
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const argumentsList = calls.at(-1);
    assert.ok(argumentsList.includes(command));
    assert.ok(argumentsList.includes('-lock-timeout=5m'));
    assert.ok(!argumentsList.includes('-lock=false'));
    assert.equal(argumentsList.includes('-auto-approve'), operation !== 'plan');
  }
}));

test('recorded removals target only source-commit modules and plan without approving destruction', () => temporary(directory => {
  const git = argumentsList => execFileSync('git', argumentsList, { cwd: directory, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.com']);
  const stack = 'infrastructure/demo/dev';
  for (const module of ['resourcegroups', 'storagev2']) {
    fs.mkdirSync(path.join(directory, stack, module), { recursive: true });
    fs.writeFileSync(path.join(directory, stack, module, 'terragrunt.hcl'), 'terraform {}\n');
  }
  git(['add', '.']); git(['commit', '-m', 'source']);
  const sourceCommit = git(['rev-parse', 'HEAD']);
  fs.rmSync(path.join(directory, stack, 'storagev2'), { recursive: true });
  const requestPath = `${stack}/.module-removals/1.json`;
  fs.mkdirSync(path.dirname(path.join(directory, requestPath)), { recursive: true });
  const request = { version: 1, project: 'demo', environment: 'dev', source_commit: sourceCommit, removed_modules: ['storagev2'] };
  fs.writeFileSync(path.join(directory, requestPath), JSON.stringify(request));
  git(['add', '.']); git(['commit', '-m', 'removed']);
  const list = path.join(directory, 'requests.txt');
  fs.writeFileSync(list, `${requestPath}\n`);
  const bin = path.join(directory, 'bin');
  const log = path.join(directory, 'calls.jsonl');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'terragrunt'), '#!/usr/bin/env node\nconst args=process.argv.slice(2);if(args.includes("--help")){console.log("--queue-include-dir");}else{require("node:fs").appendFileSync(process.env.TEST_LOG,JSON.stringify(args)+"\\n");}\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log, PLAN_OUTPUT_ROOT: '' };
  for (const operation of ['plan', 'destroy']) {
    execFileSync('bash', [path.join(scripts, 'destroy_removed_modules.sh'), list, directory, operation], { env, stdio: 'pipe' });
    const call = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1));
    assert.ok(call.includes('./storagev2'));
    assert.ok(!call.includes('./resourcegroups'));
    assert.ok(call.includes('-lock-timeout=5m'));
    assert.equal(call.includes('-auto-approve'), operation === 'destroy');
    if (operation === 'plan') assert.ok(call.includes('-destroy'));
  }
  request.removed_modules = ['resourcegroups'];
  fs.writeFileSync(path.join(directory, requestPath), JSON.stringify(request));
  assert.throws(() => execFileSync('bash', [path.join(scripts, 'destroy_removed_modules.sh'), list, directory, 'destroy'], { env, stdio: 'pipe' }));
}));
test('plan scan checks every JSON plan and fails on missing plans or scanner failures', () => temporary(directory => {
  const bin = path.join(directory, 'bin');
  const plans = path.join(directory, 'plans');
  const log = path.join(directory, 'scans.log');
  fs.mkdirSync(bin);
  fs.mkdirSync(plans);
  fs.writeFileSync(path.join(bin, 'checkov'), '#!/usr/bin/env node\nconst fs = require("node:fs"); fs.appendFileSync(process.env.TEST_LOG, process.argv[3] + "\\n"); if (process.argv[3].includes("bad.json")) process.exit(1);\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log };
  const run = () => execFileSync('bash', [path.join(scripts, 'scan_plans.sh'), plans], { env, stdio: 'pipe' });
  assert.throws(run);
  fs.writeFileSync(path.join(plans, 'good.json'), '{}');
  run();
  fs.writeFileSync(path.join(plans, 'bad.json'), '{}');
  assert.throws(run);
  const scanned = fs.readFileSync(log, 'utf8');
  assert.match(scanned, /good\.json/);
  assert.match(scanned, /bad\.json/);
}));
