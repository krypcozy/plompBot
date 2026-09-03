const fs = require('fs');
const path = require('path');
const { awardXP, loadSettings } = require('../xpEngine');
const { getUser, saveUsers } = require('../users');
const { loadRiddleBank } = require('./keepersRiddle');
const { matchesAnswer } = require('../answerMatch');

const STATE_PATH = path.join(__dirname, '../../data/hiddenClueState.json');
const activeClues = new Map(); // chatId -> { riddle, solvedBy, attemptedUsers, timer }

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastDropAt: null, dropsToday: 0, dropsDate: null };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function maybeTrigger(chatId) {
  const settings = loadSettings().hiddenClue;
  if (!settings || !settings.enabled) return null;
  if (activeClues.has(chatId)) return null;

  const state = loadState();
  if (state.dropsDate !== todayStr()) {
    state.dropsDate = todayStr();
    state.dropsToday = 0;
  }
  if (state.dropsToday >= settings.maxPerDay) return null;

  const now = Date.now();
  if (state.lastDropAt && now - state.lastDropAt < settings.minGapHours * 3600 * 1000) return null;

  if (Math.random() > settings.triggerChance) return null;

  const bank = loadRiddleBank();
  const riddle = bank.riddles[Math.floor(Math.random() * bank.riddles.length)];
  const game = { riddle, solvedBy: null, attemptedUsers: new Set() };
  game.timer = setTimeout(() => activeClues.delete(chatId), settings.answerWindowSeconds * 1000);
  activeClues.set(chatId, game);

  state.lastDropAt = now;
  state.dropsToday += 1;
  saveState(state);

  return riddle;
}

/**
 * One attempt per person for this drop — always responds on their
 * first message, silent afterward for that same user.
 */
function checkAnswer(chatId, userId, meta, text) {
  const game = activeClues.get(chatId);
  if (!game || game.solvedBy) return null;

  const uid = String(userId);
  if (game.attemptedUsers.has(uid)) return null;
  game.attemptedUsers.add(uid);

  const correct = matchesAnswer(text, game.riddle);
  const user = getUser(userId, meta);
  user.questionsAnswered += 1;

  if (!correct) {
    saveUsers();
    return { correct: false };
  }

  game.solvedBy = userId;
  clearTimeout(game.timer);
  activeClues.delete(chatId);

  user.correctAnswers += 1;
  saveUsers();

  const settings = loadSettings().hiddenClue;
  const result = awardXP(userId, meta, 'chronicles', settings.xpReward, { ignoreCap: true });

  return { correct: true, xp: result.awarded };
}

function isActive(chatId) {
  return activeClues.has(chatId);
}

module.exports = { maybeTrigger, checkAnswer, isActive };