import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateRequest } from '../.github/workflows/scripts/generate_request.mjs';

test('workflow treats dispatch inputs as data instead of interpolating them into shell', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/self-service-custom-infra.yml', import.meta.url), 'utf8');
  const scriptBlocks = [...workflow.matchAll(/^ {8}run: \|\n((?: {10,}.*\n|\n)*)/gm)];
  assert.ok(scriptBlocks.length > 0);
  for (const [, script] of scriptBlocks) assert.doesNotMatch(script, /\$\{\{\s*(?:inputs|github\.event\.inputs)\./);
  assert.match(workflow, /node \.github\/workflows\/scripts\/generate_request\.mjs/);
});

test('generates subscription-independent HCL and metadata with untrusted values as data', () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-request-'));
  try {
    const request = { repository, project: 'app', environment: 'dev', owner: 'name "test"', description: '$(touch bad) ${danger} %{if x}\nnext', moduleVersion: 'main', modules: 'storageV2', rbacPairs: '', commit: 'a'.repeat(40), timestamp: '2026-01-01T00:00:00Z' };
    const result = generateRequest(request);
    const hcl = fs.readFileSync(path.join(result.envDir, 'env.hcl'), 'utf8');
    assert.match(hcl, /lookup\(local.common_vars.locals.subscriptions, local.envName, ""\)/);
    assert.ok(hcl.includes('$${danger}'));
    assert.ok(hcl.includes('%%{if x}'));
    assert.equal(JSON.parse(fs.readFileSync(result.metadataPath, 'utf8')).meta.description, request.description);
    assert.equal(fs.existsSync(path.join(repository, 'bad')), false);
    generateRequest(request);
    assert.equal(JSON.parse(fs.readFileSync(result.metadataPath, 'utf8')).version, '1.0');
    assert.throws(() => generateRequest({ ...request, project: '../bad' }));
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});
