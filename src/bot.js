require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');

const { getUser, saveUsers } = require('./users');
const { checkMessage } = require('./antiSpam');
const { awardXP, updateStreak, loadSettings } = require('./xpEngine');
const { formatProfile } = require('./profile');
const { buildLeaderboard, formatLeaderboard, exportCSV } = require('./leaderboards');
const { resetSeason } = require('./season');
const fastTyping = require('./games/fastTyping');
const keepersRiddle = require('./games/keepersRiddle');
const ashbornTrial = require('./games/ashbornTrial');
const hiddenClue = require('./games/hiddenClue');
const ticTacToe = require('./games/ticTacToe');
const connectFour = require('./games/connectFour');
const wallet = require('./wallet');
const { startScheduler, postWeeklyDigest } = require('./scheduler');
const { startAutoEvents } = require('./autoEvents');
const ui = require('./ui');

const SPAM_PRESETS = {
  relaxed: { cooldownSeconds: 20, minMessageLength: 5, minWordCount: 2, dailyXpCap: 800 },
  normal: { cooldownSeconds: 45, minMessageLength: 8, minWordCount: 3, dailyXpCap: 500 },
  strict: { cooldownSeconds: 90, minMessageLength: 12, minWordCount: 4, dailyXpCap: 300 }
};

const SETTINGS_PATH = path.join(__dirname, '../config/settings.json');
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN. Copy .env.example to .env and fill in your bot token.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

bot.catch((err, ctx) => {
  console.error(`[bot] Unhandled error for update type "${ctx.updateType}" in chat ${ctx.chat ? ctx.chat.id : 'unknown'}:`, err);
});

function isAdmin(userId) {
  const settings = loadSettings();
  return settings.adminIds.map(Number).includes(Number(userId));
}

function userMeta(ctx) {
  return {
    username: ctx.from.username,
    firstName: ctx.from.first_name
  };
}

function displayName(meta) {
  return meta.username ? `@${meta.username}` : meta.firstName || 'Plomper';
}

