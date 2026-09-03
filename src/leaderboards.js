const { allUsers } = require('./users');
const { getWallet } = require('./wallet');

/**
 * category: 'chronicles' | 'community'
 * scope:    'season' | 'lifetime'
 */
function buildLeaderboard(category, scope = 'season', limit = 10) {
  const users = allUsers();
  const rows = Object.entries(users).map(([id, u]) => ({
    id,
    name: u.username ? `@${u.username}` : (u.firstName || `Plomper ${id.slice(-4)}`),
    xp: scope === 'lifetime' ? (u.lifetimeXP[category] || 0) : (u.seasonXP[category] || 0),
    faction: u.faction
  }));
  rows.sort((a, b) => b.xp - a.xp);
  return rows.slice(0, limit);
}

function formatLeaderboard(rows, title) {
  if (rows.length === 0) return `${title}\n\nNo Plompers on the board yet.`;
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => {
    const rank = medals[i] || `${i + 1}`;
    return `${rank} ${r.name} ${r.xp} XP`;
  });
  return `${title}\n\n${lines.join('\n')}`;
}

/**
 * Full (untruncated) CSV export for manual reward distribution.
 */
function exportCSV(category, scope = 'season') {
  const rows = buildLeaderboard(category, scope, Number.MAX_SAFE_INTEGER);
  const header = 'rank,name,telegram_id,xp,faction,wallet';
  const lines = rows.map((r, i) =>
    `${i + 1},${String(r.name).replace(/,/g, '')},${r.id},${r.xp},${r.faction},${getWallet(r.id)?.address || ''}`
  );
  return [header, ...lines].join('\n');
}

module.exports = { buildLeaderboard, formatLeaderboard, exportCSV };
