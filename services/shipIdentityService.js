/**
 * Ship identity-provider seam (spec §3.6.1, DD-4, ADR ship-identity-provider-seam).
 *
 *   getLink(user)                          -> { state:'linked', login } | { state:'unlinked', reason }
 *   listAccessibleRepos(user, link, orgs)  -> RepoSummary[]            (user ∩ App installation)
 *   getRepoPermission(user, link, org, repo) -> 'admin'|'write'|'read'|'none'|'unknown'
 *
 * Only the `none` provider exists: it fails closed (every ship is refused with
 * REPO_NOT_ACCESSIBLE / hint IDENTITY_NOT_LINKED). The real Entra→GitHub mapping is human item H-2
 * and is deliberately NOT implemented. Unknown provider names also resolve to `none`.
 * Tests register a double with `registerProvider` (see tests/helpers/shipIdentityTestDouble.js).
 */
const config = require('../config');
const logger = require('../utils/logger');

const noneProvider = Object.freeze({
  name: 'none',
  async getLink() {
    return { state: 'unlinked', reason: 'IDENTITY_MAPPING_NOT_CONFIGURED' };
  },
  async listAccessibleRepos() {
    return [];
  },
  async getRepoPermission() {
    return 'unknown';
  },
});

const providers = { none: noneProvider };

function registerProvider(name, provider) {
  providers[name] = provider;
}

/** The active provider; anything unrecognised falls back to `none` (fail closed). */
function getProvider() {
  const name = config.ship.identityProvider || 'none';
  if (providers[name]) return providers[name];
  logger.warn(`[ship] Unknown SHIP_IDENTITY_PROVIDER '${name}' — falling back to 'none' (fail closed)`);
  return noneProvider;
}

module.exports = { getProvider, registerProvider, noneProvider };
