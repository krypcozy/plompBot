require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');

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

const BOT_COMMANDS = [
  { command: 'start', description: 'Open the Plomp Chronicles menu' },
  { command: 'profile', description: 'View your Plomper profile' },
  { command: 'leaderboard', description: 'View the season leaderboard' },
  { command: 'lifetimeboard', description: 'View the lifetime leaderboard' },
  { command: 'setfaction', description: 'Pledge a faction' },
  { command: 'settings', description: 'Open group settings (admins)' },
  { command: 'fasttyping', description: 'Start a Fast Typing challenge (admins)' },
  { command: 'riddle', description: "Start Keeper's Riddle (admins)" },
  { command: 'trial', description: 'Start an Ashborn Trial (admins)' },
  { command: 'tictactoe', description: 'Start a Tic-Tac-Toe game' },
  { command: 'connectfour', description: 'Start a Connect Four game' },
  { command: 'setchat', description: 'Register this chat (admins)' },
  { command: 'digest', description: 'Post the weekly digest now (admins)' },
  { command: 'autoevents', description: 'Manage automatic events (admins)' },
  { command: 'setinterval', description: 'Set the auto-event interval (admins)' },
  { command: 'addxp', description: 'Award XP to a replied user (admins)' },
  { command: 'setxp', description: 'Change an XP value (admins)' },
  { command: 'resetseason', description: 'Reset the current season (admins)' },
  { command: 'export', description: 'Export a leaderboard as CSV (admins)' },
  { command: 'whoami', description: 'Show your Telegram user ID' },
  { command: 'help', description: 'Show help and all commands' }
];

const SETTINGS_PATH = path.join(__dirname, '../config/settings.json');
const TTT_BOARD_IMAGE = path.join(__dirname, '../assets/games/tictactoe-board.jpg');
const C4_BOARD_IMAGE = path.join(__dirname, '../assets/games/connectfour-board.jpg');
const LOCK_PATH = path.join(__dirname, '../.bot.lock');
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN. Copy .env.example to .env and fill in your bot token.');
  process.exit(1);
}

function acquireSingleInstanceLock() {
  try {
    const lockFd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeFileSync(lockFd, String(process.pid));
    fs.closeSync(lockFd);

    const removeLock = () => {
      try {
        if (fs.existsSync(LOCK_PATH)) {
          fs.unlinkSync(LOCK_PATH);
        }
      } catch (err) {
        // Ignore cleanup errors: the process is already stopping.
      }
    };

    process.on('exit', removeLock);
    process.on('SIGINT', removeLock);
    process.on('SIGTERM', removeLock);
    return true;
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      console.error('Another Plomp Chronicles bot instance is already running. Exiting to avoid Telegram polling conflicts.');
      process.exit(1);
    }
    throw err;
  }
}

acquireSingleInstanceLock();

const bot = new Telegraf(BOT_TOKEN);

