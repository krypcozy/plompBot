const { Markup } = require('telegraf');

function describeSpamLevel(settings) {
  const c = settings.antiSpam.cooldownSeconds;
  if (c >= 75) return '🔴 Strict';
  if (c <= 25) return '🟢 Relaxed';
  return '🟡 Normal';
}

// ---------------------------------------------------------------------
// DM MAIN MENU (ManGo-style layout)
// ---------------------------------------------------------------------
function mainMenuText() {
  return '🫧 PLOMP MENU\n\nChoose what you want to explore.';
}

function mainMenuKeyboard(botUsername, opts = {}) {
  const inGroup = !!opts.inGroup;
  const deepLink = (payload) => botUsername ? `https://t.me/${botUsername}?start=${payload}` : null;
  const walletButton = inGroup && deepLink('wallet')
    ? Markup.button.url('👛 Wallet', deepLink('wallet'))
    : Markup.button.callback('👛 Wallet', 'pmenu:wallet');
  const rewardsButton = inGroup && deepLink('rewards')
    ? Markup.button.url('🎁 Rewards', deepLink('rewards'))
    : Markup.button.callback('🎁 Rewards', 'pmenu:rewards');
  const rows = [
    [Markup.button.callback('🏆 Rankings', 'pmenu:rankings'), Markup.button.callback('🎮 Games', 'pmenu:games')],
    [Markup.button.callback('👤 My Profile', 'pmenu:profile'), walletButton],
    [rewardsButton, Markup.button.callback('ℹ️ Help', 'pmenu:help')]
  ];
  if (!inGroup && botUsername) rows.push([Markup.button.url('➕ Add me in a group', `https://t.me/${botUsername}?startgroup=true`)]);
  return Markup.inlineKeyboard(rows);
}

function backToMainKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'pmenu:main')]]);
}

function rankingsText() {
  return '🏆 RANKINGS\n\nCheck community progress and this season\'s standings.';
}

function rankingsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🧠 Chronicles', 'pmenu:rankings:chronicles'), Markup.button.callback('💬 Community', 'pmenu:rankings:community')],
    [Markup.button.callback('⬅️ Back', 'pmenu:main')]
  ]);
}

function gamesMenuText() {
  return [
    '🎮 GAMES', '', 'Play, compete, and challenge the community.', '',
    '🟣 Keeper\'s Riddle, ⚡ Fast Typing, and 🟠 Ashborn Trial run in your group chat — an admin starts these with /riddle, /fasttyping, or /trial.',
    '', '❌⭕ Tic-Tac-Toe and 🟡 Connect Four you can start yourself, right here in the group.'
  ].join('\n');
}

function gamesMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌⭕ Tic-Tac-Toe', 'pmenu:games:tictactoe'), Markup.button.callback('🟡 Connect Four', 'pmenu:games:connectfour')],
    [Markup.button.callback('⬅️ Back', 'pmenu:main')]
  ]);
}

function rewardsText() {
  return [
    '🎁 REWARDS', '', 'Rewards scale with how big the moment is:', '',
    '🟢 In-the-moment wins (Fast Typing, riddles, trials, Tic-Tac-Toe, Connect Four) — straightforward XP.',
    '🟣 Secret Questions — first correct answer wins a Mystery Reward (SOL, USDC, or $PMP).',
    '🏆 Weekly Mystery Box — the #1 Chronicles player each week gets a Mystery Box (token, role, or NFT).',
    '🥇 Season-end — top 3 get an NFT + token bundle, top 10 get tokens + a seasonal role.', '',
    'Rewards are sent out by hand, using the wallet you register below — the bot never touches funds.'
  ].join('\n');
}

function rewardsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👛 Go to Wallet', 'pmenu:wallet')],
    [Markup.button.callback('⬅️ Back', 'pmenu:main')]
  ]);
}

