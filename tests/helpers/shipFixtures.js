/**
 * Recorded-style fixtures for the ship status resolver tests (spec §9.1 BT-09/10/11/13/16/19/20).
 * `makeWorld()` installs stubs on the githubService singleton that honour the `created=` window like
 * GitHub does, and counts upstream calls.
 */
const { v7 } = require('uuid');

const OID = '11111111-2222-3333-4444-555555555555';
const OTHER_OID = '99999999-2222-3333-4444-555555555555';
const REPO = 'AyaHealthcare/my-svc';
const SHA = 'a'.repeat(40);
const DIGEST = 'sha256:' + 'b'.repeat(64);
const TAR = 'c'.repeat(64);
const REGISTRY = 'sharedwus3acr2.azurecr.io';

const PUBLISH_STEPS = ['Publish: guard', 'Publish: verify image', 'Publish: version', 'Publish: push'];
const CONFIG_STEPS = ['Config PR: decide', 'Config PR: guard', 'Config PR: dispatch', 'Config PR: wait'];

const mintAt = (ms) => v7({ msecs: ms });
const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function runName(o) {
  return `ship cid=${o.cid} app=${o.app || 'my-app'} env=${o.env || 'devsand'} repo=${o.repo || REPO} by=${o.by || 'sam@x.com'} oid=${o.oid || OID} mode=${o.mode || 'full'} retry_by=${o.retryBy || '-'}`;
}

const step = (name, conclusion = 'success', status = 'completed', extra = {}) => ({ name, status, conclusion: status === 'completed' ? conclusion : null, ...extra });
const steps = (names, conclusion = 'success') => names.map((n) => step(n, conclusion));

function job(id, name, { status = 'completed', conclusion = 'success', steps: st = [], started = '2026-10-22T14:00:00Z', completed = '2026-10-22T14:05:00Z', created } = {}) {
  return { id, name, status, conclusion: status === 'completed' ? conclusion : null, steps: st, started_at: started, completed_at: status === 'completed' ? completed : null, created_at: created || started };
}

function annotation(stage, payload, { title = 'ship.result' } = {}) {
  return { title, message: `ship.result.v1:${stage}:${enc(payload)}`, annotation_level: 'notice' };
}

function envelope(stage, run, ok = true) {
  return { v: 1, stage, cid: run.cid, runId: run.id, runAttempt: run.attempt || 1, ok };
}

const inputs = { branch: 'main', env: 'devsand', app: 'my-app', namespace: 'my-app', teamLabel: 'software-engineering', port: 8080, healthPath: '/healthz', bump: 'patch' };

const payloads = {
  prepare: (run, o = {}) => ({ ...envelope('prepare', run), mode: run.mode || 'full', sha: SHA, shortSha: SHA.slice(0, 7), repoUrl: 'https://github.com/AyaHealthcare/my-svc', builderRef: 'paketobuildpacks/ubuntu-noble-builder@sha256:' + 'd'.repeat(8), appState: 'new', effective: { port: 8080, healthPath: '/healthz' }, skipConfig: false, inputs, ...o }),
  scan: (run, o = {}) => ({ ...envelope('scan', run), scanId: 'scan-123', tarSha256: TAR, ...o }),
  publish: (run, o = {}) => ({ ...envelope('publish', run), version: '1.2.3', imageRef: `${REGISTRY}/selfserve/${run.app || 'my-app'}:1.2.3`, digest: DIGEST, shaTag: 'sha-' + SHA.slice(0, 7), scanId: 'scan-123', tarSha256: TAR, ...o }),
  config: (run, o = {}) => ({ ...envelope('config', run), rollout: 'preview_pr', prNumber: 7, prUrl: 'https://github.com/Aya-DevOpsTeam/aya-flux/pull/7', ...o }),
};

/**
 * Builds a run + its jobs + annotations. outcome: 'success' | { failAt: 'prepare'|'build'|'scan'|'publish'|'config', ... }
 */
