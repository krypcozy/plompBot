const { awardXP, loadSettings } = require('../xpEngine');
const { getUser, saveUsers } = require('../users');

// Lore-flavored phrases pulled from the Chronicles. Add more anytime —
// this array is the only thing that needs editing to expand the pool.
const phrases = [
  'The Core chooses only the worthy.',
  'Seven Keepers, one prophecy, one Core.',
  'The Black Tide hunts in silence.',
  'Find the Seven before they find you.',
  'The Isle of Echoes hides more than gold.',
  'One order, one mission, one future.',
  'The False Keeper watches from the shadows.',
  'Every Plomper has a story to tell.',
  'The traitor has returned to the ruins.',
  'Coordinates aligned, the path has opened.',
  'The Green Order rises from the ashes.',
  'Power was never the Cores true test.'
];

const activeGames = new Map(); // chatId -> { phrase, startedAt, resolved, timer }

function startGame(chatId) {
  if (activeGames.has(chatId)) return null;
  const settings = loadSettings();
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  const game = { phrase, startedAt: Date.now(), resolved: false };

  game.timer = setTimeout(() => {
    activeGames.delete(chatId);
  }, settings.fastTyping.timeLimitSeconds * 1000);

  activeGames.set(chatId, game);
  return game;
}

function checkAnswer(chatId, userId, meta, text) {
  const game = activeGames.get(chatId);
  if (!game || game.resolved) return null;

  if (text.trim() === game.phrase) {
    game.resolved = true;
    clearTimeout(game.timer);
    activeGames.delete(chatId);

    const settings = loadSettings();
    const result = awardXP(userId, meta, 'community', settings.fastTyping.xpReward, { ignoreCap: true });

    const user = getUser(userId, meta);
    user.fastTypingWins += 1;
    saveUsers();

    const elapsed = ((Date.now() - game.startedAt) / 1000).toFixed(1);
    return { won: true, elapsed, xp: result.awarded };
  }

  return { won: false };
}

function isGameActive(chatId) {
  return activeGames.has(chatId);
}

module.exports = { startGame, checkAnswer, isGameActive, phrases };