function walletGroupText() { return '🫧 Manage your wallet privately — tap below to open a DM with me.'; }
function walletGroupKeyboard(botUsername) {
  const url = botUsername ? `https://t.me/${botUsername}?start=wallet` : null;
  return url ? Markup.inlineKeyboard([[Markup.button.url('👛 Open Wallet', url)]]) : Markup.inlineKeyboard([[Markup.button.callback('👛 Open Wallet', 'pmenu:wallet')]]);
}
function walletEmptyText() {
  return ['👛 MY WALLET', '', 'No wallet registered yet.', '', 'Register your Solana address so we know where to send rewards. This is just an address — never share your seed phrase or private key, and we will never ask for one.'].join('\n');
}
function walletEmptyKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('⌨️ Enter Wallet Address', 'wallet:enter')], [Markup.button.callback('⬅️ Back', 'pmenu:main')]]);
}
function walletRegisteredText(record, shortAddress) {
  return ['👛 MY WALLET', '', `Wallet: ${shortAddress}`, `Registered: ${new Date(record.registeredAt).toISOString().slice(0, 10)}`, '', 'Rewards get sent to this address.'].join('\n');
}
function walletRegisteredKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('✏️ Change Wallet', 'wallet:change')], [Markup.button.callback('🗑 Remove Wallet', 'wallet:remove')], [Markup.button.callback('⬅️ Back', 'pmenu:main')]]);
}
function walletEnterPromptText() { return ['Send your Solana wallet address as your next message.', '', '⚠️ Double-check it — rewards get sent here.', 'Never send a seed phrase or private key. We will never ask for one.'].join('\n'); }
function walletEnterPromptKeyboard() { return Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'wallet:cancel_input')]]); }
function walletInvalidText() { return "❌ That doesn't look like a valid Solana address. Try again, or cancel."; }
function walletTakenText() { return '⚠️ That wallet is already registered to another Plomper. Use a different address.'; }
function walletRemoveConfirmText() { return 'Remove your registered wallet?'; }
function walletRemoveConfirmKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('Yes, remove it', 'wallet:remove_confirm'), Markup.button.callback('Cancel', 'wallet:remove_cancel')]]);
}

// ---------------------------------------------------------------------
// GROUP SETTINGS — ROOT
// ---------------------------------------------------------------------
function groupSettingsText(settings) {
  return [
    '⚙️ GROUP SETTINGS',
    '',
    `Auto-Events: ${settings.autoEvents.enabled ? `✅ ON — every ${settings.autoEvents.intervalMinutes} min` : '⛔ OFF'}`,
    `Weekly Digest: ${settings.weeklyDigest.enabled ? '✅ ON' : '⛔ OFF'}${settings.primaryChatId ? '' : ' (no chat registered)'}`,
    `Anti-Spam: ${describeSpamLevel(settings)}`,
    '',
    'Only admins can change these.'
  ].join('\n');
}

function groupSettingsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏱ Auto-Events', 'grp:autoevents'), Markup.button.callback('📅 Weekly Digest', 'grp:digest')],
    [Markup.button.callback('🎮 Games', 'grp:games'), Markup.button.callback('🛡 Anti-Spam', 'grp:antispam')],
    [Markup.button.callback('🗑 Reset Season', 'grp:reset_confirm')],
    [Markup.button.callback('❌ Close', 'grp:close')]
  ]);
}

// ---------------------------------------------------------------------
// AUTO-EVENTS PANEL
// ---------------------------------------------------------------------
function autoEventsText(settings) {
  const cfg = settings.autoEvents;
  const lines = [
    '⏱ AUTO-EVENTS',
    '',
    `Status: ${cfg.enabled ? '✅ ON' : '⛔ OFF'}`,
    `Interval: every ${cfg.intervalMinutes} minutes`,
    `Active types: ${cfg.types.length ? cfg.types.join(', ') : 'none selected — pick at least one below'}`
  ];
  if (!settings.primaryChatId) lines.push('', '⚠️ No chat registered yet — set one from the Weekly Digest menu first.');
  return lines.join('\n');
}

function autoEventsKeyboard(settings) {
  const cfg = settings.autoEvents;
  const has = (type) => cfg.types.includes(type);
  return Markup.inlineKeyboard([
    [Markup.button.callback(cfg.enabled ? '⛔ Turn OFF' : '✅ Turn ON', cfg.enabled ? 'auto:off' : 'auto:on')],
    [
      Markup.button.callback('30 min', 'auto:interval:30'),
      Markup.button.callback('60 min', 'auto:interval:60'),
      Markup.button.callback('2 hr', 'auto:interval:120')
    ],
    [
      Markup.button.callback(`${has('riddle') ? '✅' : '➕'} Riddle`, 'auto:type:riddle'),
      Markup.button.callback(`${has('fasttyping') ? '✅' : '➕'} Fast Typing`, 'auto:type:fasttyping'),
      Markup.button.callback(`${has('trial') ? '✅' : '➕'} Trial`, 'auto:type:trial')
    ],
    [Markup.button.callback('⬅️ Back', 'grp:main')]
  ]);
}

// ---------------------------------------------------------------------
// WEEKLY DIGEST PANEL
// ---------------------------------------------------------------------
function digestText(settings) {
  return [
    '📅 WEEKLY DIGEST',
    '',
    `Status: ${settings.weeklyDigest.enabled ? '✅ ON' : '⛔ OFF'}`,
    `Posts to: ${settings.primaryChatId ? 'this chat (registered)' : 'not registered yet'}`,
    `Schedule: day ${settings.weeklyDigest.dayOfWeek} (0=Sun) at ${settings.weeklyDigest.hourUTC}:00 UTC`
  ].join('\n');
}

