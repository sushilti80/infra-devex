#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function issue(code, message) {
  return { code, message };
}

function nonEmpty(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function extractMarker(text, markerName) {
  const regex = new RegExp(`<!--\\s*${escapeRegex(markerName)}\\s*([\\s\\S]*?)-->`, 'gi');
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) return null;
  const match = matches.at(-1);
  const fields = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (field) fields[field[1]] = field[2];
  }
  return { fields, index: match.index, end: match.index + match[0].length, raw: match[0] };
}

function extractAnyMarker(text, markerNames) {
  const matches = markerNames
    .map((markerName) => ({ markerName, marker: extractMarker(text, markerName) }))
    .filter((entry) => entry.marker)
    .sort((left, right) => left.marker.index - right.marker.index);

  return matches.at(-1) ?? null;
}

function parseNonNegativeInteger(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value.trim())) return null;
  return Number(value);
}

function result(contract, decision, code, errors = [], facts = {}, warnings = []) {
  return {
    contract,
    decision,
    code,
    blocking: ['STOP', 'REVISE', 'ESCALATE', 'NO_GO', 'ERROR'].includes(decision),
    errors,
    warnings,
    facts,
  };
}

export function validatePrdText(text, { feature, prdPath }) {
  const structureErrors = [];
  const handoffErrors = [];
  const headings = text.split(/\r?\n/).filter((line) => /^#{1,6}\s+/.test(line));
  const hasHeading = (pattern) => headings.some((line) => pattern.test(line));

  const requiredHeadings = [
    ['problem_statement', /problem statement/i],
    ['goals', /goals/i],
    ['classification', /(requirement|feature).*classification/i],
    ['functional_requirements', /functional requirements/i],
    ['non_functional_requirements', /non-functional requirements/i],
    ['api_data_impact', /(api.*data impact|data.*api impact)/i],
    ['risks_assumptions', /(risks?.*assumptions?|assumptions?.*risks?)/i],
  ];

  for (const [name, pattern] of requiredHeadings) {
    if (!hasHeading(pattern)) {
      structureErrors.push(issue('MISSING_SECTION', `Missing required PRD section: ${name}`));
    }
  }

  if (!/success metrics?/i.test(text)) {
    structureErrors.push(issue('MISSING_SUCCESS_METRICS', 'PRD does not contain a success-metrics contract.'));
  }

  const frMatches = [...text.matchAll(/^#{2,6}\s+FR-\d{3}\b.*$/gim)];
  const nfrMatches = [...text.matchAll(/^#{2,6}\s+NFR-[A-Z0-9-]+\b.*$/gim)];
  if (frMatches.length === 0) structureErrors.push(issue('MISSING_FR', 'No FR-### headings found.'));
  if (nfrMatches.length === 0) structureErrors.push(issue('MISSING_NFR', 'No NFR-* headings found.'));

  for (let index = 0; index < frMatches.length; index += 1) {
    const start = frMatches[index].index;
    const nextFr = index + 1 < frMatches.length ? frMatches[index + 1].index : text.length;
    const nextNfr = nfrMatches.find((entry) => entry.index > start)?.index ?? text.length;
    const end = Math.min(nextFr, nextNfr);
    const block = text.slice(start, end);
    if (!/acceptance criteria/i.test(block)) {
      const id = frMatches[index][0].match(/FR-\d{3}/i)?.[0] ?? `FR-${index + 1}`;
      structureErrors.push(issue('MISSING_FR_ACCEPTANCE', `${id} has no Acceptance Criteria block.`));
    }
  }

  const marker = extractMarker(text, 'ORCHESTRATOR-READY');
  if (!marker) {
    handoffErrors.push(issue('MISSING_HANDOFF_MARKER', 'Missing ORCHESTRATOR-READY marker.'));
  } else {
    const fields = marker.fields;
    if (text.slice(marker.end).trim() !== '') {
      handoffErrors.push(issue('HANDOFF_NOT_FINAL', 'ORCHESTRATOR-READY marker must be the final non-whitespace content.'));
    }
    if (fields.feature !== feature) {
      handoffErrors.push(issue('FEATURE_MISMATCH', `Marker feature is '${fields.feature ?? ''}', expected '${feature}'.`));
    }
    if (fields.prd_path !== prdPath) {
      handoffErrors.push(issue('PRD_PATH_MISMATCH', `Marker prd_path is '${fields.prd_path ?? ''}', expected '${prdPath}'.`));
    }
    if (fields.status !== 'approved') {
      handoffErrors.push(issue('PRD_STATUS_INVALID', `Marker status is '${fields.status ?? ''}', expected 'approved'.`));
    }
    if (Number(fields.fr_count) !== frMatches.length) {
      handoffErrors.push(issue('FR_COUNT_MISMATCH', `Marker fr_count is '${fields.fr_count ?? ''}', actual FR heading count is ${frMatches.length}.`));
    }
    if (Number(fields.nfr_count) !== nfrMatches.length) {
      handoffErrors.push(issue('NFR_COUNT_MISMATCH', `Marker nfr_count is '${fields.nfr_count ?? ''}', actual NFR heading count is ${nfrMatches.length}.`));
    }
  }

  const errors = [...structureErrors, ...handoffErrors];
  const code = structureErrors.length > 0 ? 'PRD_INCOMPLETE' : handoffErrors.length > 0 ? 'PRD_HANDOFF_INVALID' : 'PRD_VALID';
  return result('prd', errors.length ? 'STOP' : 'CONTINUE', code, errors, {
    feature,
    prd_path: prdPath,
    fr_count: frMatches.length,
    nfr_count: nfrMatches.length,
  });
}

export function validateSpecObject(spec, { feature }) {
  const errors = [];
  if (spec?.status !== 'ready_for_challenger') {
    errors.push(issue('SPEC_STATUS_INVALID', `status is '${spec?.status ?? ''}', expected 'ready_for_challenger'.`));
  }
  if (spec?.feature?.name !== feature) {
    errors.push(issue('FEATURE_MISMATCH', `feature.name is '${spec?.feature?.name ?? ''}', expected '${feature}'.`));
  }
  if (!nonEmpty(spec?.feature?.summary)) errors.push(issue('MISSING_FIELD', 'feature.summary is required.'));
  if (!nonEmpty(spec?.acceptance?.user_stories)) errors.push(issue('MISSING_FIELD', 'acceptance.user_stories must be non-empty.'));
  if (!nonEmpty(spec?.acceptance?.acceptance_criteria)) errors.push(issue('MISSING_FIELD', 'acceptance.acceptance_criteria must be non-empty.'));
  if (!hasOwn(spec?.technical, 'api_endpoints')) errors.push(issue('MISSING_FIELD', 'technical.api_endpoints must be present, even when explicitly none.'));
  if (!hasOwn(spec?.technical, 'data_contracts')) errors.push(issue('MISSING_FIELD', 'technical.data_contracts must be present.'));
  if (!nonEmpty(spec?.technical?.error_scenarios)) errors.push(issue('MISSING_FIELD', 'technical.error_scenarios must be non-empty.'));
  if (!nonEmpty(spec?.testing?.functional_test_scenarios)) errors.push(issue('MISSING_FIELD', 'testing.functional_test_scenarios must be non-empty.'));
  if (!nonEmpty(spec?.nfrs)) errors.push(issue('MISSING_FIELD', 'nfrs must contain at least one target.'));
  if (!hasOwn(spec, 'dependencies')) errors.push(issue('MISSING_FIELD', 'dependencies must be present.'));

  return result('spec', errors.length ? 'STOP' : 'CONTINUE', errors.length ? 'SPEC_INCOMPLETE' : 'SPEC_VALID', errors, {
    feature,
    status: spec?.status ?? null,
  });
}

export function validateReviewText(text, { feature, round, type }) {
  const errors = [];
  const markerNames = type === 'arch'
    ? ['ARCH-CHALLENGER-VERDICT', 'ARCHITECTURE-CHALLENGER-VERDICT']
    : ['CHALLENGER-VERDICT'];
  const markerMatch = extractAnyMarker(text, markerNames);
  const numericRound = Number(round);

  if (!Number.isInteger(numericRound) || numericRound < 1) {
    errors.push(issue('ROUND_INVALID', `round must be a positive integer; received '${round}'.`));
  }
  if (!markerMatch) {
    errors.push(issue('MISSING_VERDICT_MARKER', `Missing one of the accepted verdict markers: ${markerNames.join(', ')}.`));
    return result('review', 'STOP', 'REVIEW_INVALID', errors, { feature, round: numericRound, type });
  }

  const marker = markerMatch.marker;
  const fields = marker.fields;
  if (fields.feature !== feature) errors.push(issue('FEATURE_MISMATCH', `Marker feature is '${fields.feature ?? ''}', expected '${feature}'.`));
  if (Number(fields.round) !== numericRound) errors.push(issue('ROUND_MISMATCH', `Marker round is '${fields.round ?? ''}', expected '${numericRound}'.`));
  const verdict = fields.verdict;
  const allowed = new Set(['approved', 'changes_requested', 'escalate_to_human']);
  if (!allowed.has(verdict)) errors.push(issue('VERDICT_INVALID', `Unsupported verdict '${verdict ?? ''}'.`));

  const blockingCount = parseNonNegativeInteger(fields.blocking_count);
  const advisoryCount = parseNonNegativeInteger(fields.advisory_count);
  if (blockingCount === null) errors.push(issue('BLOCKING_COUNT_INVALID', 'blocking_count must be an explicit non-negative integer.'));
  if (advisoryCount === null) errors.push(issue('ADVISORY_COUNT_INVALID', 'advisory_count must be an explicit non-negative integer.'));
  if (verdict === 'approved' && blockingCount !== 0) {
    errors.push(issue('VERDICT_CONTRADICTION', 'approved verdict requires blocking_count: 0.'));
  }

  if (errors.length) {
    return result('review', 'STOP', 'REVIEW_INVALID', errors, { feature, round: numericRound, type, verdict: verdict ?? null });
  }

  const facts = {
    feature,
    round: numericRound,
    type,
    verdict,
    marker: markerMatch.markerName,
    blocking_count: blockingCount,
    advisory_count: advisoryCount,
  };

  if (numericRound > 2) {
    return result(
      'review',
      'ESCALATE',
      'EXTRA_ROUND_REQUIRES_HUMAN',
      [],
      facts,
      ['Rounds above 2 never authorize automatic continuation; an explicit human decision remains required.'],
    );
  }

  let decision = 'CONTINUE';
  let code = 'REVIEW_APPROVED';
  if (verdict === 'changes_requested' && numericRound === 1) {
    decision = 'REVISE';
    code = 'REVIEW_CHANGES_REQUESTED';
  } else if (verdict !== 'approved') {
    decision = 'ESCALATE';
    code = 'REVIEW_ESCALATE';
  }

  return result('review', decision, code, [], facts);
}

export function validateStatusArtifact(object, { feature, kind }) {
  const errors = [];
  if (object?.feature !== feature) errors.push(issue('FEATURE_MISMATCH', `${kind} feature is '${object?.feature ?? ''}', expected '${feature}'.`));

  const allowedStatuses = kind === 'dev'
    ? new Set(['complete', 'pass', 'fail'])
    : new Set(['pass', 'fail']);

  if (!allowedStatuses.has(object?.status)) {
    const expected = kind === 'dev' ? "'complete', 'pass', or 'fail'" : "'pass' or 'fail'";
    errors.push(issue('STATUS_INVALID', `${kind} status must be ${expected}.`));
  }

  if (errors.length) {
    return result(kind, 'STOP', `${kind.toUpperCase()}_ARTIFACT_INVALID`, errors, {
      feature,
      status: object?.status ?? null,
    });
  }

  const successful = kind === 'dev'
    ? ['complete', 'pass'].includes(object.status)
    : object.status === 'pass';

  return result(
    kind,
    successful ? 'CONTINUE' : 'STOP',
    successful
      ? (kind === 'dev' && object.status === 'complete' ? 'DEV_COMPLETE' : `${kind.toUpperCase()}_PASS`)
      : `${kind.toUpperCase()}_FAIL`,
    [],
    { feature, status: object.status },
  );
}

export function validateSreArtifact(object, { feature }) {
  const errors = [];
  if (object?.feature !== feature) errors.push(issue('FEATURE_MISMATCH', `SRE feature is '${object?.feature ?? ''}', expected '${feature}'.`));
  if (!['pass', 'warn', 'fail'].includes(object?.gate)) errors.push(issue('GATE_INVALID', `SRE gate must be 'pass', 'warn', or 'fail'.`));
  if (object?.gate === 'warn' && !nonEmpty(object?.remediation_plan)) {
    errors.push(issue('WARN_WITHOUT_REMEDIATION', 'SRE warn requires a non-empty remediation_plan.'));
  }
  if (errors.length) return result('sre', 'STOP', 'SRE_ARTIFACT_INVALID', errors, { feature, gate: object?.gate ?? null });
  if (object.gate === 'fail') return result('sre', 'STOP', 'SRE_FAIL', [], { feature, gate: object.gate });
  return result('sre', 'CONTINUE', object.gate === 'warn' ? 'SRE_WARN' : 'SRE_PASS', [], { feature, gate: object.gate }, object.gate === 'warn' ? ['SRE gate is warn; preserve remediation_plan in readiness evidence.'] : []);
}

export function validatePhase2Objects({ dev, qa, sre }, { feature }) {
  const devResult = validateStatusArtifact(dev, { feature, kind: 'dev' });
  const qaResult = validateStatusArtifact(qa, { feature, kind: 'qa' });
  const sreResult = validateSreArtifact(sre, { feature });
  const childResults = [devResult, qaResult, sreResult];
  const errors = childResults.flatMap((entry) => entry.errors);
  const warnings = childResults.flatMap((entry) => entry.warnings);
  const blocking = childResults.some((entry) => entry.blocking);
  return result('phase2', blocking ? 'NO_GO' : 'GO_ELIGIBLE', blocking ? 'PHASE2_NOT_READY' : 'PHASE2_READY', errors, {
    feature,
    dev_status: dev?.status ?? null,
    qa_status: qa?.status ?? null,
    sre_gate: sre?.gate ?? null,
  }, warnings);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { command: positionals[0], options };
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required --${name}`);
  return value;
}

function repoPath(input) {
  const absolute = resolve(ROOT, input);
  const rel = relative(ROOT, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path escapes repository root: ${input}`);
  return absolute;
}

function readText(path) {
  return readFileSync(repoPath(path), 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function finish(output) {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.blocking ? 2 : 0;
}

function runCli() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const feature = requireOption(options, 'feature');

  if (command === 'prd') {
    const path = requireOption(options, 'path');
    return finish(validatePrdText(readText(path), { feature, prdPath: path }));
  }
  if (command === 'spec') {
    const path = requireOption(options, 'path');
    return finish(validateSpecObject(readJson(path), { feature }));
  }
  if (command === 'review') {
    const path = requireOption(options, 'path');
    const type = requireOption(options, 'type');
    if (!['prd', 'arch'].includes(type)) throw new Error("--type must be 'prd' or 'arch'");
    const round = requireOption(options, 'round');
    return finish(validateReviewText(readText(path), {
      feature,
      round,
      type,
    }));
  }
  if (command === 'dev' || command === 'qa') {
    const path = requireOption(options, 'path');
    return finish(validateStatusArtifact(readJson(path), { feature, kind: command }));
  }
  if (command === 'sre') {
    const path = requireOption(options, 'path');
    return finish(validateSreArtifact(readJson(path), { feature }));
  }
  if (command === 'phase2') {
    return finish(validatePhase2Objects({
      dev: readJson(requireOption(options, 'dev-status')),
      qa: readJson(requireOption(options, 'qa-results')),
      sre: readJson(requireOption(options, 'sre-report')),
    }, { feature }));
  }

  throw new Error(`Unknown command '${command ?? ''}'. Expected: prd, spec, review, dev, qa, sre, phase2.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    const output = result('validator', 'ERROR', 'VALIDATOR_ERROR', [issue('VALIDATOR_ERROR', error instanceof Error ? error.message : String(error))]);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 1;
  }
}