// ---------------------------------------------------------------------
// MESSAGE HANDLER — mini-game answers, then normal XP/streak flow
// ---------------------------------------------------------------------
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const meta = userMeta(ctx);

  if (wallet.isPendingWalletInput(userId)) {
    const canonical = wallet.normalizeSolanaAddress(text);
    if (!canonical) {
      await ctx.reply(ui.walletInvalidText(), ui.walletEnterPromptKeyboard());
      return;
    }
    const result = wallet.registerWallet(userId, canonical);
    wallet.clearPendingWalletInput(userId);
    if (!result.ok) {
      await ctx.reply(ui.walletTakenText(), ui.backToMainKeyboard());
      return;
    }
    await ctx.reply(`✅ Wallet registered: ${wallet.shortenAddress(result.address)}\n\nThis is where rewards will be sent.`, ui.backToMainKeyboard());
    return;
  }

  if (fastTyping.isGameActive(chatId)) {
    const result = fastTyping.checkAnswer(chatId, userId, meta, text);
    if (result && result.won) {
      await ctx.reply(`⚡ FAST TYPING — ${displayName(meta)} nailed it in ${result.elapsed}s!\n+${result.xp} XP (Community)`);
      return;
    }
  }

  // Each of the three riddle-based games now enforces ONE attempt per
  // person per question at the engine level: checkAnswer() returns null
  // (no response at all) if this user already used their attempt on the
  // current question, and always returns a real {correct: true/false}
  // result on their first-ever message while it's active — so every
  // genuine first attempt gets a response, right or wrong, with no
  // reliance on the person using Telegram's "reply" feature.
  if (keepersRiddle.isRiddleActive(chatId)) {
    const result = keepersRiddle.checkAnswer(chatId, userId, meta, text);
    if (result && result.correct) {
      const tag = result.isFirst ? "🟢 FIRST CORRECT — bonus applied!" : '🟢 CORRECT';
      await ctx.reply(`${tag}\n${displayName(meta)} solved the Keeper's Riddle.\n+${result.xp} XP (Chronicles)`);
      return;
    }
    if (result && result.correct === false) {
      await ctx.reply(`❌ Not quite, ${displayName(meta)} — that was your one shot on this riddle!`);
      return;
    }
  }

  if (ashbornTrial.isTrialActive(chatId)) {
    const result = ashbornTrial.checkAnswer(chatId, userId, meta, text);
    if (result && result.correct) {
      const tag = result.isFirst ? '🟠 FIRST CORRECT' : '🟠 CORRECT';
      await ctx.reply(`${tag} — ${displayName(meta)} +${result.xp} XP`);
      return;
    }
    if (result && result.correct === false) {
      await ctx.reply(`❌ Not quite, ${displayName(meta)} — that was your one shot on this round!`);
      return;
    }
  }

  if (hiddenClue.isActive(chatId)) {
    const result = hiddenClue.checkAnswer(chatId, userId, meta, text);
    if (result && result.correct) {
      await ctx.reply(`🟢 CORRECT\n${displayName(meta)} has solved the Keeper's riddle.\n\n🎁 Mystery Reward unlocked.\n+${result.xp} XP (Chronicles)\n\nThe Chronicles continue...`);
      return;
    }
    if (result && result.correct === false) {
      await ctx.reply(`❌ Not quite, ${displayName(meta)} — that was your one shot on this one!`);
      return;
    }
  }

  const check = checkMessage(userId, meta, text);
  if (!check.eligible) return;

  const settings = loadSettings();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const xpAmount = words.length >= 8 ? settings.xp.message_meaningful : settings.xp.message_normal;

  awardXP(userId, meta, 'community', xpAmount);
  updateStreak(userId, meta);

  const dropped = hiddenClue.maybeTrigger(chatId);
  if (dropped) {
    let clueMsg = `⚠️ SECRET QUESTION\n\nThe Keeper has appeared.\n\n${dropped.question}`;
    if (dropped.options) {
      clueMsg += `\n\n${dropped.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
    }
    clueMsg += `\n\nOne answer per person. First correct wins the Mystery Reward.`;
    await ctx.reply(clueMsg);
  }
});

// ---------------------------------------------------------------------
// PLAYER COMMANDS
// ---------------------------------------------------------------------
bot.command('profile', (ctx) => {
  ctx.reply(formatProfile(ctx.from.id, userMeta(ctx)));
});

bot.command('leaderboard', (ctx) => {
  const arg = (ctx.message.text.split(' ')[1] || 'chronicles').toLowerCase();
  const category = arg.startsWith('comm') ? 'community' : 'chronicles';
  const title = category === 'chronicles' ? '🧠 CHRONICLES LEADERBOARD — SEASON' : '💬 COMMUNITY ACTIVITY LEADERBOARD — SEASON';
  const rows = buildLeaderboard(category, 'season', 10);
  ctx.reply(formatLeaderboard(rows, title));
});

bot.command('lifetimeboard', (ctx) => {
  const arg = (ctx.message.text.split(' ')[1] || 'chronicles').toLowerCase();
  const category = arg.startsWith('comm') ? 'community' : 'chronicles';
  const title = category === 'chronicles' ? '🧠 CHRONICLES — LIFETIME' : '💬 COMMUNITY — LIFETIME';
  const rows = buildLeaderboard(category, 'lifetime', 10);
  ctx.reply(formatLeaderboard(rows, title));
});

bot.command('setfaction', (ctx) => {
  const valid = ['Green Order', 'Black Tide', 'Ashborn', 'Keepers'];
  const faction = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!valid.includes(faction)) {
    return ctx.reply(`Usage: /setfaction <faction>\nValid factions: ${valid.join(' | ')}`);
  }
  const user = getUser(ctx.from.id, userMeta(ctx));
  user.faction = faction;
  saveUsers();
  ctx.reply(`🟢 You have pledged yourself to the ${faction}.`);
});

// ---------------------------------------------------------------------
// MINI-GAME TRIGGERS (admin-only)
// ---------------------------------------------------------------------
bot.command('fasttyping', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can start this.');
  const settings = loadSettings();
  const game = fastTyping.startGame(ctx.chat.id);
  if (!game) return ctx.reply('A Fast Typing challenge is already running here.');
  ctx.reply(`⚡ PLOMP RUSH — FAST TYPING\n\nType this EXACTLY, first correct wins:\n\n"${game.phrase}"\n\n⏱ ${settings.fastTyping.timeLimitSeconds}s`);
});

bot.command('trial', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can start this.');
  const sendMessage = (chatId, text) => bot.telegram.sendMessage(chatId, text);
  const session = ashbornTrial.startTrial(ctx.chat.id, sendMessage);
  if (!session) return ctx.reply('An Ashborn Trial is already running here.');
});

bot.command('riddle', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can start this.');
  const chapterArg = ctx.message.text.split(' ')[1];
  const game = keepersRiddle.startRiddle(ctx.chat.id, chapterArg);
  if (!game) return ctx.reply("A Keeper's Riddle is already active here.");

  const r = game.riddle;
  let msg = `🟣 KEEPER'S RIDDLE — CHAPTER ${r.chapter}\n\n${r.question}`;
  if (r.options) {
    msg += `\n\n${r.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
  }
  msg += `\n\nOne answer per person. First correct gets a bonus.`;
  await ctx.reply(msg);
});

// ---------------------------------------------------------------------
// ADMIN COMMANDS
// ---------------------------------------------------------------------
bot.command('addxp', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const parts = ctx.message.text.split(' ');
  const amount = parseInt(parts[parts.length - 1], 10);
  const targetMsg = ctx.message.reply_to_message;

  if (!targetMsg || isNaN(amount)) {
    return ctx.reply("Reply to a Plomper's message with:\n/addxp <chronicles|community> <amount>");
  }

  const category = parts[1] === 'community' ? 'community' : 'chronicles';
  const targetMeta = { username: targetMsg.from.username, firstName: targetMsg.from.first_name };
  const result = awardXP(targetMsg.from.id, targetMeta, category, amount, { ignoreCap: true });
  ctx.reply(`Added ${result.awarded} ${category} XP to ${displayName(targetMeta)}.`);
});

bot.command('setxp', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const parts = ctx.message.text.split(' ');
  const key = parts[1];
  const value = parseInt(parts[2], 10);
  const settings = loadSettings();

  if (!key || isNaN(value) || !(key in settings.xp)) {
    return ctx.reply(`Usage: /setxp <key> <value>\nValid keys: ${Object.keys(settings.xp).join(', ')}`);
  }

  settings.xp[key] = value;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  ctx.reply(`Set ${key} = ${value} XP.`);
});

bot.command('resetseason', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const { newSeason } = resetSeason();
  ctx.reply(`🏅 Season ${newSeason.number - 1} has ended and been archived.\nSeason ${newSeason.number} begins now.\n\nLifetime XP is untouched — only the season boards reset.`);
});

bot.command('export', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const arg = (ctx.message.text.split(' ')[1] || 'chronicles').toLowerCase();
  const category = arg.startsWith('comm') ? 'community' : 'chronicles';
  const csv = exportCSV(category, 'season');

  const filePath = path.join(__dirname, `../data/exports/${category}-season-export.csv`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv);

  await ctx.replyWithDocument({ source: filePath, filename: `${category}-leaderboard.csv` });
});

bot.command('whoami', (ctx) => {
  const settings = loadSettings();
  ctx.reply(`Your Telegram ID: ${ctx.from.id}\nRecognized as admin: ${isAdmin(ctx.from.id) ? 'Yes ✅' : 'No ❌'}\nCurrent adminIds: ${JSON.stringify(settings.adminIds)}`);
});

bot.command('setchat', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const settings = loadSettings();
  settings.primaryChatId = ctx.chat.id;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  ctx.reply('✅ This chat is now registered for the weekly digest auto-post.');
});

bot.command('digest', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  await postWeeklyDigest(bot, ctx.chat.id);
});

bot.command('autoevents', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const arg = (ctx.message.text.split(' ')[1] || '').toLowerCase();
  const settings = loadSettings();

  if (arg === 'on') {
    settings.autoEvents.enabled = true;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    const chatNote = settings.primaryChatId ? '' : '\n\n⚠️ No chat registered yet — run /setchat here first, or auto-drops have nowhere to go.';
    return ctx.reply(`✅ Auto-events ON — dropping every ${settings.autoEvents.intervalMinutes} minutes.${chatNote}`);
  }
  if (arg === 'off') {
    settings.autoEvents.enabled = false;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return ctx.reply('⛔ Auto-events OFF.');
  }

  const status = settings.autoEvents.enabled ? 'ON' : 'OFF';
  ctx.reply(`Auto-events are currently ${status}.\nInterval: every ${settings.autoEvents.intervalMinutes} minutes\nTypes: ${settings.autoEvents.types.join(', ')}\nTarget chat: ${settings.primaryChatId || 'not set — use /setchat'}\n\nUsage: /autoevents on | off`);
});

bot.command('setinterval', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const minutes = parseInt(ctx.message.text.split(' ')[1], 10);
  if (isNaN(minutes) || minutes < 5) {
    return ctx.reply('Usage: /setinterval <minutes>\nMinimum 5 minutes, to keep the group from getting spammy.\nExample: /setinterval 60 — drops an event every hour.');
  }
  const settings = loadSettings();
  settings.autoEvents.intervalMinutes = minutes;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  ctx.reply(`⏱ Auto-events will now drop every ${minutes} minutes (once enabled with /autoevents on).`);
});

bot.command('setminute', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const minute = parseInt(ctx.message.text.split(' ')[1], 10);
  if (isNaN(minute) || minute < 0 || minute > 59) {
    return ctx.reply('Usage: /setminute <0-59>\nSets which minute past the hour auto-events land on (UTC).\nExample: /setminute 10 — drops at :10 past every hour.');
  }
  const settings = loadSettings();
  settings.autoEvents.targetMinute = minute;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  ctx.reply(`⏱ Auto-events will now land at :${String(minute).padStart(2, '0')} past the hour (UTC), on the interval already set with /setinterval.`);
});

bot.start(async (ctx) => {
  const payload = ctx.startPayload;
  if (payload === 'wallet') return showWalletScreen(ctx);
  if (payload === 'rewards') return ctx.reply(ui.rewardsText(), ui.rewardsKeyboard());
  if (payload === 'profile') return ctx.reply(formatProfile(ctx.from.id, userMeta(ctx)), ui.backToMainKeyboard());

  ctx.reply(ui.mainMenuText(), ui.mainMenuKeyboard(ctx.botInfo && ctx.botInfo.username, { inGroup: false }));
});

bot.command('menu', (ctx) => {
  const inGroup = ctx.chat.type !== 'private';
  ctx.reply(ui.mainMenuText(), ui.mainMenuKeyboard(ctx.botInfo && ctx.botInfo.username, { inGroup }));
});

// ---------------------------------------------------------------------
// PLAYER MENU — button callbacks (works in both DM and group)
// ---------------------------------------------------------------------
async function safeEdit(ctx, text, keyboard) {
  try {
    await ctx.editMessageText(text, keyboard);
  } catch (err) {
    if (/message is not modified/i.test(err.description || '')) return;
    await ctx.reply(text, keyboard);
  }
}

bot.action('pmenu:main', async (ctx) => {
  await ctx.answerCbQuery();
  const inGroup = ctx.chat.type !== 'private';
  await safeEdit(ctx, ui.mainMenuText(), ui.mainMenuKeyboard(ctx.botInfo && ctx.botInfo.username, { inGroup }));
});

bot.action('pmenu:rankings', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, ui.rankingsText(), ui.rankingsKeyboard());
});

bot.action('pmenu:rankings:chronicles', async (ctx) => {
  await ctx.answerCbQuery();
  const rows = buildLeaderboard('chronicles', 'season', 10);
  await safeEdit(ctx, formatLeaderboard(rows, '🧠 CHRONICLES — SEASON'), ui.rankingsKeyboard());
});

bot.action('pmenu:rankings:community', async (ctx) => {
  await ctx.answerCbQuery();
  const rows = buildLeaderboard('community', 'season', 10);
  await safeEdit(ctx, formatLeaderboard(rows, '💬 COMMUNITY — SEASON'), ui.rankingsKeyboard());
});

bot.action('pmenu:games', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, ui.gamesMenuText(), ui.gamesMenuKeyboard());
});

bot.action('pmenu:games:tictactoe', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.chat.type === 'private') {
    return ctx.reply('Tic-Tac-Toe is a group game — open it in your community chat instead.');
  }
  await startTicTacToeInChat(ctx);
});

bot.action('pmenu:games:connectfour', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.chat.type === 'private') {
    return ctx.reply('Connect Four is a group game — open it in your community chat instead.');
  }
  await startConnectFourInChat(ctx);
});

bot.action('pmenu:profile', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, formatProfile(ctx.from.id, userMeta(ctx)), ui.backToMainKeyboard());
});

bot.action('pmenu:rewards', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, ui.rewardsText(), ui.rewardsKeyboard());
});

bot.action('pmenu:help', async (ctx) => {
  await ctx.answerCbQuery();
  await sendHelpText(ctx);
});

bot.action('pmenu:wallet', async (ctx) => {
  await ctx.answerCbQuery();
  await showWalletScreen(ctx);
});

// ---------------------------------------------------------------------
// WALLET
// ---------------------------------------------------------------------
async function showWalletScreen(ctx) {
  if (ctx.chat.type !== 'private') {
    return ctx.reply(ui.walletGroupText(), ui.walletGroupKeyboard(ctx.botInfo && ctx.botInfo.username));
  }
  const record = wallet.getWallet(ctx.from.id);
  if (!record) {
    return ctx.reply(ui.walletEmptyText(), ui.walletEmptyKeyboard());
  }
  const short = wallet.shortenAddress(record.address);
  return ctx.reply(ui.walletRegisteredText(record, short), ui.walletRegisteredKeyboard());
}

bot.command('wallet', (ctx) => showWalletScreen(ctx));

bot.action('wallet:enter', async (ctx) => {
  await ctx.answerCbQuery();
  wallet.beginWalletInput(ctx.from.id);
  await safeEdit(ctx, ui.walletEnterPromptText(), ui.walletEnterPromptKeyboard());
});

bot.action('wallet:change', async (ctx) => {
  await ctx.answerCbQuery();
  wallet.beginWalletInput(ctx.from.id);
  await safeEdit(ctx, ui.walletEnterPromptText(), ui.walletEnterPromptKeyboard());
});

bot.action('wallet:cancel_input', async (ctx) => {
  wallet.clearPendingWalletInput(ctx.from.id);
  await ctx.answerCbQuery('Cancelled.');
  await showWalletScreen(ctx);
});

bot.action('wallet:remove', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, ui.walletRemoveConfirmText(), ui.walletRemoveConfirmKeyboard());
});

bot.action('wallet:remove_confirm', async (ctx) => {
  wallet.removeWallet(ctx.from.id);
  await ctx.answerCbQuery('Wallet removed.');
  await safeEdit(ctx, ui.walletEmptyText(), ui.walletEmptyKeyboard());
});

bot.action('wallet:remove_cancel', async (ctx) => {
  await ctx.answerCbQuery('Cancelled.');
  await showWalletScreen(ctx);
});

// ---------------------------------------------------------------------
// TIC-TAC-TOE
// ---------------------------------------------------------------------
async function startTicTacToeInChat(ctx) {
  const chatId = ctx.chat.id;
  const editFn = async (cid, messageId, text, keyboard) => {
    try {
      await bot.telegram.editMessageText(cid, messageId, undefined, text, { reply_markup: keyboard });
    } catch (_err) {
      // message may already be gone/unmodifiable — safe to ignore
    }
  };
  const result = ticTacToe.startChallenge(chatId, editFn);
  if (!result) return ctx.reply('A Tic-Tac-Toe challenge is already running here.');
  const sent = await ctx.reply(result.text, { reply_markup: result.keyboard });
  if (sent && sent.message_id) ticTacToe.setMessageId(result.session.id, sent.message_id);
}

bot.command('tictactoe', (ctx) => startTicTacToeInChat(ctx));

bot.action(/^ttt:join:(.+)$/, async (ctx) => {
  const sessionId = ctx.match[1];
  const result = ticTacToe.join(sessionId, ctx.from.id, userMeta(ctx));
  if (!result.ok) {
    const messages = {
      'already-joined': "You're already in this game.",
      'not-waiting': 'This game already started.',
      'invalid-session': 'This game no longer exists.'
    };
    return ctx.answerCbQuery(messages[result.reason] || "Can't join right now.", { show_alert: true });
  }
  await ctx.answerCbQuery(result.started ? 'Game on!' : 'Joined — waiting for an opponent.');
  await safeEdit(ctx, result.rendered.text, { reply_markup: result.rendered.keyboard });
});

bot.action(/^ttt:move:(.+):(\d+)$/, async (ctx) => {
  const sessionId = ctx.match[1];
  const cell = parseInt(ctx.match[2], 10);
  const result = ticTacToe.move(sessionId, ctx.from.id, cell);
  if (!result.ok) {
    const messages = {
      outsider: "You're not in this game.",
      'not-your-turn': "It's not your turn.",
      occupied: 'That square is taken.',
      'not-active': 'This game has ended.',
      'invalid-session': 'This game no longer exists.'
    };
    return ctx.answerCbQuery(messages[result.reason] || "Can't do that.", { show_alert: true });
  }
  await ctx.answerCbQuery();
  await safeEdit(ctx, result.rendered.text, { reply_markup: result.rendered.keyboard });
});

// ---------------------------------------------------------------------
// CONNECT FOUR
// ---------------------------------------------------------------------
async function startConnectFourInChat(ctx) {
  const chatId = ctx.chat.id;
  const editFn = async (cid, messageId, text, keyboard) => {
    try {
      await bot.telegram.editMessageText(cid, messageId, undefined, text, { reply_markup: keyboard });
    } catch (_err) {
      // message may already be gone/unmodifiable — safe to ignore
    }
  };
  const result = connectFour.startChallenge(chatId, editFn);
  if (!result) return ctx.reply('A Connect Four challenge is already running here.');
  const sent = await ctx.reply(result.text, { reply_markup: result.keyboard });
  if (sent && sent.message_id) connectFour.setMessageId(result.session.id, sent.message_id);
}

bot.command(['connect4', 'connectfour'], (ctx) => startConnectFourInChat(ctx));

bot.action(/^c4:join:(.+)$/, async (ctx) => {
  const sessionId = ctx.match[1];
  const result = connectFour.join(sessionId, ctx.from.id, userMeta(ctx));
  if (!result.ok) {
    const messages = {
      'already-joined': "You're already in this game.",
      'not-waiting': 'This game already started.',
      'invalid-session': 'This game no longer exists.'
    };
    return ctx.answerCbQuery(messages[result.reason] || "Can't join right now.", { show_alert: true });
  }
  await ctx.answerCbQuery(result.started ? 'Game on!' : 'Joined — waiting for an opponent.');
  await safeEdit(ctx, result.rendered.text, { reply_markup: result.rendered.keyboard });
});

bot.action(/^c4:move:(.+):(\d+)$/, async (ctx) => {
  const sessionId = ctx.match[1];
  const column = parseInt(ctx.match[2], 10);
  const result = connectFour.move(sessionId, ctx.from.id, column);
  if (!result.ok) {
    const messages = {
      outsider: "You're not in this game.",
      'not-your-turn': "It's not your turn.",
      full: 'That column is full — try another.',
      'not-active': 'This game has ended.',
      'invalid-session': 'This game no longer exists.'
    };
    return ctx.answerCbQuery(messages[result.reason] || "Can't do that.", { show_alert: true });
  }
  await ctx.answerCbQuery();
  await safeEdit(ctx, result.rendered.text, { reply_markup: result.rendered.keyboard });
});

async function sendHelpText(ctx) {
  await ctx.reply([
    '🫧 PLOMP CHRONICLES BOT',
    '',
    'PLAYER COMMANDS',
    '/menu — open the button menu (Rankings, Games, Profile, Wallet, Rewards, Help)',
    '/profile — view your Plomper profile',
    '/leaderboard chronicles|community — this season\'s top 10',
    '/lifetimeboard chronicles|community — all-time top 10',
    '/setfaction <Green Order|Black Tide|Ashborn|Keepers> — pledge your faction',
    '/wallet — register the Solana address rewards get sent to',
    '/tictactoe — start a Tic-Tac-Toe challenge in this chat',
    '/connect4 — start a Connect Four challenge in this chat',
    '',
    'ADMIN COMMANDS',
    '/settings — open the button-based group settings panel (Auto-Events, Weekly Digest, Anti-Spam, Reset)',
    '/fasttyping — start a Fast Typing challenge',
    '/riddle [chapter] — start a Keeper\'s Riddle (e.g. /riddle III)',
    '/trial — start an Ashborn Trial (chained rapid-fire questions)',
    '/setchat — register this chat for the weekly auto-digest AND auto-events',
    '/digest — manually post the weekly leaderboard + Mystery Box digest now (for testing)',
    '/autoevents on|off — turn automatic riddle/fast-typing/trial drops on or off',
    '/setinterval <minutes> — how often auto-events drop (e.g. 60 = hourly, like ChatFight)',
    '/setminute <0-59> — which minute past the hour auto-events land on, e.g. /setminute 10',
    '/addxp <chronicles|community> <amount> — reply to a user to award XP',
    '/setxp <key> <value> — adjust an XP value',
    '/resetseason — archive current season, start a new one',
    '/export chronicles|community — download season leaderboard as CSV',
    '',
    'Note: a Hidden Clue ("Secret Question") occasionally appears on its own — no command needed, it\'s a rare surprise for whoever is in chat. Everyone gets one answer per question, right or wrong — the bot always replies to your first attempt.'
  ].join('\n'));
}

async function renderGroupPanel(ctx, screen) {
  const settings = loadSettings();
  const screens = {
    main: [ui.groupSettingsText(settings), ui.groupSettingsKeyboard()],
    autoevents: [ui.autoEventsText(settings), ui.autoEventsKeyboard(settings)],
    digest: [ui.digestText(settings), ui.digestKeyboard(settings)],
    antispam: [ui.antiSpamText(settings), ui.antiSpamKeyboard()],
    games: [ui.gamesText(), ui.gamesKeyboard()],
    reset_confirm: [ui.resetConfirmText(), ui.resetConfirmKeyboard()]
  };
  const [text, keyboard] = screens[screen] || screens.main;
  try {
    await ctx.editMessageText(text, keyboard);
  } catch (err) {
    if (!/message is not modified/i.test(err.description || '')) throw err;
  }
}

function adminAction(handler) {
  return async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery('Only an admin can edit those settings.', { show_alert: true });
    }
    await handler(ctx);
  };
}

bot.command('settings', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council (admins) can do this. Check that your Telegram ID is correctly listed in adminIds in config/settings.json.');
  const settings = loadSettings();
  ctx.reply(ui.groupSettingsText(settings), ui.groupSettingsKeyboard());
});

bot.action('grp:main', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'main');
}));

bot.action('grp:autoevents', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'autoevents');
}));

bot.action('grp:digest', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'digest');
}));

bot.action('grp:antispam', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'antispam');
}));

bot.action('grp:games', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'games');
}));

bot.action('grp:reset_confirm', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'reset_confirm');
}));

bot.action('grp:reset_do', adminAction(async (ctx) => {
  const { newSeason } = resetSeason();
  await ctx.answerCbQuery('Season reset.', { show_alert: true });
  try {
    await ctx.editMessageText(`🏅 Season ${newSeason.number - 1} archived. Season ${newSeason.number} begins now.\n\nLifetime XP is untouched.`, ui.groupSettingsKeyboard());
  } catch (err) {
    if (!/message is not modified/i.test(err.description || '')) throw err;
  }
}));

bot.action('grp:close', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await ctx.editMessageText('Settings closed. Run /settings anytime to reopen.');
  } catch (err) {
    if (!/message is not modified/i.test(err.description || '')) throw err;
  }
}));

bot.action('auto:on', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.autoEvents.enabled = true;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery('Auto-Events ON');
  await renderGroupPanel(ctx, 'autoevents');
}));

bot.action('auto:off', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.autoEvents.enabled = false;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery('Auto-Events OFF');
  await renderGroupPanel(ctx, 'autoevents');
}));

bot.action(/^auto:interval:(\d+)$/, adminAction(async (ctx) => {
  const minutes = parseInt(ctx.match[1], 10);
  const settings = loadSettings();
  settings.autoEvents.intervalMinutes = minutes;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery(`Interval set to ${minutes} min`);
  await renderGroupPanel(ctx, 'autoevents');
}));

bot.action(/^auto:minute:(\d+)$/, adminAction(async (ctx) => {
  const minute = parseInt(ctx.match[1], 10);
  const settings = loadSettings();
  settings.autoEvents.targetMinute = minute;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery(`Now landing at :${String(minute).padStart(2, '0')} past the hour`);
  await renderGroupPanel(ctx, 'autoevents');
}));

bot.action(/^auto:type:(riddle|fasttyping|trial)$/, adminAction(async (ctx) => {
  const type = ctx.match[1];
  const settings = loadSettings();
  const idx = settings.autoEvents.types.indexOf(type);
  if (idx === -1) settings.autoEvents.types.push(type);
  else settings.autoEvents.types.splice(idx, 1);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'autoevents');
}));

bot.action('digest:on', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.weeklyDigest.enabled = true;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery('Weekly Digest ON');
  await renderGroupPanel(ctx, 'digest');
}));

bot.action('digest:off', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.weeklyDigest.enabled = false;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery('Weekly Digest OFF');
  await renderGroupPanel(ctx, 'digest');
}));

bot.action('digest:setchat', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.primaryChatId = ctx.chat.id;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery('This chat is now registered.');
  await renderGroupPanel(ctx, 'digest');
}));

bot.action('digest:postnow', adminAction(async (ctx) => {
  await ctx.answerCbQuery('Posting now...');
  await postWeeklyDigest(bot, ctx.chat.id);
}));

bot.action(/^spam:(relaxed|normal|strict)$/, adminAction(async (ctx) => {
  const level = ctx.match[1];
  const settings = loadSettings();
  Object.assign(settings.antiSpam, SPAM_PRESETS[level]);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery(`Anti-spam set to ${level}`);
  await renderGroupPanel(ctx, 'antispam');
}));

// ---------------------------------------------------------------------
// GROUP ONBOARDING — fires automatically when the bot is added to a group
// ---------------------------------------------------------------------
bot.on('my_chat_member', async (ctx) => {
  const update = ctx.myChatMember;
  const wasOut = ['left', 'kicked'].includes(update.old_chat_member.status);
  const isInNow = ['member', 'administrator'].includes(update.new_chat_member.status);
  if (wasOut && isInNow) {
    await ctx.telegram.sendMessage(update.chat.id, ui.onboardingText(), ui.onboardingKeyboard());
  }
});

bot.action('onboard:auto_on', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.autoEvents.enabled = true;
  if (!settings.primaryChatId) settings.primaryChatId = ctx.chat.id;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery('Auto-Events enabled — hourly.');
  try {
    await ctx.editMessageText(`✅ Auto-Events are ON — dropping a Riddle, Fast Typing, or Trial every ${settings.autoEvents.intervalMinutes} minutes.\n\nAdjust anytime with /settings.`);
  } catch (err) {
    if (!/message is not modified/i.test(err.description || '')) throw err;
  }
}));

bot.action('onboard:digest_setchat', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.primaryChatId = ctx.chat.id;
  settings.weeklyDigest.enabled = true;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery('Weekly Digest enabled here.');
  try {
    await ctx.editMessageText('✅ Weekly Digest is ON for this chat — the leaderboard + Mystery Box winner post here once a week.\n\nAdjust anytime with /settings.');
  } catch (err) {
    if (!/message is not modified/i.test(err.description || '')) throw err;
  }
}));

bot.action('onboard:try_riddle', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  const game = keepersRiddle.startRiddle(ctx.chat.id);
  if (!game) return ctx.reply("A Keeper's Riddle is already active here.");
  const r = game.riddle;
  let msg = `🟣 KEEPER'S RIDDLE — CHAPTER ${r.chapter}\n\n${r.question}`;
  if (r.options) {
    msg += `\n\n${r.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
  }
  msg += '\n\nOne answer per person — first correct gets a bonus.';
  await ctx.reply(msg);
}));

bot.command('help', (ctx) => sendHelpText(ctx));

bot.launch();
console.log('🫧 Plomp Chronicles bot is online.');
startScheduler(bot);
startAutoEvents(bot);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));