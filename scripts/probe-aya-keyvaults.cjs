// Scratch probe — run with: node scripts/probe-aya-keyvaults.cjs
// Reproduces the ayaApplications/shared multi-keyvault resolution against the
// live infrastructure-live repo via the real secretsService.resolveKeyVaults.

require('dotenv').config();
const secretsService = require('../services/secretsService');

(async () => {
  const cid = 'probe-' + Date.now();

  // Case 1: no qualifier passed (UI's first metadata call)
  const r1 = await secretsService.resolveKeyVaults(
    'ayaApplications',
    'shared',
    'live',
    cid,
    undefined
  );
  console.log('CASE 1: appName=ayaApplications env=shared qualifier=undefined');
  console.log('  found:', r1.found);
  console.log('  qualifiers:', JSON.stringify(r1.qualifiers));
  console.log('  vaults (' + r1.vaults.length + '):');
  for (const v of r1.vaults) {
    console.log('    -', JSON.stringify({ vaultDir: v.vaultDir, vaultName: v.vaultName, resourceGroup: v.resourceGroup, qualifier: v.qualifier }));
  }

  // Case 2: explicit qualifier=ayaCoreServices (what auto-select would use)
  const r2 = await secretsService.resolveKeyVaults(
    'ayaApplications',
    'shared',
    'live',
    cid,
    'ayaCoreServices'
  );
  console.log('\nCASE 2: appName=ayaApplications env=shared qualifier=ayaCoreServices');
  console.log('  found:', r2.found);
  console.log('  qualifiers:', JSON.stringify(r2.qualifiers));
  console.log('  vaults (' + r2.vaults.length + '):');
  for (const v of r2.vaults) {
    console.log('    -', v.vaultDir, 'name=', v.vaultName, 'rg=', v.resourceGroup, 'q=', v.qualifier);
  }

  // Also dump what getSecretsList returns (the actual API path the UI calls)
  const data = await secretsService.getSecretsList('live', 'ayaApplications', 'shared', undefined, cid, undefined);
  console.log('\nCASE 3: getSecretsList live/ayaApplications/shared');
  console.log('  found:', data.found, 'anyFileFound:', data.anyFileFound, 'vaultMismatch:', data.vaultMismatch);
  console.log('  qualifiers:', JSON.stringify(data.qualifiers));
  console.log('  vaults.length:', data.vaults?.length);

  // Also call with env=dev to confirm shared vault env-agnosticism
  const r4 = await secretsService.resolveKeyVaults('ayaApplications', 'dev', 'live', cid, undefined);
  console.log('\nCASE 4: appName=ayaApplications env=dev qualifier=undefined');
  console.log('  found:', r4.found, 'qualifiers:', JSON.stringify(r4.qualifiers), 'vaults:', r4.vaults.length);

  // What does the app dropdown show? (discoverAppsForTarget -> extractAppEnvPairs)
  const apps = await secretsService.discoverAppsForTarget('live', cid);
  console.log('\nCASE 5: discoverAppsForTarget live');
  console.log('  total apps:', apps.length);
  for (const a of apps.filter(x => x.name === 'ayaApplications')) {
    console.log('    -', JSON.stringify(a));
  }
  console.log('  any literal ayacodeapplication?', apps.some(a => a.name.toLowerCase().includes('ayacode')));

  process.exit(0);
})().catch((e) => {
  console.error('PROBE ERROR:', e?.stack || e);
  process.exit(1);
});