function isAdmin(userId) {
  const settings = loadSettings();
  // Compare as numbers so it doesn't matter whether adminIds was entered
  // with or without quotes in settings.json.
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
  const replyToMessageId = ctx.message.reply_to_message ? ctx.message.reply_to_message.message_id : null;

  if (wallet.isPendingWalletInput(userId)) {
    const result = wallet.registerWallet(userId, text);
    if (!result.ok) {
      await ctx.reply(result.reason === 'taken'
        ? ui.walletTakenText()
        : ui.walletInvalidText(), ui.walletEnterPromptKeyboard());
      return;
    }
    wallet.clearPendingWalletInput(userId);
    const record = wallet.getWallet(userId);
    await ctx.reply(ui.walletRegisteredText(record, wallet.shortenAddress(result.address)), ui.walletRegisteredKeyboard());
    return;
  }

  if (fastTyping.isGameActive(chatId)) {
    const result = fastTyping.checkAnswer(chatId, userId, meta, text);
    if (result && result.won) {
      await ctx.reply(`⚡ FAST TYPING — ${displayName(meta)} nailed it in ${result.elapsed}s!\n+${result.xp} XP (Community)`);
      return;
    }
  }

  if (keepersRiddle.isRiddleActive(chatId)) {
    const result = keepersRiddle.checkAnswer(chatId, userId, meta, text, replyToMessageId);
    if (result && result.correct) {
      const tag = result.isFirst ? "🟢 FIRST CORRECT — bonus applied!" : '🟢 CORRECT';
      await ctx.reply(`${tag}\n${displayName(meta)} solved the Keeper's Riddle.\n+${result.xp} XP (Chronicles)`);
      return;
    }
    if (result && result.alreadyAttempted) {
      await ctx.reply(`⛔ ${displayName(meta)}, you already used your attempt for this question.`);
      return;
    }
    if (result && result.isReplyAttempt) {
      await ctx.reply('❌ Wrong answer. Keep trying.', { reply_to_message_id: ctx.message.message_id });
      return;
    }
  }

  if (ashbornTrial.isTrialActive(chatId)) {
    const result = ashbornTrial.checkAnswer(chatId, userId, meta, text, replyToMessageId);
    if (result && result.correct) {
      const tag = result.isFirst ? '🟠 FIRST CORRECT' : '🟠 CORRECT';
      await ctx.reply(`${tag} — ${displayName(meta)} +${result.xp} XP`);
      return;
    }
    if (result && result.alreadyAttempted) {
      await ctx.reply(`⛔ ${displayName(meta)}, you already used your attempt for this round.`);
      return;
    }
    if (result && result.isReplyAttempt) {
      await ctx.reply('❌ Wrong answer. Keep trying.', { reply_to_message_id: ctx.message.message_id });
      return;
    }
  }

  if (hiddenClue.isActive(chatId)) {
    const result = hiddenClue.checkAnswer(chatId, userId, meta, text, replyToMessageId);
    if (result && result.correct) {
      await ctx.reply(`🟢 CORRECT\n${displayName(meta)} has solved the Keeper's riddle.\n\n🎁 Mystery Reward unlocked.\n+${result.xp} XP (Chronicles)\n\nThe Chronicles continue...`);
      return;
    }
    if (result && result.alreadyAttempted) {
      await ctx.reply(`⛔ ${displayName(meta)}, you already used your attempt for this question.`);
      return;
    }
    if (result && result.isReplyAttempt) {
      await ctx.reply('❌ Wrong answer. Keep trying.', { reply_to_message_id: ctx.message.message_id });
      return;
    }
  }

  // Normal community-activity XP flow
  const check = checkMessage(userId, meta, text);
  if (!check.eligible) return; // spam/cooldown/low-quality — ignored silently

  const settings = loadSettings();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const xpAmount = words.length >= 8 ? settings.xp.message_meaningful : settings.xp.message_normal;

  awardXP(userId, meta, 'community', xpAmount);
  updateStreak(userId, meta);

  // Rare, rate-limited chance to drop an unprompted Secret Question
  const dropped = hiddenClue.maybeTrigger(chatId);
  if (dropped) {
    let clueMsg = `⚠️ SECRET QUESTION\n\nThe Keeper has appeared.\n\n${dropped.question}`;
    if (dropped.options) {
      clueMsg += `\n\n${dropped.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
    }
    clueMsg += `\n\nFirst person to answer correctly receives a Mystery Reward.`;
    const sent = await ctx.reply(clueMsg);
    hiddenClue.setMessageId(chatId, sent.message_id);
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
// MINI-GAME TRIGGERS (admin-only — Cozy runs these, not automated)
// ---------------------------------------------------------------------
bot.command('fasttyping', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  const settings = loadSettings();
  const game = fastTyping.startGame(ctx.chat.id);
  if (!game) return ctx.reply('A Fast Typing challenge is already running here.');
  ctx.reply(`⚡ PLOMP RUSH — FAST TYPING\n\nType this EXACTLY, first correct wins:\n\n"${game.phrase}"\n\n⏱ ${settings.fastTyping.timeLimitSeconds}s`);
});

bot.command('trial', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  const sendMessage = (chatId, text) => bot.telegram.sendMessage(chatId, text);
  const session = ashbornTrial.startTrial(ctx.chat.id, sendMessage);
  if (!session) return ctx.reply('An Ashborn Trial is already running here.');
  // startTrial posts the first round itself via sendMessage
});

bot.command('riddle', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  const chapterArg = ctx.message.text.split(' ')[1];
  const game = keepersRiddle.startRiddle(ctx.chat.id, chapterArg);
  if (!game) return ctx.reply("A Keeper's Riddle is already active here.");

  const r = game.riddle;
  let msg = `🟣 KEEPER'S RIDDLE — CHAPTER ${r.chapter}\n\n${r.question}`;
  if (r.options) {
    msg += `\n\n${r.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
  }
  msg += `\n\nAnswer in the chat. First correct gets a bonus.`;
  const sent = await ctx.reply(msg);
  keepersRiddle.setMessageId(ctx.chat.id, sent.message_id);
});

// ---------------------------------------------------------------------
// ADMIN COMMANDS
// ---------------------------------------------------------------------
bot.command('addxp', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
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
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
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
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  const { newSeason } = resetSeason();
  ctx.reply(`🏅 Season ${newSeason.number - 1} has ended and been archived.\nSeason ${newSeason.number} begins now.\n\nLifetime XP is untouched — only the season boards reset.`);
});

bot.command('export', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
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
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  const settings = loadSettings();
  settings.primaryChatId = ctx.chat.id;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  ctx.reply('✅ This chat is now registered for the weekly digest auto-post.');
});

bot.command('digest', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  await postWeeklyDigest(bot, ctx.chat.id);
});

bot.command('autoevents', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  const arg = (ctx.message.text.split(' ')[1] || '').toLowerCase();
  const settings = loadSettings();
  if (!settings.autoEvents) {
    settings.autoEvents = {
      enabled: false,
      intervalMinutes: 60,
      types: ['riddle', 'fasttyping', 'trial']
    };
  }

  if (arg === 'on') {
    settings.autoEvents.enabled = true;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    const chatNote = settings.primaryChatId ? '' : '\n\n⚠️ No chat is set yet. Run /setchat here first so the drops go to the right place.';
    return ctx.reply(`✅ Automatic drops are ON. They will happen every ${settings.autoEvents.intervalMinutes} minutes.${chatNote}`);
  }
  if (arg === 'off') {
    settings.autoEvents.enabled = false;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return ctx.reply('⛔ Automatic drops are OFF.');
  }

  const status = settings.autoEvents.enabled ? 'on' : 'off';
  ctx.reply(`Automatic drops are ${status}.\nEvery ${settings.autoEvents.intervalMinutes} minutes\nGame types: ${settings.autoEvents.types.join(', ')}\nThis chat: ${settings.primaryChatId || 'not set yet'}\n\nUse /autoevents on or /autoevents off`);
});

bot.command('setinterval', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  const minutes = parseInt(ctx.message.text.split(' ')[1], 10);
  if (isNaN(minutes) || minutes < 5) {
    return ctx.reply('Use it like this: /setinterval 60\nThat means a drop every hour.\nKeep it at 5 minutes or more so it stays friendly.');
  }
  const settings = loadSettings();
  if (!settings.autoEvents) {
    settings.autoEvents = {
      enabled: false,
      intervalMinutes: 60,
      types: ['riddle', 'fasttyping', 'trial']
    };
  }
  settings.autoEvents.intervalMinutes = minutes;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  ctx.reply(`⏱ The drops will now happen every ${minutes} minutes once they are switched on.`);
});

bot.start((ctx) => {
  if (ctx.chat.type !== 'private') return;
  if (ctx.startPayload === 'wallet') {
    const existing = wallet.getWallet(ctx.from.id);
    return existing
      ? ctx.reply(ui.walletRegisteredText(existing, wallet.shortenAddress(existing.address)), ui.walletRegisteredKeyboard())
      : ctx.reply(ui.walletEmptyText(), ui.walletEmptyKeyboard());
  }
  if (ctx.startPayload === 'rewards') return ctx.reply(ui.rewardsText(), ui.rewardsKeyboard());
  if (ctx.startPayload === 'profile') return ctx.reply(formatProfile(ctx.from.id, userMeta(ctx)), ui.backToMainKeyboard());
  ctx.reply(ui.mainMenuText(), ui.mainMenuKeyboard(ctx.botInfo && ctx.botInfo.username, { inGroup: false }));
});

bot.command('menu', (ctx) => {
  const inGroup = ctx.chat.type !== 'private';
  ctx.reply(ui.mainMenuText(), ui.mainMenuKeyboard(ctx.botInfo && ctx.botInfo.username, { inGroup }));
});

async function safeEdit(ctx, text, keyboard) {
  try {
    await ctx.editMessageText(text, keyboard);
  } catch (err) {
    if (/message is not modified/i.test(err.description || '')) return;
    await ctx.reply(text, keyboard);
  }
}

async function safeEditCaption(ctx, caption, keyboard) {
  try {
    await ctx.editMessageCaption(caption, keyboard);
  } catch (err) {
    if (/message is not modified/i.test(err.description || '')) return;
    await ctx.reply(caption, keyboard);
  }
}

bot.action('pmenu:profile', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(formatProfile(ctx.from.id, userMeta(ctx)));
});

bot.action('pmenu:main', async (ctx) => {
  await ctx.answerCbQuery();
  const inGroup = ctx.chat.type !== 'private';
  await safeEdit(ctx, ui.mainMenuText(), ui.mainMenuKeyboard(ctx.botInfo && ctx.botInfo.username, { inGroup }));
});

bot.action('pmenu:games', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, ui.gamesMenuText(), ui.gamesMenuKeyboard());
});

bot.action('pmenu:rankings', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, ui.rankingsText(), ui.rankingsKeyboard());
});

for (const category of ['chronicles', 'community']) {
  bot.action(`pmenu:rankings:${category}`, async (ctx) => {
    await ctx.answerCbQuery();
    const title = category === 'chronicles' ? '🧠 CHRONICLES LEADERBOARD — SEASON' : '💬 COMMUNITY ACTIVITY LEADERBOARD — SEASON';
    await safeEdit(ctx, formatLeaderboard(buildLeaderboard(category, 'season', 10), title), ui.rankingsKeyboard());
  });
}

bot.action('pmenu:rewards', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, ui.rewardsText(), ui.rewardsKeyboard());
});

bot.action('pmenu:help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('ℹ️ Use /profile for your stats, /leaderboard for rankings, /tictactoe or /connectfour to challenge the group, and /help for all commands.');
});

bot.action('pmenu:wallet', async (ctx) => {
  await ctx.answerCbQuery();
  const existing = wallet.getWallet(ctx.from.id);
  await showWalletScreen(ctx);
});

bot.action('wallet:enter', async (ctx) => {
  await ctx.answerCbQuery();
  wallet.beginWalletInput(ctx.from.id);
  await ctx.editMessageText(ui.walletEnterPromptText(), ui.walletEnterPromptKeyboard());
});

bot.action('wallet:remove', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(ui.walletRemoveConfirmText(), ui.walletRemoveConfirmKeyboard());
});

bot.action('wallet:change', async (ctx) => {
  await ctx.answerCbQuery();
  wallet.beginWalletInput(ctx.from.id);
  await ctx.editMessageText(ui.walletEnterPromptText(), ui.walletEnterPromptKeyboard());
});

bot.action('wallet:cancel_input', async (ctx) => {
  wallet.clearPendingWalletInput(ctx.from.id);
  await ctx.answerCbQuery();
  const existing = wallet.getWallet(ctx.from.id);
  await ctx.editMessageText(existing ? ui.walletRegisteredText(existing, wallet.shortenAddress(existing.address)) : ui.walletEmptyText(), existing ? ui.walletRegisteredKeyboard() : ui.walletEmptyKeyboard());
});

bot.action('wallet:remove_confirm', async (ctx) => {
  wallet.removeWallet(ctx.from.id);
  await ctx.answerCbQuery('Wallet removed.');
  await ctx.editMessageText(ui.walletEmptyText(), ui.walletEmptyKeyboard());
});

bot.action('wallet:remove_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  const existing = wallet.getWallet(ctx.from.id);
  await ctx.editMessageText(existing ? ui.walletRegisteredText(existing, wallet.shortenAddress(existing.address)) : ui.walletEmptyText(), existing ? ui.walletRegisteredKeyboard() : ui.walletEmptyKeyboard());
});

async function showWalletScreen(ctx) {
  if (ctx.chat.type !== 'private') {
    return ctx.reply(ui.walletGroupText(), ui.walletGroupKeyboard(ctx.botInfo && ctx.botInfo.username));
  }
  const record = wallet.getWallet(ctx.from.id);
  if (!record) return ctx.reply(ui.walletEmptyText(), ui.walletEmptyKeyboard());
  return ctx.reply(ui.walletRegisteredText(record, wallet.shortenAddress(record.address)), ui.walletRegisteredKeyboard());
}

bot.command('wallet', (ctx) => showWalletScreen(ctx));

bot.action('pmenu:games:tictactoe', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.chat.type === 'private') return ctx.reply('Tic-Tac-Toe is a group game — open it in your community chat instead.');
  await startTicTacToeInChat(ctx);
});

bot.action('pmenu:games:connectfour', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.chat.type === 'private') return ctx.reply('Connect Four is a group game — open it in your community chat instead.');
  await startConnectFourInChat(ctx);
});

bot.action(/^ttt:join:([a-z0-9]+)$/, async (ctx) => {
  const result = ticTacToe.join(ctx.match[1], ctx.from.id, userMeta(ctx));
  if (!result.ok) return ctx.answerCbQuery('You cannot join this game.', { show_alert: true });
  await ctx.answerCbQuery();
  await safeEditCaption(ctx, result.rendered.text, { reply_markup: result.rendered.keyboard });
});

bot.action(/^ttt:move:([a-z0-9]+):(\d)$/, async (ctx) => {
  const result = ticTacToe.move(ctx.match[1], ctx.from.id, Number(ctx.match[2]));
  if (!result.ok) return ctx.answerCbQuery('That move is not available.', { show_alert: true });
  await ctx.answerCbQuery();
  await safeEditCaption(ctx, result.rendered.text, { reply_markup: result.rendered.keyboard });
});

bot.action(/^c4:join:([a-z0-9]+)$/, async (ctx) => {
  const result = connectFour.join(ctx.match[1], ctx.from.id, userMeta(ctx));
  if (!result.ok) return ctx.answerCbQuery('You cannot join this game.', { show_alert: true });
  await ctx.answerCbQuery();
  await safeEditCaption(ctx, result.rendered.text, { reply_markup: result.rendered.keyboard });
});

bot.action(/^c4:move:([a-z0-9]+):(\d)$/, async (ctx) => {
  const result = connectFour.move(ctx.match[1], ctx.from.id, Number(ctx.match[2]));
  if (!result.ok) return ctx.answerCbQuery('That move is not available.', { show_alert: true });
  await ctx.answerCbQuery();
  await safeEditCaption(ctx, result.rendered.text, { reply_markup: result.rendered.keyboard });
});

async function startTicTacToeInChat(ctx) {
  const editFn = async (chatId, messageId, caption, keyboard) => {
    try {
      await bot.telegram.editMessageCaption(chatId, messageId, undefined, caption, { reply_markup: keyboard });
    } catch (_err) {
      // Telegram may reject an edit after the challenge has ended.
    }
  };
  const result = ticTacToe.startChallenge(ctx.chat.id, editFn);
  if (!result) return ctx.reply('A Tic-Tac-Toe challenge is already running here.');
  const sent = await ctx.replyWithPhoto({ source: TTT_BOARD_IMAGE }, { caption: result.text, reply_markup: result.keyboard });
  if (sent && sent.message_id) ticTacToe.setMessageId(result.session.id, sent.message_id);
}

async function startConnectFourInChat(ctx) {
  const editFn = async (chatId, messageId, caption, keyboard) => {
    try {
      await bot.telegram.editMessageCaption(chatId, messageId, undefined, caption, { reply_markup: keyboard });
    } catch (_err) {
      // Telegram may reject an edit after the challenge has ended.
    }
  };
  const result = connectFour.startChallenge(ctx.chat.id, editFn);
  if (!result) return ctx.reply('A Connect Four challenge is already running here.');
  const sent = await ctx.replyWithPhoto({ source: C4_BOARD_IMAGE }, { caption: result.text, reply_markup: result.keyboard });
  if (sent && sent.message_id) connectFour.setMessageId(result.session.id, sent.message_id);
}

bot.command('tictactoe', (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('Tic-Tac-Toe is a group game — open it in your community chat instead.');
  return startTicTacToeInChat(ctx);
});

bot.command('connectfour', (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('Connect Four is a group game — open it in your community chat instead.');
  return startConnectFourInChat(ctx);
});

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
  if (!isAdmin(ctx.from.id)) return ctx.reply('Only the council can do this.');
  const settings = loadSettings();
  ctx.reply(ui.groupSettingsText(settings), ui.groupSettingsKeyboard());
});

for (const [action, screen] of [
  ['grp:main', 'main'], ['grp:autoevents', 'autoevents'], ['grp:digest', 'digest'],
  ['grp:antispam', 'antispam'], ['grp:games', 'games'], ['grp:reset_confirm', 'reset_confirm']
]) {
  bot.action(action, adminAction(async (ctx) => {
    await ctx.answerCbQuery();
    await renderGroupPanel(ctx, screen);
  }));
}

bot.action('grp:reset_do', adminAction(async (ctx) => {
  const { newSeason } = resetSeason();
  await ctx.answerCbQuery('Season reset.', { show_alert: true });
  await ctx.editMessageText(`🏅 Season ${newSeason.number - 1} archived. Season ${newSeason.number} begins now.\n\nLifetime XP is untouched.`, ui.groupSettingsKeyboard());
}));

bot.action('grp:close', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('Settings closed. Run /settings anytime to reopen.');
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
  const settings = loadSettings();
  settings.autoEvents.intervalMinutes = parseInt(ctx.match[1], 10);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'autoevents');
}));

bot.action(/^auto:type:(riddle|fasttyping|trial)$/, adminAction(async (ctx) => {
  const settings = loadSettings();
  const type = ctx.match[1];
  const index = settings.autoEvents.types.indexOf(type);
  if (index === -1) settings.autoEvents.types.push(type);
  else settings.autoEvents.types.splice(index, 1);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'autoevents');
}));

for (const [action, enabled] of [['digest:on', true], ['digest:off', false]]) {
  bot.action(action, adminAction(async (ctx) => {
    const settings = loadSettings();
    settings.weeklyDigest.enabled = enabled;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    await ctx.answerCbQuery();
    await renderGroupPanel(ctx, 'digest');
  }));
}

bot.action('digest:setchat', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.primaryChatId = ctx.chat.id;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'digest');
}));

bot.action('digest:postnow', adminAction(async (ctx) => {
  await ctx.answerCbQuery('Posting now...');
  await postWeeklyDigest(bot, ctx.chat.id);
}));

bot.action(/^spam:(relaxed|normal|strict)$/, adminAction(async (ctx) => {
  const settings = loadSettings();
  Object.assign(settings.antiSpam, SPAM_PRESETS[ctx.match[1]]);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery();
  await renderGroupPanel(ctx, 'antispam');
}));

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
  await ctx.answerCbQuery();
  await ctx.editMessageText(`✅ Auto-Events are ON — dropping a Riddle, Fast Typing, or Trial every ${settings.autoEvents.intervalMinutes} minutes.\n\nAdjust anytime with /settings.`);
}));

bot.action('onboard:digest_setchat', adminAction(async (ctx) => {
  const settings = loadSettings();
  settings.primaryChatId = ctx.chat.id;
  settings.weeklyDigest.enabled = true;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  await ctx.answerCbQuery();
  await ctx.editMessageText('✅ Weekly Digest is ON for this chat — the leaderboard + Mystery Box winner post here once a week.\n\nAdjust anytime with /settings.');
}));

bot.action('onboard:try_riddle', adminAction(async (ctx) => {
  await ctx.answerCbQuery();
  const game = keepersRiddle.startRiddle(ctx.chat.id);
  if (!game) return ctx.reply("A Keeper's Riddle is already active here.");
  const r = game.riddle;
  let msg = `🟣 KEEPER'S RIDDLE — CHAPTER ${r.chapter}\n\n${r.question}`;
  if (r.options) msg += `\n\n${r.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
  const sent = await ctx.reply(`${msg}\n\nAnswer in the chat — first correct gets a bonus.`);
  keepersRiddle.setMessageId(ctx.chat.id, sent.message_id);
}));

bot.command('help', (ctx) => {
  ctx.reply([
    '🫧 PLOMP CHRONICLES BOT',
    '',
    'PLAYER COMMANDS',
    '/profile — view your Plomper profile',
    '/leaderboard chronicles|community — this season\'s top 10',
    '/lifetimeboard chronicles|community — all-time top 10',
    '/setfaction <Green Order|Black Tide|Ashborn|Keepers> — pledge your faction',
    '',
    'ADMIN COMMANDS',
    '/fasttyping — start a Fast Typing challenge',
    '/riddle [chapter] — start a Keeper\'s Riddle (e.g. /riddle III)',
    '/trial — start an Ashborn Trial (chained rapid-fire questions)',
    '/setchat — register this chat for the weekly auto-digest AND auto-events',
    '/digest — manually post the weekly leaderboard + Mystery Box digest now (for testing)',
    '/autoevents on|off — turn automatic riddle/fast-typing/trial drops on or off',
    '/setinterval <minutes> — how often auto-events drop (e.g. 60 = hourly, like ChatFight)',
    '/addxp <chronicles|community> <amount> — reply to a user to award XP',
    '/setxp <key> <value> — adjust an XP value',
    '/resetseason — archive current season, start a new one',
    '/export chronicles|community — download season leaderboard as CSV',
    '',
    'Note: a Hidden Clue ("Secret Question") occasionally appears on its own — no command needed, it\'s a rare surprise for whoever is in chat.'
  ].join('\n'));
});

bot.launch();
console.log('🫧 Plomp Chronicles bot is online.');
bot.telegram.setMyCommands(BOT_COMMANDS)
  .then(() => console.log('Telegram command menu registered.'))
  .catch((err) => console.error('Could not register Telegram command menu:', err.message));
startScheduler(bot);
startAutoEvents(bot);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
