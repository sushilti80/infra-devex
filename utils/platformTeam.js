/**
 * Platform-team membership (ship-from-repo spec §3.6.3(c)). Empty config = nobody qualifies
 * (fail closed) until the human decision H-4 supplies the role / group values.
 */
const config = require('../config');

function isPlatformMember(user) {
  if (!user) return false;
  const { platformRoles = [], platformGroupIds = [] } = config.ship;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const groups = Array.isArray(user.groups) ? user.groups : [];
  return roles.some((r) => platformRoles.includes(r)) || groups.some((g) => platformGroupIds.includes(g));
}

module.exports = { isPlatformMember };
