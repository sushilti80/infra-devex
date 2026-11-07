/**
 * terragruntLocalsResolver.js
 *
 * secret-self-service FR-003(i): a brand-new component, NOT an extension of hclParser.js.
 * hclParser.js only extracts `module{}.source`/`version` from the first module block — it has
 * zero cross-file locals resolution, expression evaluation, or comment stripping (Architecture
 * Challenger round 3, finding B3). This module resolves a Key Vault directory's `inputs.keyvaultname`
 * (and best-effort `resource_group_name`) by evaluating the small Terragrunt expression grammar
 * actually observed in this org's `terragrunt.hcl`/`keyvault.hcl` files:
 *   - bare `local.NAME` references
 *   - quoted strings with `${...}` interpolation
 *   - `substr(expr, start, len)` and `format(fmtStr, ...args)` function calls
 *   - `basename(dirname(get_[original_]terragrunt_dir()))` environment-directory lookup
 *   - `local.ALIAS.locals.NAME` alias indirection, where ALIAS is bound via
 *     `ALIAS = read_terragrunt_config(find_in_parent_folders("FILENAME"))`, chained up to
 *     `MAX_ALIAS_DEPTH` hops (e.g. `terragrunt.hcl` → `env.hcl` → `common.hcl`), always searching
 *     upward from the vault's own directory at every hop (matches Terragrunt's
 *     `get_terragrunt_dir()` quirk)
 *   - `COND ? A : B` ternary/conditional expressions, where `COND` is `contains([...], expr)` or
 *     a bare `EXPR == "literal"` / `EXPR != "literal"` comparison
 *   - `lookup(local.MAP, keyExpr, defaultExpr)` against a bare `locals` map literal (`{ k = "v" }`)
 *   - `lower(expr)`, and generic `basename(expr)`/`dirname(expr)` path functions (not just the
 *     hardcoded `get_[original_]terragrunt_dir()` composite) — bare `get_terragrunt_dir()` resolves
 *     to the directory of whichever file's `locals` block is currently being evaluated (it changes
 *     per alias hop, matching real Terragrunt semantics), while `get_original_terragrunt_dir()`
 *     stays constant to the vault's own directory across every hop (idm-style `env.hcl` uses the
 *     former; `common.hcl`-style shared config uses the latter)
 *   - `include ["label"] { path = find_in_parent_folders("FILENAME") }` — shared/`_common` config
 *     whose `locals`/`inputs` are merged into the vault's own (own file wins on conflicts); treated
 *     as if spliced into the vault's file, so `find_in_parent_folders()` inside it still searches
 *     upward from the vault's own directory (matches Terragrunt's `get_terragrunt_dir()` quirk of
 *     resolving to the child/including config's directory, and matches the observed org layout
 *     where shared config files are siblings — not ancestors — of the env directories they need)
 *   - `dependency.NAME.outputs.FIELD` (idm-style `resourcegroups` dependency) — best-effort only:
 *     follows the `dependency "NAME" { config_path = "..." }` block to that Terragrunt directory
 *     and reads its own `inputs.FIELD`, since we can't read real `terraform apply` state
 *
 * ponytail: this is intentionally NOT a general HCL/Terraform expression evaluator. Anything
 * outside the grammar above (or any file/alias that can't be located) resolves to `null` rather
 * than throwing — per FR-003(d)'s "best-effort, never blocks discovery" contract.
 */

const MAX_INCLUDE_DEPTH = 3;
const MAX_ALIAS_DEPTH = 3;

const config = require('../config');
const githubService = require('./githubService');
const logger = require('../utils/logger');
const path = require('node:path');

function mapRepo(target) {
  if (target === 'live') return config.github.infrastructureLiveRepo;
  if (target === 'sand') return config.github.serviceRepo;
  return null;
}

