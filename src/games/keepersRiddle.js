const fs = require('fs');
const path = require('path');
const { awardXP } = require('../xpEngine');
const { getUser, saveUsers } = require('../users');
const { matchesAnswer } = require('../answerMatch');

const RIDDLE_BANK_PATH = path.join(__dirname, '../../data/keepers-riddle.json');

function loadRiddleBank() {
  return JSON.parse(fs.readFileSync(RIDDLE_BANK_PATH, 'utf8'));
}

const activeRiddles = new Map(); // chatId -> { riddle, startedAt, solvedUsers, firstSolved, timer }

function pickRiddle(bank, chapter) {
  let pool = bank.riddles;
  if (chapter) {
    const filtered = pool.filter((r) => String(r.chapter).toUpperCase() === String(chapter).toUpperCase());
    if (filtered.length > 0) pool = filtered;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function startRiddle(chatId, chapter = null) {
  if (activeRiddles.has(chatId)) return null;
  const bank = loadRiddleBank();
  const riddle = pickRiddle(bank, chapter);
  const game = { riddle, startedAt: Date.now(), attemptedUsers: new Set(), solvedUsers: new Set(), firstSolved: false, bankSettings: bank.settings, messageId: null };

  game.timer = setTimeout(() => {
    activeRiddles.delete(chatId);
  }, bank.settings.answer_window_seconds * 1000);

  activeRiddles.set(chatId, game);
  return game;
}

function setMessageId(chatId, messageId) {
  const game = activeRiddles.get(chatId);
  if (game) game.messageId = messageId;
}

function checkAnswer(chatId, userId, meta, text, replyToMessageId = null) {
  const game = activeRiddles.get(chatId);
  if (!game) return null;
  const userKey = String(userId);
  if (game.attemptedUsers.has(userKey)) return { alreadyAttempted: true };

  game.attemptedUsers.add(userKey);
  const correct = matchesAnswer(text, game.riddle);
  const isReplyAttempt = game.messageId != null && replyToMessageId === game.messageId;

  const user = getUser(userId, meta);
  user.questionsAnswered += 1;

  if (!correct) {
    saveUsers();
    return { correct: false, isReplyAttempt };
  }

  game.solvedUsers.add(String(userId));
  user.correctAnswers += 1;
  user.riddlesSolved += 1;

  let xp = game.bankSettings.xp_correct;
  let isFirst = false;
  if (!game.firstSolved) {
    game.firstSolved = true;
    isFirst = true;
    xp += game.bankSettings.xp_first_correct_bonus;
  }

  const result = awardXP(userId, meta, 'chronicles', xp, { ignoreCap: true });
  saveUsers();

  return { correct: true, xp: result.awarded, isFirst, riddle: game.riddle };
}

function isRiddleActive(chatId) {
  return activeRiddles.has(chatId);
}

module.exports = { startRiddle, checkAnswer, isRiddleActive, loadRiddleBank, setMessageId };
