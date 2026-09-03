const fs = require('fs');
const path = require('path');
const { loadSettings } = require('./xpEngine');
const fastTyping = require('./games/fastTyping');
const keepersRiddle = require('./games/keepersRiddle');
const ashbornTrial = require('./games/ashbornTrial');

const STATE_PATH = path.join(__dirname, '../data/autoEventsState.json');
const CHECK_INTERVAL_MS = 60 * 1000; // tick every minute, checking for an aligned fire time

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastAutoEventAt: null, lastFiredMinuteKey: null };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function anyGameActive(chatId) {
  return fastTyping.isGameActive(chatId) || keepersRiddle.isRiddleActive(chatId) || ashbornTrial.isTrialActive(chatId);
}

function displayName(user) {
  if (!user) return 'Plomper';
  if (user.username) return `@${user.username}`;
  return user.firstName || 'Plomper';
}

function buildEventLeaderboard(users) {
  const rows = Object.entries(users)
    .map(([id, user]) => ({
      id,
      name: displayName(user),
      correct: Number(user.correctAnswers || 0),
      answered: Number(user.questionsAnswered || 0) > 0
    }))
    .filter((row) => row.answered && row.correct > 0)
    .sort((a, b) => b.correct - a.correct)
    .slice(0, 5);

  if (rows.length === 0) return 'No one has answered correctly yet this week.';
  return rows.map((row, index) => `${index + 1}. ${row.name} — ${row.correct} correct`).join('\n');
}

/**
 * Whether `now` falls on a wall-clock-aligned fire slot — e.g. with
 * intervalMinutes=60 and targetMinute=10, this is true only at :10 past
 * every hour (UTC), not "60 minutes after whenever the bot happened to
 * start." Alignment resets at UTC midnight, which is fine for any
 * interval that divides evenly into 60 or 1440 (5, 10, 15, 20, 30, 60...).
 */
function isAlignedFireTime(now, intervalMinutes, targetMinute) {
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (((minuteOfDay - targetMinute) % intervalMinutes) + intervalMinutes) % intervalMinutes === 0;
}

function triggerRandomEvent(bot, chatId, types) {
  if (anyGameActive(chatId)) return null;
  if (!types || types.length === 0) return null;

  const type = types[Math.floor(Math.random() * types.length)];
  const sendMessage = (cid, text) => bot.telegram.sendMessage(cid, text);

  if (type === 'fasttyping') {
    const settings = loadSettings();
    const game = fastTyping.startGame(chatId);
    if (!game) return null;
    sendMessage(chatId, `⚡ PLOMP RUSH — FAST TYPING\n\nType this EXACTLY, first correct wins:\n\n"${game.phrase}"\n\n⏱ ${settings.fastTyping.timeLimitSeconds}s`);
    return 'fasttyping';
  }

  if (type === 'riddle') {
    const game = keepersRiddle.startRiddle(chatId);
    if (!game) return null;
    const r = game.riddle;
    let msg = `🟣 KEEPER'S RIDDLE CHAPTER ${r.chapter}\n\n${r.question}`;
    if (r.options) {
      msg += `\n\n${r.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
    }
    msg += `\n\nOne answer per person. First correct gets a bonus.`;
    sendMessage(chatId, msg);
    return 'riddle';
  }

  if (type === 'trial') {
    const session = ashbornTrial.startTrial(chatId, sendMessage);
    if (!session) return null;
    return 'trial';
  }

  return null;
}

async function checkAutoEvents(bot) {
  const settings = loadSettings();
  const cfg = settings.autoEvents;
  if (!cfg || !cfg.enabled || !settings.primaryChatId) return;

  const now = new Date();
  const intervalMinutes = Math.max(5, cfg.intervalMinutes);
  const targetMinute = cfg.targetMinute != null ? ((cfg.targetMinute % intervalMinutes) + intervalMinutes) % intervalMinutes : 10;

  if (!isAlignedFireTime(now, intervalMinutes, targetMinute)) return;

  // Guard against firing twice within the same qualifying minute
  const minuteKey = Math.floor(now.getTime() / 60000);
  const state = loadState();
  if (state.lastFiredMinuteKey === minuteKey) return;

  const fired = triggerRandomEvent(bot, settings.primaryChatId, cfg.types);
  if (fired) {
    state.lastFiredMinuteKey = minuteKey;
    state.lastAutoEventAt = now.toISOString();
    saveState(state);
    console.log(`[autoEvents] Fired "${fired}" in chat ${settings.primaryChatId} at :${String(now.getUTCMinutes()).padStart(2, '0')} past the hour (UTC).`);
  }
}

function startAutoEvents(bot) {
  checkAutoEvents(bot); // catch the current minute immediately on boot, in case it's already aligned
  setInterval(() => checkAutoEvents(bot), CHECK_INTERVAL_MS);
}

module.exports = { startAutoEvents, triggerRandomEvent, isAlignedFireTime, buildEventLeaderboard };