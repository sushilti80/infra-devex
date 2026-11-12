import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const safeStack = /^(infrastructure|recycle-bin)\/[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_-]*$/;
const manual = process.env.MANUAL_DIRECTORY;
const stacks = new Set();
let changed = [];
function add(directory) {
  if (!safeStack.test(directory) || !fs.existsSync(directory)) throw new Error(`Invalid stack: ${directory}`);
  const relative = path.relative(fs.realpathSync('.'), fs.realpathSync(directory));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Stack resolves outside repository');
  stacks.add(directory);
}
if (manual) {
  add(manual);
} else {
  const base = process.env.BASE_SHA;
  if (!/^[0-9a-f]{40}$/i.test(base || '')) throw new Error('A valid base commit is required');
  const argumentsList = /^0+$/.test(base) ? ['ls-files', '-z'] : ['diff', '--name-only', '-z', base, 'HEAD'];
  changed = execFileSync('git', argumentsList, { encoding: 'utf8' }).split('\0').filter(Boolean);
  if (changed.some(file => /^infrastructure\/[^/]+$/.test(file))) {
    for (const app of fs.readdirSync('infrastructure', { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      for (const environment of fs.readdirSync(`infrastructure/${app.name}`, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
        const directory = `infrastructure/${app.name}/${environment.name}`;
        if (safeStack.test(directory)) add(directory);
      }
    }
  }
  for (const file of changed) {
    const parts = file.split('/');
    const directory = parts.slice(0, 3).join('/');
    if (parts.length > 3 && safeStack.test(directory) && fs.existsSync(directory)) add(directory);
  }
}
const selected = [...stacks].sort().map(directory => ({
  directory,
  retired: directory.startsWith('recycle-bin/'),
  removals: changed.filter(file => file.startsWith(`${directory}/.module-removals/`) && file.endsWith('.json'))
}));
const output = `stacks=${JSON.stringify(selected)}\ncount=${selected.length}\n`;
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
else process.stdout.write(output);