function buildRun(w, { cid, id, createdAt, mode = 'full', status = 'completed', conclusion = 'success', failAt = null, app = 'my-app', oid = OID, annOverrides = {}, publishSteps, configSteps, emit = {}, dropAnn = [] }) {
  const run = { id, cid, attempt: 1, mode, app };
  w.runs.push({ id, run_attempt: 1, display_title: runName({ cid, app, mode, oid, retryBy: mode === 'config_only' ? 'platform@x.com' : '-' }), created_at: createdAt, run_started_at: createdAt, updated_at: new Date(Date.parse(createdAt) + 10 * 60000).toISOString(), status, conclusion: status === 'completed' ? conclusion : null, html_url: `https://github.com/Aya-DevOpsTeam/aya-flux/actions/runs/${id}` });
  const jobs = [];
  const anns = {};
  const ok = (stage) => failAt !== stage;
  const jid = (n) => id * 10 + n;
  // prepare
  jobs.push(job(jid(1), 'prepare', { conclusion: ok('prepare') ? 'success' : 'failure', steps: [step('Emit: prepare')] }));
  anns[jid(1)] = dropAnn.includes('prepare') ? [] : [annotation('prepare', annOverrides.prepare || (ok('prepare') ? payloads.prepare(run) : { ...envelope('prepare', run, false), mode, code: 'REPO_NOT_ACCESSIBLE', appState: 'new', effective: { port: 8080, healthPath: '/healthz' }, skipConfig: false, inputs }))];
  if (mode === 'full') {
    const afterPrepare = ok('prepare');
    jobs.push(job(jid(2), 'build', { conclusion: !afterPrepare ? 'skipped' : ok('build') ? 'success' : 'failure', started: '2026-10-22T14:05:00Z', completed: '2026-10-22T14:20:00Z' }));
    anns[jid(2)] = !ok('build') ? [annotation('build', { code: 'BUILD_FAILED', buildpackId: 'paketo-buildpacks/npm-install', errorLine: 'npm ERR! boom', arch: 'amd64' })] : [];
    const afterBuild = afterPrepare && ok('build');
    jobs.push(job(jid(3), 'scan', { conclusion: !afterBuild ? 'skipped' : ok('scan') ? 'success' : 'failure' }));
    anns[jid(3)] = afterBuild ? [annotation('scan', annOverrides.scan || (ok('scan') ? payloads.scan(run) : { ...envelope('scan', run, false), code: 'SECURITY_GATE_FAILED', severityCounts: { CRITICAL: 1 }, findings: [{ package: 'lodash', version: '4.0.0', fixedIn: '4.17.21', severity: 'CRITICAL' }] }))] : [];
  }
  const afterScan = mode === 'config_only' ? ok('prepare') : ok('prepare') && ok('build') && ok('scan');
  const pubOk = ok('publish');
  const cfgOk = ok('config');
  const pSteps = publishSteps || (mode === 'full' ? (afterScan ? [...steps(PUBLISH_STEPS, pubOk ? 'success' : 'failure'), step('Emit: publish', emit.publish || (pubOk ? 'success' : 'success'))] : []) : []);
  const cSteps = configSteps || (afterScan && (pubOk || mode === 'config_only') ? [...steps(CONFIG_STEPS, cfgOk ? 'success' : 'failure'), step('Emit: config', emit.config || 'success')] : []);
  const publishConclusion = !afterScan ? 'skipped' : pubOk && cfgOk ? 'success' : 'failure';
  jobs.push(job(jid(4), 'publish', { conclusion: status === 'completed' ? publishConclusion : 'success', steps: [...pSteps, ...cSteps], started: '2026-10-22T14:20:00Z', completed: '2026-10-22T14:30:00Z' }));
  const pubAnns = [];
  if (afterScan && mode === 'full' && !dropAnn.includes('publish')) pubAnns.push(annotation('publish', annOverrides.publish || (pubOk ? payloads.publish(run) : { ...envelope('publish', run, false), code: 'PUBLISH_FAILED' })));
  if (afterScan && (pubOk || mode === 'config_only') && !dropAnn.includes('config')) {
    const base = mode === 'config_only' ? { imageTag: '1.2.3', originRunId: w.originRunId } : {};
    pubAnns.push(annotation('config', annOverrides.config || (cfgOk ? payloads.config(run, base) : { ...envelope('config', run, false), rollout: 'preview_pr', code: 'CONFIG_PR_FAILED', ...base })));
  }
  anns[jid(4)] = pubAnns;
  w.jobs[id] = jobs;
  Object.assign(w.anns, anns);
  return { run, jobs, jid, anns };
}

function makeWorld(githubService) {
  const w = { runs: [], jobs: {}, anns: {}, calls: { list: 0, jobs: 0, ann: 0, pr: 0, logs: 0, cancel: 0 }, pr: null, logs: {}, windows: [], cancelled: [] };
  githubService.listWorkflowRunsInWindow = async (repo, wf, { created, page, perPage }) => {
    w.calls.list++;
    w.windows.push({ created, page, repo, wf });
    const [from, to] = created.split('..').map(Date.parse);
    const inWindow = w.runs.filter((r) => Date.parse(r.created_at) >= from && Date.parse(r.created_at) <= to);
    return inWindow.slice((page - 1) * perPage, page * perPage);
  };
  githubService.listJobsForRun = async (repo, runId) => { w.calls.jobs++; return w.jobs[runId] || []; };
  githubService.listJobAnnotations = async (repo, jobId) => { w.calls.ann++; return w.anns[jobId] || []; };
  githubService.findPullRequestForBranch = async () => { w.calls.pr++; return w.pr; };
  githubService.downloadJobLogs = async (repo, jobId) => { w.calls.logs++; return w.logs[jobId] ?? null; };
  githubService.cancelWorkflowRun = async (repo, runId) => { w.calls.cancel++; w.cancelled.push(runId); };
  githubService.getRateLimitSnapshot = () => ({ remaining: 4000, limit: 5000, reset: 0 });
  return w;
}

module.exports = { OID, OTHER_OID, REPO, SHA, DIGEST, TAR, REGISTRY, PUBLISH_STEPS, CONFIG_STEPS, mintAt, enc, runName, step, steps, job, annotation, envelope, payloads, inputs, buildRun, makeWorld };
