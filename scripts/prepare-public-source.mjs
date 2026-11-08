import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const sourceRepo = args.find(arg => arg.startsWith('--catalog='))?.slice(10);
const assetsOnly = args.includes('--assets-only');
const scope = args.find(arg => arg.startsWith('--scope='))?.slice(8);
const replacements = args.filter(arg => arg.startsWith('--replace=')).map(arg => {
  const pair = arg.slice(10);
  const separator = pair.indexOf('=');
  if (separator < 1) throw new Error('Use --replace=SOURCE=REPLACEMENT');
  return [pair.slice(0, separator), pair.slice(separator + 1)];
});
const redact = text => replacements.reduce((value, [source, replacement]) =>
  value.replaceAll(source, replacement), text);
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
let changed = 0;
for (const file of new Set(tracked)) {
  if (scope && !file.startsWith(scope + '/')) continue;
  if (!fs.existsSync(file) || file === 'package-lock.json') continue;
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) continue;
  const original = buffer.toString('utf8');
  const updated = redact(original);
  if (original !== updated) {
    fs.writeFileSync(file, updated);
    changed += 1;
  }
  const renamed = redact(file);
  if (renamed !== file) fs.renameSync(file, renamed);
}
if (args.includes('--remove-screenshots')) {
  for (const file of tracked.filter(file => /^docs\/screens\/.*\.(png|jpe?g|webp)$/i.test(file))) {
    fs.rmSync(file, { force: true });
  }
}
if (sourceRepo) {
  const api = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
  }));
  const commit = api(`repos/${sourceRepo}/commits/main`).sha;
  const tree = api(`repos/${sourceRepo}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new Error('Incomplete source tree; refusing a partial import');
  const files = tree.tree.filter(entry => entry.type === 'blob' && (assetsOnly ? (
    entry.path.startsWith('_templates/') ||
    /^infrastructure\/(common|common_errors|root)\.hcl$/.test(entry.path) ||
    entry.path === 'infrastructure/remote_state.yml'
  ) : (
    /^\.github\/(workflows|actions|scripts)\//.test(entry.path) ||
    /^\.pipelines\//.test(entry.path) ||
    /^tests\/test_.*\.py$/.test(entry.path) ||
    /^(terragrunt|root|common|global)\.hcl$/.test(entry.path)
  )) && !/(__pycache__|\.pyc$)/.test(entry.path));
  for (const file of files) {
    const blob = api(`repos/${sourceRepo}/git/blobs/${file.sha}`);
    let content = redact(Buffer.from(blob.content, 'base64').toString('utf8'))
      .replace(/[\t ]+$/gm, '').replace(/\s*$/, '\n');
    if (assetsOnly) {
      content = content.replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '00000000-0000-0000-0000-000000000000');
      if (file.path === 'infrastructure/common.hcl') {
        content = content.replace(/^(\s*)([A-Za-z_][\w]*)\s*=\s*"([^"\n]*)"/gm,
          (line, indent, key, value) => value.includes('${') || ['westus', 'westus3', 'eastus', 'eastus2'].includes(value)
            ? line : `${indent}${key} = get_env("CATALOG_${key.toUpperCase()}", "")`);
      }
      if (file.path === 'infrastructure/remote_state.yml') {
        content = content.replace(/^(\s*)(resource_group_name|storage_account_name):.*$/gm,
          '$1$2: REPLACE_WITH_YOUR_VALUE');
      }
    }
    const destination = path.join('service-catalog', redact(file.path));
    if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite ${destination}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  console.log(`Imported ${files.length} catalog workflow/support files at commit ${commit}`);
}
console.log(`Redacted ${changed} tracked text files`);