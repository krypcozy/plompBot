const { awardXP, loadSettings } = require('../xpEngine');
const { loadRiddleBank } = require('./keepersRiddle');
const { matchesAnswer } = require('../answerMatch');

const activeTrials = new Map(); // chatId -> session

function pickRounds(bank, count) {
  const pool = [...bank.riddles];
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

function displayName(meta) {
  return meta.username ? `@${meta.username}` : meta.firstName || 'Plomper';
}

function startTrial(chatId, sendMessage) {
  if (activeTrials.has(chatId)) return null;

  const settings = loadSettings().ashbornTrial;
  const bank = loadRiddleBank();
  const rounds = pickRounds(bank, settings.rounds);
  if (rounds.length === 0) return null;

  const session = {
    chatId,
    sendMessage,
    settings,
    rounds,
    currentIndex: 0,
    scores: {}, // userId -> { count, meta }
    roundFirstSolved: false,
    roundAttemptedUsers: new Set(),
    timer: null
  };

  activeTrials.set(chatId, session);
  postRound(session);
  return session;
}

function postRound(session) {
  session.roundFirstSolved = false;
  session.roundAttemptedUsers = new Set();
  const r = session.rounds[session.currentIndex];

  let msg = `🟠 ASHBORN TRIAL — Round ${session.currentIndex + 1}/${session.rounds.length}\n\n${r.question}`;
  if (r.options) {
    msg += `\n\n${r.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n')}`;
  }
  msg += `\n\n⏱ ${session.settings.roundTimeSeconds}s — one answer per person.`;
  session.sendMessage(session.chatId, msg);

  session.timer = setTimeout(() => advanceRound(session), session.settings.roundTimeSeconds * 1000);
}

function advanceRound(session) {
  session.currentIndex += 1;
  if (session.currentIndex >= session.rounds.length) {
    finishTrial(session);
  } else {
    postRound(session);
  }
}

function finishTrial(session) {
  activeTrials.delete(session.chatId);

  const entries = Object.entries(session.scores).sort((a, b) => b[1].count - a[1].count);

  entries.forEach(([userId, s]) => {
    if (s.count > 0) {
      awardXP(userId, s.meta, 'chronicles', session.settings.completionBonus, { ignoreCap: true });
    }
  });

  let msg = '🟠 ASHBORN TRIAL COMPLETE\n\n';
  if (entries.length === 0 || entries[0][1].count === 0) {
    msg += 'No Plomper answered correctly this time. The trial resets.';
  } else {
    const [, top] = entries[0];
    msg += `Top performer: ${displayName(top.meta)} — ${top.count}/${session.rounds.length} correct\n\nCompletion bonus awarded to everyone who scored at least one point.`;
  }
  session.sendMessage(session.chatId, msg);
}

/**
 * One attempt per person, per round. First message from a user during
 * the current round is their one shot — always gets a response, right
 * or wrong. Further messages from them during that same round are
 * silently ignored.
 */
function checkAnswer(chatId, userId, meta, text) {
  const session = activeTrials.get(chatId);
  if (!session) return null;

  const key = String(userId);
  if (session.roundAttemptedUsers.has(key)) return null;
  session.roundAttemptedUsers.add(key);

  const r = session.rounds[session.currentIndex];
  const correct = matchesAnswer(text, r);
  if (!correct) return { correct: false };

  if (!session.scores[userId]) session.scores[userId] = { count: 0, meta };
  session.scores[userId].count += 1;

  let xp = session.settings.xpPerCorrect;
  let isFirst = false;
  if (!session.roundFirstSolved) {
    session.roundFirstSolved = true;
    isFirst = true;
    xp += session.settings.firstBonus;
  }

  const result = awardXP(userId, meta, 'chronicles', xp, { ignoreCap: true });
  return { correct: true, xp: result.awarded, isFirst };
}

function isTrialActive(chatId) {
  return activeTrials.has(chatId);
}

module.exports = { startTrial, checkAnswer, isTrialActive };