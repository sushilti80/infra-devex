import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const sourceRepo = args.find(arg => arg.startsWith('--catalog='))?.slice(10);
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
  const files = tree.tree.filter(entry => entry.type === 'blob' && (
    /^\.github\/(workflows|actions|scripts)\//.test(entry.path) ||
    /^\.pipelines\//.test(entry.path) ||
    /^tests\/test_.*\.py$/.test(entry.path) ||
    /^(terragrunt|root|common|global)\.hcl$/.test(entry.path)
  ) && !/(__pycache__|\.pyc$)/.test(entry.path));
  for (const file of files) {
    const blob = api(`repos/${sourceRepo}/git/blobs/${file.sha}`);
    const content = redact(Buffer.from(blob.content, 'base64').toString('utf8'))
      .replace(/[\t ]+$/gm, '').replace(/\s*$/, '\n');
    const destination = path.join('service-catalog', redact(file.path));
    if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite ${destination}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  console.log(`Imported ${files.length} catalog workflow/support files at commit ${commit}`);
}
console.log(`Redacted ${changed} tracked text files`);