const path = require('path');
const fs = require('fs');
const { allUsers, saveUsers } = require('./users');

const settingsPath = path.join(__dirname, '../config/settings.json');

function getSettings() {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}
function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function archiveSeason() {
  const settings = getSettings();
  const users = allUsers();
  const snapshot = {
    seasonNumber: settings.season.number,
    seasonName: settings.season.name,
    endedAt: new Date().toISOString(),
    standings: Object.entries(users)
      .map(([id, u]) => ({
        id,
        name: u.username ? `@${u.username}` : u.firstName,
        chronicles: u.seasonXP.chronicles,
        community: u.seasonXP.community,
        total: u.seasonXP.chronicles + u.seasonXP.community
      }))
      .sort((a, b) => b.total - a.total)
  };

  const archiveDir = path.join(__dirname, '../data/season-archives');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, `season-${settings.season.number}.json`),
    JSON.stringify(snapshot, null, 2)
  );

  return snapshot;
}

/**
 * Archives the current season standings, zeroes everyone's seasonXP
 * (lifetimeXP is untouched), and bumps the season number.
 */
function resetSeason() {
  const snapshot = archiveSeason();

  const users = allUsers();
  Object.values(users).forEach((u) => {
    u.seasonXP = { chronicles: 0, community: 0 };
  });
  saveUsers();

  const settings = getSettings();
  settings.season.number += 1;
  settings.season.startDate = new Date().toISOString().slice(0, 10);
  saveSettings(settings);

  return { archived: snapshot, newSeason: settings.season };
}

module.exports = { archiveSeason, resetSeason, getSettings, saveSettings };