function digestKeyboard(settings) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(settings.weeklyDigest.enabled ? '⛔ Turn OFF' : '✅ Turn ON', settings.weeklyDigest.enabled ? 'digest:off' : 'digest:on')],
    [Markup.button.callback('📍 Register this chat', 'digest:setchat')],
    [Markup.button.callback('📤 Post now (test)', 'digest:postnow')],
    [Markup.button.callback('⬅️ Back', 'grp:main')]
  ]);
}

// ---------------------------------------------------------------------
// ANTI-SPAM PANEL
// ---------------------------------------------------------------------
function antiSpamText(settings) {
  return [
    '🛡 ANTI-SPAM',
    '',
    `Current level: ${describeSpamLevel(settings)}`,
    `Cooldown: ${settings.antiSpam.cooldownSeconds}s between XP-earning messages`,
    `Daily XP cap: ${settings.antiSpam.dailyXpCap}`,
    '',
    'Pick a preset — this adjusts cooldown, minimum message quality, and the daily cap together.'
  ].join('\n');
}

function antiSpamKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🟢 Relaxed', 'spam:relaxed'),
      Markup.button.callback('🟡 Normal', 'spam:normal'),
      Markup.button.callback('🔴 Strict', 'spam:strict')
    ],
    [Markup.button.callback('⬅️ Back', 'grp:main')]
  ]);
}

// ---------------------------------------------------------------------
// GAMES PANEL
// ---------------------------------------------------------------------
function gamesText() {
  return [
    '🎮 GAMES',
    '',
    'Playable here in chat:',
    '❌⭕ Tic-Tac-Toe — /tictactoe',
    '🟡 Connect Four — /connectfour',
    '',
    'Admin-started group games:',
    '🟣 Keeper\'s Riddle — /riddle',
    '⚡ Fast Typing — /fasttyping',
    '🟠 Ashborn Trial — /trial',
    '',
    'Use Auto-Events to have the chat cycle through the admin games automatically.'
  ].join('\n');
}

function gamesKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('❌⭕ Tic-Tac-Toe', 'pmenu:games:tictactoe'),
      Markup.button.callback('🟡 Connect Four', 'pmenu:games:connectfour')
    ],
    [Markup.button.callback('⏱ Auto-Events', 'grp:autoevents')],
    [Markup.button.callback('⬅️ Back', 'grp:main')]
  ]);
}

// ---------------------------------------------------------------------
// RESET SEASON CONFIRMATION
// ---------------------------------------------------------------------
function resetConfirmText() {
  return [
    '🗑 RESET SEASON',
    '',
    'This archives the current season standings and zeroes season XP for everyone.',
    'Lifetime XP is untouched.',
    '',
    'Are you sure?'
  ].join('\n');
}

function resetConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚠️ Confirm Reset', 'grp:reset_do'), Markup.button.callback('Cancel', 'grp:main')]
  ]);
}

// ---------------------------------------------------------------------
// ONBOARDING (posted automatically when the bot is added to a group)
// ---------------------------------------------------------------------
function onboardingText() {
  return [
    "👋 Welcome — I'm now live in your group.",
    '',
    '3 quick wins to set up:',
    '1. Auto-Events — drops a Riddle, Fast Typing, or Trial on a timer so the chat stays active.',
    '2. Weekly Digest — posts the leaderboard + Mystery Box winner here, once a week, automatically.',
    "3. Keeper's Riddle — start one right now and see how it works.",
    '',
    'Tap a button below — these all apply to this group. Only admins can change them.'
  ].join('\n');
}

function onboardingKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Enable Auto-Events (hourly)', 'onboard:auto_on')],
    [Markup.button.callback('📅 Enable Weekly Digest here', 'onboard:digest_setchat')],
    [Markup.button.callback('🟣 Try a Riddle now', 'onboard:try_riddle')]
  ]);
}

module.exports = {
  describeSpamLevel,
  mainMenuText, mainMenuKeyboard, backToMainKeyboard,
  rankingsText, rankingsKeyboard,
  gamesMenuText, gamesMenuKeyboard,
  rewardsText, rewardsKeyboard,
  walletGroupText, walletGroupKeyboard,
  walletEmptyText, walletEmptyKeyboard,
  walletRegisteredText, walletRegisteredKeyboard,
  walletEnterPromptText, walletEnterPromptKeyboard,
  walletInvalidText, walletTakenText,
  walletRemoveConfirmText, walletRemoveConfirmKeyboard,
  groupSettingsText, groupSettingsKeyboard,
  autoEventsText, autoEventsKeyboard,
  digestText, digestKeyboard,
  antiSpamText, antiSpamKeyboard,
  gamesText, gamesKeyboard,
  resetConfirmText, resetConfirmKeyboard,
  onboardingText, onboardingKeyboard
};
