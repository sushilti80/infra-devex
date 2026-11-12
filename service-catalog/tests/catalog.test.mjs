import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generate } from '../catalog/generate.mjs';

function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-devex-catalog-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('storage generation includes the pinned resource group dependency', () => fixture(repository => {
  const request = { repository, project: 'demo', environment: 'dev', modules: 'storageV2' };
  assert.deepEqual(generate(request), ['resourceGroups', 'storageV2']);
  const root = path.join(repository, 'infrastructure/demo/dev');
  const rg = fs.readFileSync(path.join(root, 'resourcegroups/terragrunt.hcl'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'storagev2/terragrunt.hcl'), 'utf8');
  assert.match(rg, /ref=4c7e926d9aa11000d7c31a6b4c26100371b2ac62/);
  assert.match(storage, /ref=226f9bbefcc9299ad46f6263fc9005edb39a38e5/);
  assert.match(storage, /parent_id\s*= dependency\.resource_group\.outputs\.resource_id/);
  assert.match(storage, /name\s*= "[a-z0-9]{3,24}"/);
  assert.deepEqual(generate(request), ['resourceGroups', 'storageV2']);
}));
test('rejects invalid paths, unknown modules, and existing unmanaged infrastructure', () => fixture(repository => {
  const base = { repository, project: 'demo', environment: 'dev', modules: 'storageV2' };
  assert.throws(() => generate({ ...base, project: '../escape' }));
  assert.throws(() => generate({ ...base, modules: 'unknown' }));
  const original = path.join(repository, 'infrastructure/demo/dev/storagev2/terragrunt.hcl');
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, '# existing configuration\n');
  assert.throws(() => generate(base), /not managed/);
  assert.equal(fs.readFileSync(original, 'utf8'), '# existing configuration\n');
  assert.equal(fs.existsSync(path.join(repository, 'infrastructure/demo/dev/resourcegroups')), false);
}));
