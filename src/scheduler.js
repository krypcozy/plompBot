const fs = require('fs');
const path = require('path');
const { loadSettings } = require('./xpEngine');
const { buildLeaderboard, formatLeaderboard } = require('./leaderboards');

const STATE_PATH = path.join(__dirname, '../../data/schedulerState.json');
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastWeeklyDigestAt: null };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * One combined weekly post: top-5 on both leaderboards + the Mystery Box
 * winner announcement, all in a single message. Intentionally not two
 * separate posts — one message, once a week, keeps it from feeling spammy.
 */
function buildWeeklyDigestMessage() {
  const chronRows = buildLeaderboard('chronicles', 'season', 5);
  const commRows = buildLeaderboard('community', 'season', 5);

  let msg = '📯 WEEKLY SIGNAL — THE PLOMP CHRONICLES\n\n';
  msg += formatLeaderboard(chronRows, '🧠 CHRONICLES — TOP 5') + '\n\n';
  msg += formatLeaderboard(commRows, '💬 COMMUNITY — TOP 5') + '\n\n';

  if (chronRows.length > 0) {
    msg += `🎁 WEEKLY MYSTERY BOX\n\n${chronRows[0].name} leads the Chronicles this week.\nA Mystery Box awaits — reach out to claim it.`;
  } else {
    msg += '🎁 No Chronicles leader yet this week — the Mystery Box rolls over.';
  }

  return msg;
}

async function postWeeklyDigest(bot, chatId) {
  await bot.telegram.sendMessage(chatId, buildWeeklyDigestMessage());
}

async function checkWeeklyDigest(bot) {
  const settings = loadSettings();
  const cfg = settings.weeklyDigest;
  if (!cfg || !cfg.enabled || !settings.primaryChatId) return;

  const now = new Date();
  const state = loadState();
  const last = state.lastWeeklyDigestAt ? new Date(state.lastWeeklyDigestAt) : null;

  const isTargetDay = now.getUTCDay() === cfg.dayOfWeek;
  const isTargetHour = now.getUTCHours() === cfg.hourUTC;
  const alreadyPostedThisWeek = last && now - last < 6 * 24 * 60 * 60 * 1000;

  if (isTargetDay && isTargetHour && !alreadyPostedThisWeek) {
    try {
      await postWeeklyDigest(bot, settings.primaryChatId);
      state.lastWeeklyDigestAt = now.toISOString();
      saveState(state);
      console.log('[scheduler] Weekly digest posted.');
    } catch (err) {
      console.error('[scheduler] Failed to post weekly digest:', err.message);
    }
  }
}

function startScheduler(bot) {
  checkWeeklyDigest(bot); // catch up immediately on boot, in case it's already the right time
  setInterval(() => checkWeeklyDigest(bot), CHECK_INTERVAL_MS);
}

module.exports = { startScheduler, postWeeklyDigest, buildWeeklyDigestMessage };