// Strip `#` / `//` comments outside quoted strings so commented assignments and trailing comments
// are ignored without truncating values such as URLs.
function stripComments(content) {
  return content
    .split('\n')
    .map(line => {
      let quote = null;
      let escaped = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (quote) {
          if (char === '\\') escaped = true;
          else if (char === quote) quote = null;
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
        } else if (char === '#' || (char === '/' && line[i + 1] === '/')) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

// Extract top-level `key = value` assignments from the first `blockName { ... }` block
// (also matches the `blockName = { ... }` object-literal form Terragrunt uses for `inputs`).
function extractBlockAssignments(content, blockName) {
  const re = new RegExp(`${blockName}\\s*=?\\s*{`);
  const match = re.exec(content);
  if (!match) return {};

  let depth = 0;
  let start = -1;
  for (let i = match.index; i < content.length; i++) {
    if (content[i] === '{') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (content[i] === '}') {
      depth--;
      if (depth === 0) return parseAssignments(content.slice(start, i));
    }
  }
  return {};
}

function parseAssignments(blockBody) {
  const assignments = {};
  const assignmentRe = /^\s*([A-Za-z_][\w-]*)\s*=\s*(.*)$/;
  let currentKey = null;
  let currentValue = '';
  let openDepth = 0;

  function flush() {
    if (currentKey) assignments[currentKey] = currentValue.trim();
    currentKey = null;
    currentValue = '';
  }

  // Tracks both `(`/`)` (function calls) and `{`/`}` (map literals, e.g. `envkvcount = { ... }`)
  // so a multi-line map-literal value isn't split into spurious top-level keys.
  function depthDelta(str) {
    return countChar(str, '(') - countChar(str, ')') + countChar(str, '{') - countChar(str, '}');
  }

  for (const line of blockBody.split('\n')) {
    if (openDepth === 0) {
      const m = assignmentRe.exec(line);
      if (m) {
        flush();
        currentKey = m[1];
        currentValue = m[2];
        openDepth += depthDelta(m[2]);
        continue;
      }
    }
    if (currentKey) {
      currentValue += '\n' + line;
      openDepth += depthDelta(line);
    }
  }
  flush();
  return assignments;
}

function countChar(str, ch) {
  let count = 0;
  for (const c of str) if (c === ch) count++;
  return count;
}

// Parses a bare `{ key = "value" ... }` map literal (as produced by `envkvcount`-style locals)
// into a plain JS object. Only string-literal values are supported (matches observed usage).
function parseMapLiteral(raw) {
  if (raw == null) return null;
  const braceMatch = /^\{([\s\S]*)\}$/.exec(String(raw).trim());
  if (!braceMatch) return null;
  const map = {};
  const entryRe = /([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = entryRe.exec(braceMatch[1])) !== null) map[m[1]] = m[2];
  return map;
}

// Parses a bare `["a", "b"]` string-list literal (as used by `contains([...], ...)`) into a JS
// array. Non-quoted-string entries are dropped rather than causing a throw.
function parseStringListLiteral(raw) {
  const m = /^\[([\s\S]*)\]$/.exec(String(raw).trim());
  if (!m) return null;
  return splitArgs(m[1])
    .map(item => {
      const qm = /^"([^"]*)"$/.exec(item.trim());
      return qm ? qm[1] : null;
    })
    .filter(v => v !== null);
}

// Finds the top-level `?` and matching top-level `:` of a `COND ? A : B` ternary, ignoring
// characters inside quoted strings or nested parens (so `"${a ? b : c}"` inside a sub-expression
// doesn't get mistaken for the outer ternary's boundary). Returns null if `str` isn't a ternary.
function splitTernary(str) {
  let quote = null;
  let depth = 0;
  let qIndex = -1;
  for (let i = 0; i < str.length && qIndex === -1; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && ch === '?') qIndex = i;
  }
  if (qIndex === -1) return null;

  quote = null;
  depth = 0;
  for (let i = qIndex + 1; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && ch === ':') {
      return { cond: str.slice(0, qIndex), truthy: str.slice(qIndex + 1, i), falsy: str.slice(i + 1) };
    }
  }
  return null;
}

// Splits a bare `EXPR == "literal"` / `EXPR != "literal"` comparison at the top-level `==`/`!=`,
// ignoring occurrences inside quoted strings. Returns null if no top-level operator is found.
function splitEquality(str) {
  let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if ((ch === '=' && str[i + 1] === '=') || (ch === '!' && str[i + 1] === '=')) {
      return { left: str.slice(0, i), op: ch === '=' ? '==' : '!=', right: str.slice(i + 2) };
    }
  }
  return null;
}

