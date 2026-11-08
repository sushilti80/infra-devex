import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8'
}).split('\0').filter(Boolean);
const privateMarker = /\b(?:a[y]a(?:-devopsteam|healthcare|-flux|-devops|applications|coreservices)?\b|shared[w]us3|a[y]adev\.atlassian)/i;
const failures = [];
for (const file of new Set(files)) {
  if (!fs.existsSync(file) || file === 'package-lock.json') continue;
  const buffer = fs.readFileSync(file);
  if (privateMarker.test(file)) failures.push(`${file}: private filename`);
  if (buffer.includes(0)) continue;
  for (const [index, line] of buffer.toString('utf8').split('\n').entries()) {
    if (privateMarker.test(line)) failures.push(`${file}:${index + 1}: private organization marker`);
  }
}
const environments = JSON.parse(fs.readFileSync('data/environments.json', 'utf8'));
if (environments.defaultSubscriptionId || environments.environments.some(env => env.subscriptionId)) {
  failures.push('data/environments.json: public source must not contain populated subscription defaults');
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('PASS: no known private markers or populated subscription defaults');
}