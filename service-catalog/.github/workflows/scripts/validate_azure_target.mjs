const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAzureTarget({ directory, subscriptionId, catalogConfig }) {
  const match = /^(?:infrastructure|recycle-bin)\/[a-z0-9][a-z0-9_-]*\/([a-z0-9][a-z0-9_-]*)$/i.exec(directory || '');
  if (!match) throw new Error('Invalid stack directory');
  if (!uuid.test(subscriptionId || '')) throw new Error('Configure a valid AZURE_SUBSCRIPTION_ID for this job');
  let config;
  try { config = JSON.parse(catalogConfig || '{}'); } catch { throw new Error('CATALOG_CONFIG_JSON must be valid JSON'); }
  const target = config?.subscriptions?.[match[1]];
  if (typeof target !== 'string' || !uuid.test(target)) throw new Error(`Configure a valid subscription for environment ${match[1]} in CATALOG_CONFIG_JSON`);
  if (target.toLowerCase() !== subscriptionId.toLowerCase()) throw new Error(`AZURE_SUBSCRIPTION_ID must match the catalog subscription for environment ${match[1]}`);
}

if (process.argv[1]?.endsWith('/validate_azure_target.mjs')) {
  try {
    validateAzureTarget({ directory: process.env.STACK_DIRECTORY, subscriptionId: process.env.ARM_SUBSCRIPTION_ID, catalogConfig: process.env.CATALOG_CONFIG_JSON });
    console.log('Azure target configuration is valid');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