// Evaluates a ternary's `COND` clause. Supports `contains([...], expr)` and bare `==`/`!=`
// comparisons only (the two forms observed in this org's `common.hcl`). Returns null (not a
// boolean) when the condition itself can't be evaluated, so the caller can fall through to `null`
// rather than guessing a branch.
async function evaluateCondition(condStr, ctx, resolving) {
  const trimmed = condStr.trim();

  const containsMatch = /^contains\(([\s\S]*)\)$/.exec(trimmed);
  if (containsMatch) {
    const args = splitArgs(containsMatch[1]);
    if (args.length !== 2) return null;
    const list = parseStringListLiteral(args[0].trim());
    if (!list) return null;
    const needle = await evaluateExpr(args[1].trim(), ctx, resolving);
    if (needle == null) return null;
    return list.includes(needle);
  }

  const eq = splitEquality(trimmed);
  if (eq) {
    const leftVal = await evaluateExpr(eq.left.trim(), ctx, resolving);
    const rightVal = await evaluateExpr(eq.right.trim(), ctx, resolving);
    if (leftVal == null || rightVal == null) return null;
    return eq.op === '==' ? leftVal === rightVal : leftVal !== rightVal;
  }

  return null;
}

// Mirrors Terragrunt's find_in_parent_folders(): searches the vault's own directory then each
// ancestor upward (stopping short of the repo root) for `filename`.
async function findFileUpwards(repo, startDir, filename) {
  const segments = startDir.split('/').filter(Boolean);
  for (let i = segments.length; i >= 1; i--) {
    const dir = segments.slice(0, i).join('/');
    const candidate = `${dir}/${filename}`;
    const file = await githubService.getFileContent(repo, candidate);
    if (file) return { path: candidate, content: file.content };
  }
  return null;
}

