const { getUser, levelFor } = require('./users');

function formatProfile(userId, meta) {
  const u = getUser(userId, meta);
  const level = levelFor(u);
  const totalLifetime = (u.lifetimeXP.chronicles || 0) + (u.lifetimeXP.community || 0);
  const totalSeason = (u.seasonXP.chronicles || 0) + (u.seasonXP.community || 0);
  const name = u.username ? `@${u.username}` : (u.firstName || 'Plomper');
  const factionGlyph = { 'Green Order': '🟢', 'Black Tide': '🔵', 'Ashborn': '🟠', 'Keepers': '🟡' }[u.faction] || '⚪';

  return [
    `🫧 PLOMPER PROFILE`,
    ``,
    `${name}`,
    ``,
    `Level: ${level}`,
    `Lifetime XP: ${totalLifetime}  (Chronicles: ${u.lifetimeXP.chronicles} · Community: ${u.lifetimeXP.community})`,
    `Season XP: ${totalSeason}`,
    `Messages: ${u.messages}`,
    `Questions Answered: ${u.questionsAnswered}`,
    `Correct: ${u.correctAnswers}`,
    `Streak: 🔥 ${u.streak} day${u.streak === 1 ? '' : 's'}`,
    `Mystery Rewards: ${u.mysteryRewards}`,
    `Chapters Completed: ${u.chaptersCompleted}`,
    `Fast Typing Wins: ${u.fastTypingWins}`,
    `Riddles Solved: ${u.riddlesSolved}`,
    `Tic-Tac-Toe Wins: ${u.ticTacToeWins || 0}`,
    `Connect Four Wins: ${u.connectFourWins || 0}`,
    ``,
    `${factionGlyph} Faction: ${u.faction}`
  ].join('\n');
}

module.exports = { formatProfile };
