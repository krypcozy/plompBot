const fs = require('fs');
const path = require('path');
const { loadSettings } = require('./xpEngine');
const { allUsers } = require('./users');
const fastTyping = require('./games/fastTyping');
const keepersRiddle = require('./games/keepersRiddle');
const ashbornTrial = require('./games/ashbornTrial');
const hiddenClue = require('./games/hiddenClue');

const STATE_PATH = path.join(__dirname, '../data/autoEventsState.json');
const CHECK_INTERVAL_MS = 60 * 1000; // tick every minute

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastAutoEventAt: null, lastAutoEventBucket: null };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function anyGameActive(chatId) {
  return fastTyping.isGameActive(chatId)
    || keepersRiddle.isRiddleActive(chatId)
    || ashbornTrial.isTrialActive(chatId)
    || hiddenClue.isActive(chatId);
}

function displayName(user) {
  if (!user) return 'Plomper';
  if (user.username) return `@${user.username}`;
  return user.firstName || 'Plomper';
}

function buildEventLeaderboard(users = allUsers()) {
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

function triggerRandomEvent(bot, chatId, types) {
  if (anyGameActive(chatId)) return null;
  if (!types || types.length === 0) return null;
  const type = types[Math.floor(Math.random() * types.length)];
  const sendMessage = (cid, text) => bot.telegram.sendMessage(cid, text);

  if (type === 'fasttyping') {
    const settings = loadSettings();
    const game = fastTyping.startGame(chatId);
    if (!game) return null;
    sendMessage(chatId, `⚡ PLOMP RUSH — FAST TYPING\n\nType this EXACTLY, first correct wins:\n\n"${game.phrase}"\n\n⏱ ${settings.fastTyping.timeLimitSeconds}s\n\nThis question stays open for 10 minutes total.`);
    return 'fasttyping';
  }

  if (type === 'riddle') {
    const game = keepersRiddle.startRiddle(chatId);
    if (!game) return null;
    const r = game.riddle;
    let msg = `🟣 KEEPER'S RIDDLE — CHAPTER ${r.chapter}\n\n${r.question}`;
    if (r.options) {
      msg += `\n\n${r.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
    }
    msg += `\n\nAnswer in the chat. First correct gets a bonus.\n\n⏱ 10 minutes total, with a warning at 5 minutes.`;
    const sent = sendMessage(chatId, msg);
    if (sent && typeof sent.then === 'function') {
      sent.then((message) => {
        if (message && message.message_id) keepersRiddle.setMessageId(chatId, message.message_id);
      }).catch(() => {});
    }
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

  const intervalMs = Math.max(5, Number(cfg.intervalMinutes) || 60) * 60 * 1000;
  const state = loadState();
  const last = state.lastAutoEventAt ? new Date(state.lastAutoEventAt).getTime() : 0;
  if (Date.now() - last < intervalMs) return;

  const fired = triggerRandomEvent(bot, settings.primaryChatId, cfg.types);
  if (fired) {
    state.lastAutoEventAt = new Date().toISOString();
    saveState(state);
    console.log(`[autoEvents] Fired "${fired}" in chat ${settings.primaryChatId}.`);
  }
}

function startAutoEvents(bot) {
  setInterval(() => checkAutoEvents(bot), CHECK_INTERVAL_MS);
}

module.exports = { startAutoEvents, triggerRandomEvent, buildEventLeaderboard };