function findAliasBinding(localsAssignments, aliasName) {
  const raw = localsAssignments[aliasName];
  if (!raw) return null;
  const m = /find_in_parent_folders\(\s*["']([^"']+)["']/.exec(raw);
  return m ? m[1] : null;
}

// Extracts each `include [ "label" ] { ... }` block's `find_in_parent_folders("filename")` target.
function extractIncludeFilenames(content) {
  const filenames = [];
  const re = /include\s*(?:"[^"]*"\s*)?\{/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    let depth = 0;
    let start = -1;
    let end = -1;
    for (let i = match.index; i < content.length; i++) {
      if (content[i] === '{') {
        if (depth === 0) start = i + 1;
        depth++;
      } else if (content[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    const pathMatch = /find_in_parent_folders\(\s*["']([^"']+)["']/.exec(content.slice(start, end));
    if (pathMatch) filenames.push(pathMatch[1]);
    re.lastIndex = end;
  }
  return filenames;
}

// Extracts each top-level `dependency "<name>" { config_path = "..." ... }` block's name and
// config_path (relative path to another Terragrunt directory, e.g. `../resourcegroups`).
function extractDependencyConfigPaths(content) {
  const paths = {};
  const re = /dependency\s*"([^"]+)"\s*\{/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    let depth = 0;
    let start = -1;
    let end = -1;
    for (let i = match.index; i < content.length; i++) {
      if (content[i] === '{') {
        if (depth === 0) start = i + 1;
        depth++;
      } else if (content[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    const pathMatch = /config_path\s*=\s*"([^"]+)"/.exec(content.slice(start, end));
    if (pathMatch) paths[match[1]] = pathMatch[1];
    re.lastIndex = end;
  }
  return paths;
}

// Resolves one `include` target's `locals`/`inputs`, following its own nested includes (guarded by
// `visited` + MAX_INCLUDE_DEPTH so a misconfigured cycle can't loop forever).
async function loadIncludedFile(repo, vaultDir, filename, visited) {
  if (visited.has(filename) || visited.size >= MAX_INCLUDE_DEPTH) return null;
  visited.add(filename);

  const found = await findFileUpwards(repo, vaultDir, filename);
  if (!found) return null;

  const clean = stripComments(found.content);
  let locals = extractBlockAssignments(clean, 'locals');
  let inputs = extractBlockAssignments(clean, 'inputs');

  for (const nestedFilename of extractIncludeFilenames(clean)) {
    const nested = await loadIncludedFile(repo, vaultDir, nestedFilename, visited);
    if (nested) {
      locals = { ...nested.locals, ...locals };
      inputs = { ...nested.inputs, ...inputs };
    }
  }

  return { locals, inputs };
}

async function resolveAliasScope(repo, vaultDir, currentLocalsMap, aliasName, cache) {
  const filename = findAliasBinding(currentLocalsMap, aliasName);
  if (!filename) return null;

  const cacheKey = `${vaultDir}::${filename}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const found = await findFileUpwards(repo, vaultDir, filename);
  const result = found
    ? { locals: extractBlockAssignments(stripComments(found.content), 'locals'), path: found.path }
    : null;
  cache.set(cacheKey, result);
  return result;
}

// Emulates Terraform/Terragrunt's `dirname`/`basename` (Go `path.Dir`/`path.Base`), which resolve
// `..`/`.` segments lexically (e.g. `dirname("a/b/../")` === "a", not "a/b/.."), unlike Node's
// `path.posix.dirname`. Only the org's actual `${get_terragrunt_dir()}/../` idiom needs this.
function cleanPosixPath(p) {
  const isAbsolute = p.startsWith('/');
  const stack = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
      else if (!isAbsolute) stack.push('..');
    } else {
      stack.push(part);
    }
  }
  const joined = stack.join('/');
  return (isAbsolute ? '/' : '') + joined || (isAbsolute ? '/' : '.');
}

function tgDirname(p) {
  const idx = p.lastIndexOf('/');
  const dirPart = idx === -1 ? '' : p.slice(0, idx + 1); // keeps trailing slash, like Go's Split()
  return cleanPosixPath(dirPart);
}

function tgBasename(p) {
  const cleaned = cleanPosixPath(p);
  const idx = cleaned.lastIndexOf('/');
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

const BARE_TOKEN_RE = /^local\.([A-Za-z_]\w*)(?:\.locals\.([A-Za-z_]\w*))?$/;
const DEPENDENCY_TOKEN_RE = /^dependency\.([A-Za-z_]\w*)\.outputs\.([A-Za-z_]\w*)$/;
const MAX_DEPENDENCY_DEPTH = 2;

async function evaluateExpr(raw, ctx, resolving) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();

  const bareMatch = BARE_TOKEN_RE.exec(trimmed);
  if (bareMatch) return resolveToken(bareMatch[1], bareMatch[2], ctx, resolving);

  const depMatch = DEPENDENCY_TOKEN_RE.exec(trimmed);
  if (depMatch) return resolveDependencyOutput(depMatch[1], depMatch[2], ctx);

  const ternary = splitTernary(trimmed);
  if (ternary) {
    const condResult = await evaluateCondition(ternary.cond, ctx, resolving);
    if (condResult == null) return null;
    return evaluateExpr(condResult ? ternary.truthy : ternary.falsy, ctx, resolving);
  }

  const fnMatch = /^(substr|format|lookup|lower|basename|dirname|get_terragrunt_dir|get_original_terragrunt_dir)\(([\s\S]*)\)$/.exec(trimmed);
  if (fnMatch) return evaluateFunctionCall(fnMatch[1], fnMatch[2], ctx, resolving);

  const quotedMatch = /^"([\s\S]*)"$/.exec(trimmed);
  if (quotedMatch) return interpolate(quotedMatch[1], ctx, resolving);

  // Unsupported literal/expression shape (number, unrecognized function, etc.)
  return null;
}

// Best-effort `dependency.<name>.outputs.<field>` resolution: real Terragrunt reads this from the
// dependency's actual `terraform apply` state, which we can't reproduce. As a stand-in, follow the
// dependency's own `config_path` to its Terragrunt directory (e.g. `../resourcegroups`) and read
// *that* directory's own `inputs.<field>` — for resource-group/similar single-purpose modules this
// is the value the dependency's output actually carries. Guarded by MAX_DEPENDENCY_DEPTH in case a
// dependency's own inputs reference another dependency.
async function resolveDependencyOutput(depName, field, ctx) {
  const configPath = ctx.dependencies && ctx.dependencies[depName];
  if (!configPath) return null;
  if ((ctx.dependencyDepth || 0) >= MAX_DEPENDENCY_DEPTH) return null;
  const depDir = path.posix.normalize(path.posix.join(ctx.vaultDir, configPath));
  return resolveField(depDir, ctx.target, field, ctx.correlationId, (ctx.dependencyDepth || 0) + 1);
}

async function resolveToken(name, key, ctx, resolving) {
  if (key) {
    const guardKey = `alias:${name}`;
    if (resolving.has(guardKey)) return null; // cycle guard
    if ((ctx.aliasDepth || 0) >= MAX_ALIAS_DEPTH) return null; // hop-depth cap
    const aliasScope = await resolveAliasScope(ctx.repo, ctx.vaultDir, ctx.locals, name, ctx.aliasCache);
    if (!aliasScope) return null;
    const rawVal = aliasScope.locals[key];
    if (rawVal === undefined) return null;
    const nextCtx = {
      repo: ctx.repo,
      vaultDir: ctx.vaultDir,
      aliasCache: ctx.aliasCache,
      locals: aliasScope.locals,
      // get_original_terragrunt_dir() always resolves to the *original* vault's own directory, even
      // when evaluated via read_terragrunt_config() on an aliased file — so this stays constant
      // across every hop. Bare get_terragrunt_dir(), however, tracks the *current* hop's own file
      // directory (real Terragrunt semantics: it varies per included/aliased config).
      originalVaultDir: ctx.originalVaultDir,
      currentDir: aliasScope.path ? path.posix.dirname(aliasScope.path) : ctx.currentDir,
      aliasDepth: (ctx.aliasDepth || 0) + 1
    };
    const nextResolving = new Set(resolving);
    nextResolving.add(guardKey);
    return evaluateExpr(rawVal, nextCtx, nextResolving);
  }

  const guardKey = `local:${name}`;
  if (resolving.has(guardKey)) return null; // cycle guard
  const rawVal = ctx.locals[name];
  if (rawVal === undefined) return null;
  const nextResolving = new Set(resolving);
  nextResolving.add(guardKey);
  return evaluateExpr(rawVal, ctx, nextResolving);
}

async function interpolate(str, ctx, resolving) {
  const re = /\$\{([^}]+)\}/g;
  let result = '';
  let last = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    result += str.slice(last, m.index);
    const val = await evaluateExpr(m[1], ctx, resolving);
    if (val == null) return null;
    result += val;
    last = re.lastIndex;
  }
  result += str.slice(last);
  return result;
}

// Splits a comma-separated argument/list-item string at the top level, tracking both `(`/`)`
// (function-call nesting) and `[`/`]` (list-literal nesting, e.g. `contains(["a", "b"], x)`) so a
// comma inside a nested list or call isn't mistaken for an argument separator. Quoted content is
// also skipped so a literal comma/bracket inside a string doesn't affect depth.
function splitArgs(argsStr) {
  const args = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (quote) {
      current += ch;
      if (ch === '\\') { current += argsStr[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length) args.push(current);
  return args;
}

async function evaluateFunctionCall(fnName, argsStr, ctx, resolving) {
  const args = splitArgs(argsStr);

  if (fnName === 'get_terragrunt_dir') return ctx.currentDir || null;
  if (fnName === 'get_original_terragrunt_dir') return ctx.originalVaultDir || null;

  if (fnName === 'lower') {
    if (args.length !== 1) return null;
    const v = await evaluateExpr(args[0].trim(), ctx, resolving);
    return v == null ? null : String(v).toLowerCase();
  }

  if (fnName === 'basename' || fnName === 'dirname') {
    if (args.length !== 1) return null;
    const v = await evaluateExpr(args[0].trim(), ctx, resolving);
    if (v == null) return null;
    return fnName === 'basename' ? tgBasename(v) : tgDirname(v);
  }

  if (fnName === 'substr') {
    if (args.length !== 3) return null;
    const base = await evaluateExpr(args[0].trim(), ctx, resolving);
    const start = parseInt(args[1].trim(), 10);
    const len = parseInt(args[2].trim(), 10);
    if (base == null || Number.isNaN(start) || Number.isNaN(len)) return null;
    return len < 0 ? base.slice(start) : base.slice(start, start + len);
  }

  if (fnName === 'format') {
    if (args.length < 1) return null;
    const fmtRaw = await evaluateExpr(args[0].trim(), ctx, resolving);
    if (fmtRaw == null) return null;
    const rest = [];
    for (let i = 1; i < args.length; i++) {
      const v = await evaluateExpr(args[i].trim(), ctx, resolving);
      if (v == null) return null;
      rest.push(v);
    }
    let idx = 0;
    return fmtRaw.replace(/%s/g, () => rest[idx++] ?? '');
  }

  if (fnName === 'lookup') {
    if (args.length !== 3) return null;
    const mapMatch = /^local\.([A-Za-z_]\w*)$/.exec(args[0].trim());
    if (!mapMatch) return null; // only a bare `local.MAP` map reference is supported
    const map = parseMapLiteral(ctx.locals[mapMatch[1]]);
    if (!map) return null;
    const key = await evaluateExpr(args[1].trim(), ctx, resolving);
    const def = await evaluateExpr(args[2].trim(), ctx, resolving);
    if (key == null) return null;
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : (def ?? null);
  }

  return null;
}

// Loads the vault's terragrunt.hcl / keyvault.hcl file and extracts its `locals` + `inputs` blocks,
// merging in any `include`d shared config (own file wins on conflicting keys) so vaults whose
// `inputs` live entirely in a shared/`_common` file still resolve instead of silently returning null.
async function loadVaultFile(vaultDir, target) {
  const repo = mapRepo(target);
  if (!repo) return null;

  for (const filename of ['terragrunt.hcl', 'keyvault.hcl']) {
    const file = await githubService.getFileContent(repo, `${vaultDir}/${filename}`);
    if (!file) continue;
    const clean = stripComments(file.content);
    let locals = extractBlockAssignments(clean, 'locals');
    let inputs = extractBlockAssignments(clean, 'inputs');

    const visited = new Set();
    for (const includeFilename of extractIncludeFilenames(clean)) {
      const included = await loadIncludedFile(repo, vaultDir, includeFilename, visited);
      if (included) {
        locals = { ...included.locals, ...locals };
        inputs = { ...included.inputs, ...inputs };
      }
    }

    return { repo, locals, inputs, dependencies: extractDependencyConfigPaths(clean) };
  }
  return null;
}

async function resolveField(vaultDir, target, fieldName, correlationId, dependencyDepth = 0) {
  try {
    const parsed = await loadVaultFile(vaultDir, target);
    if (!parsed) return null;

    const rawValue = parsed.inputs[fieldName];
    if (!rawValue) {
      logger.debug(`[${correlationId}] terragruntLocalsResolver: ${fieldName} not found (own file or includes) for ${vaultDir}`);
      return null;
    }

    const aliasCache = new Map();
    const ctx = {
      repo: parsed.repo,
      vaultDir,
      aliasCache,
      locals: parsed.locals,
      // Both start out equal to the vault's own directory (bare get_terragrunt_dir() in the
      // vault's own terragrunt.hcl is that directory too); they diverge once an alias hop loads
      // a different file (see resolveToken's nextCtx).
      originalVaultDir: vaultDir,
      currentDir: vaultDir,
      aliasDepth: 0,
      target,
      dependencies: parsed.dependencies,
      dependencyDepth
    };

    return await evaluateExpr(rawValue, ctx, new Set());
  } catch (error) {
    logger.warn(`[${correlationId}] terragruntLocalsResolver: failed to resolve ${fieldName} for ${vaultDir}: ${error.message}`);
    return null;
  }
}

/**
 * Resolves the Key Vault display name (`inputs.keyvaultname`) for a vault directory.
 * Never throws; returns null when unresolvable (FR-003(d) best-effort contract).
 */
async function resolveName(vaultDir, target, correlationId) {
  return resolveField(vaultDir, target, 'keyvaultname', correlationId);
}

/**
 * Best-effort resolution of the Key Vault's resource group (`inputs.resource_group_name`).
 * Not detailed in the PRD grammar tables; reuses the same evaluator. Returns null on failure.
 */
async function resolveResourceGroup(vaultDir, target, correlationId) {
  return resolveField(vaultDir, target, 'resource_group_name', correlationId);
}

module.exports = {
  resolveName,
  resolveResourceGroup
};
