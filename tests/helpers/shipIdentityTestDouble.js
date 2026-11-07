/**
 * TEST-ONLY ShipIdentityProvider double (spec BT-04). Not part of the production registry:
 * tests call `registerProvider('test', createTestProvider(...))` and set config.ship.identityProvider.
 */
function createTestProvider({ links = {}, repos = {}, permissions = {} } = {}) {
  // links: { [oid]: login }; repos: { [login]: RepoSummary[] }; permissions: { [`${login}:${org}/${repo}`]: 'read'|... }
  const calls = { getLink: 0, listAccessibleRepos: 0, getRepoPermission: 0 };
  return {
    name: 'test',
    calls,
    async getLink(user) {
      calls.getLink++;
      const login = links[user?.id];
      return login ? { state: 'linked', login } : { state: 'unlinked', reason: 'NOT_LINKED' };
    },
    async listAccessibleRepos(user, link) {
      calls.listAccessibleRepos++;
      return link?.state === 'linked' ? (repos[link.login] || []) : [];
    },
    async getRepoPermission(user, link, org, repo) {
      calls.getRepoPermission++;
      if (link?.state !== 'linked') return 'unknown';
      return permissions[`${link.login}:${org}/${repo}`] || 'none';
    },
  };
}

module.exports = { createTestProvider };
