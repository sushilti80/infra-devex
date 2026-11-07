// Manual, one-off backfill helper — NOT wired into any CI pipeline.
// Run locally by a human who has `az login`'d and has a local checkout of
// infrastructure-live (or service-catalog) with terragrunt installed.
//
// For each vault that secretsService.resolveKeyVaults() currently reports as
// unresolved (vaultName: null), this reads the ALREADY-APPLIED Terraform state
// via `terragrunt output -json` (read-only — no apply/refresh) from your local
// checkout, then writes the result into docs/overrides/keyvault-overrides.json
// via the same setVaultNameOverride() function the /api/secrets/vault-name-override
// endpoint uses (sha-based optimistic concurrency, lazy sidecar creation).
//
// Usage:
//   node scripts/backfill-vault-overrides.cjs \
//     --checkout /path/to/local/infrastructure-live \
//     --app idm --env dev --target live [--qualifier notif] [--verified-by you@company.com]
//
// Run once per app/environment(/qualifier) combo you want to backfill. Prints
// what it would write and asks for confirmation before persisting, unless --yes
// is passed.

require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');
const readline = require('readline');
const secretsService = require('../services/secretsService');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = value;
    }
  }
  return args;
}

function terragruntOutput(localDir, outputName) {
  try {
    const raw = execSync(`terragrunt output -json ${outputName}`, {
      cwd: localDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString().trim();
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn(`  ⚠️  terragrunt output ${outputName} failed in ${localDir}: ${error.message.split('\n')[0]}`);
    return null;
  }
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const { checkout, app, env, target, qualifier, yes, 'verified-by': verifiedBy } = args;

  if (!checkout || !app || !env || !target) {
    console.error('Usage: node scripts/backfill-vault-overrides.cjs --checkout <path> --app <name> --env <name> --target <live|sand> [--qualifier <name>] [--yes] [--verified-by <email>]');
    process.exit(1);
  }

  const correlationId = 'backfill-' + Date.now();
  console.log(`Resolving vaults for app=${app} env=${env} target=${target} qualifier=${qualifier || '(none)'}...`);
  const result = await secretsService.resolveKeyVaults(app, env, target, correlationId, qualifier);

  const unresolved = result.vaults.filter((v) => !v.vaultName);
  if (unresolved.length === 0) {
    console.log('No unresolved vaults found for this app/environment/qualifier — nothing to backfill.');
    process.exit(0);
  }

  console.log(`Found ${unresolved.length} unresolved vault(s):`);
  for (const vault of unresolved) {
    const localDir = path.join(checkout, vault.vaultDir);
    console.log(`\n- vaultDir: ${vault.vaultDir}`);
    console.log(`  local path: ${localDir}`);

    const name = terragruntOutput(localDir, 'key_vault_name');
    const resourceGroup = terragruntOutput(localDir, 'resource_group_name');

    if (!name) {
      console.log('  ❌ Could not read key_vault_name — skipping (check local checkout path, az login, terragrunt install).');
      continue;
    }

    console.log(`  ✅ key_vault_name = ${name}`);
    console.log(`  ✅ resource_group_name = ${resourceGroup || '(none)'}`);

    const proceed = yes || await confirm('  Write this as an override? (y/N) ');
    if (!proceed) {
      console.log('  Skipped.');
      continue;
    }

    await secretsService.setVaultNameOverride({
      vaultDir: vault.vaultDir,
      name,
      resourceGroup,
      appName: app,
      environment: env,
      qualifier: vault.qualifier || qualifier,
      verifiedBy: verifiedBy || 'backfill-script',
      correlationId,
    });
    console.log('  ✅ Override written.');
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((e) => {
  console.error('BACKFILL ERROR:', e?.stack || e);
  process.exit(1);
});
