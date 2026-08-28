/**
 * PvP Connect Four. One open challenge per chat at a time. Gravity-drop
 * 6x7 board, 4-in-a-row wins (horizontal, vertical, both diagonals).
 * Includes a pair-cooldown to prevent rematch XP farming.
 */

const { awardXP, loadSettings } = require('../xpEngine');
const { getUser, saveUsers } = require('../users');

const ROWS = 6;
const COLS = 7;
const WIN_LENGTH = 4;
const JOIN_TIMEOUT_MS = 5 * 60 * 1000;
const TURN_TIMEOUT_MS = 60 * 1000;
const PAIR_COOLDOWN_MS = 30 * 60 * 1000;
const STATUS = Object.freeze({ WAITING: 'waiting', ACTIVE: 'active', WON: 'won', DRAW: 'draw', EXPIRED: 'expired' });
const MARK_R = '🔴';
const MARK_Y = '🟡';
const EMPTY_CELL = '⚪';
const COL_HEADERS = '1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣';

function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
function dropToken(board, column, mark) {
  if (!Number.isInteger(column) || column < 0 || column >= COLS) return { ok: false, reason: 'bad-cell' };
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row][column] == null) {
      board[row][column] = mark;
      return { ok: true, row, column };
    }
  }
  return { ok: false, reason: 'full' };
}
function countDir(board, row, col, dRow, dCol, mark) {
  let count = 0;
  let currentRow = row + dRow;
  let currentCol = col + dCol;
  while (currentRow >= 0 && currentRow < ROWS && currentCol >= 0 && currentCol < COLS && board[currentRow][currentCol] === mark) {
    count += 1;
    currentRow += dRow;
    currentCol += dCol;
  }
  return count;
}
function checkWinner(board) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const mark = board[row][col];
      if (mark !== 'R' && mark !== 'Y') continue;
      for (const [dRow, dCol] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const run = 1 + countDir(board, row, col, dRow, dCol, mark) + countDir(board, row, col, -dRow, -dCol, mark);
        if (run >= WIN_LENGTH) return mark;
      }
    }
  }
  return null;
}
function isBoardFull(board) { return board.every((row) => row.every((cell) => cell === 'R' || cell === 'Y')); }
function cellEmoji(value) { return value === 'R' ? MARK_R : value === 'Y' ? MARK_Y : EMPTY_CELL; }
function formatBoard(board) { return `${board.map((row) => row.map(cellEmoji).join(' ')).join('\n')}\n${COL_HEADERS}`; }
function displayName(meta) { return meta.username ? `@${meta.username}` : meta.firstName || 'Plomper'; }

const sessions = new Map();
const activeByChatId = new Map();
const pairCooldowns = new Map();
let sessionCounter = 0;
function generateSessionId() { sessionCounter += 1; return `${Date.now().toString(36)}${sessionCounter.toString(36)}`; }
function pairKey(userIdA, userIdB) { return [String(userIdA), String(userIdB)].sort().join(':'); }
function isPairOnCooldown(userIdA, userIdB) { const last = pairCooldowns.get(pairKey(userIdA, userIdB)); return Boolean(last && Date.now() - last < PAIR_COOLDOWN_MS); }
function markPairCooldown(userIdA, userIdB) { pairCooldowns.set(pairKey(userIdA, userIdB), Date.now()); }
function buildJoinKeyboard(session) { return { inline_keyboard: [[{ text: 'Join game', callback_data: `c4:join:${session.id}` }]] }; }
function buildBoardKeyboard(session) {
  const labels = ['1', '2', '3', '4', '5', '6', '7'];
  return { inline_keyboard: [labels.slice(0, 4).map((label, index) => ({ text: label, callback_data: `c4:move:${session.id}:${index}` })), labels.slice(4).map((label, index) => ({ text: label, callback_data: `c4:move:${session.id}:${index + 4}` }))] };
}
function renderSession(session) {
  if (session.status === STATUS.WAITING) return { text: `🟡 CONNECT FOUR\n\n${session.players.R ? `${MARK_R} ${displayName(session.players.R.meta)} is waiting for an opponent.` : 'A new challenge is open. First two players can join.'}`, keyboard: buildJoinKeyboard(session) };
  if (session.status === STATUS.ACTIVE) {
    const turnMeta = session.players[session.currentPlayer].meta;
    const turnMark = session.currentPlayer === 'R' ? MARK_R : MARK_Y;
    return { text: ['🟡 CONNECT FOUR', '', `${MARK_R} ${displayName(session.players.R.meta)}`, `${MARK_Y} ${displayName(session.players.Y.meta)}`, '', `Turn: ${turnMark} ${displayName(turnMeta)}`, '', formatBoard(session.board)].join('\n'), keyboard: buildBoardKeyboard(session) };
  }
  if (session.status === STATUS.WON) {
    const winnerMeta = session.players[session.winnerSeat].meta;
    const loserMeta = session.players[session.winnerSeat === 'R' ? 'Y' : 'R'].meta;
    const xpLine = session.rewardEligible ? `+${session.xpAwarded || 0} XP (Community)` : 'Rematch cooldown — no XP this time';
    return { text: session.endReason === 'timeout' ? `⏱ ${displayName(loserMeta)} ran out of time.\n\n🏆 ${displayName(winnerMeta)} wins Connect Four!\n\n${xpLine}` : `🏆 CONNECT FOUR — ${displayName(winnerMeta)} wins!\n\n${xpLine}\n\n${formatBoard(session.board)}`, keyboard: { inline_keyboard: [] } };
  }
  if (session.status === STATUS.DRAW) return { text: `🤝 CONNECT FOUR — draw between ${displayName(session.players.R.meta)} and ${displayName(session.players.Y.meta)}.\n\n${formatBoard(session.board)}\n\nGood game!`, keyboard: { inline_keyboard: [] } };
  return { text: '⏱ Connect Four challenge expired — no opponent joined in time.', keyboard: { inline_keyboard: [] } };
}
function cleanup(session) { clearTimeout(session.joinTimer); clearTimeout(session.turnTimer); activeByChatId.delete(session.chatId); sessions.delete(session.id); }
function awardWinnerXP(session) {
  if (!session.rewardEligible) return;
  const winner = session.players[session.winnerSeat];
  const amount = loadSettings().xp.minigame_win_min || 50;
  session.xpAwarded = awardXP(winner.userId, winner.meta, 'community', amount, { ignoreCap: true }).awarded;
  const user = getUser(winner.userId, winner.meta);
  user.connectFourWins = (user.connectFourWins || 0) + 1;
  saveUsers();
}
function startTurnTimer(session) { clearTimeout(session.turnTimer); session.turnTimer = setTimeout(() => resolveTurnTimeout(session.id), TURN_TIMEOUT_MS); }
function resolveTurnTimeout(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== STATUS.ACTIVE) return;
  session.status = STATUS.WON;
  session.winnerSeat = session.currentPlayer === 'R' ? 'Y' : 'R';
  session.endReason = 'timeout';
  markPairCooldown(session.players.R.userId, session.players.Y.userId);
  awardWinnerXP(session);
  const rendered = renderSession(session);
  cleanup(session);
  if (session.editFn && session.messageId) session.editFn(session.chatId, session.messageId, rendered.text, rendered.keyboard);
}
function expireIfWaiting(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== STATUS.WAITING) return;
  session.status = STATUS.EXPIRED;
  const rendered = renderSession(session);
  cleanup(session);
  if (session.editFn && session.messageId) session.editFn(session.chatId, session.messageId, rendered.text, rendered.keyboard);
}
function startChallenge(chatId, editFn) {
  if (activeByChatId.has(chatId)) return null;
  const session = { id: generateSessionId(), chatId, status: STATUS.WAITING, players: { R: null, Y: null }, currentPlayer: 'R', board: emptyBoard(), winnerSeat: null, endReason: null, xpAwarded: 0, rewardEligible: true, messageId: null, editFn, joinTimer: null, turnTimer: null };
  sessions.set(session.id, session);
  activeByChatId.set(chatId, session.id);
  session.joinTimer = setTimeout(() => expireIfWaiting(session.id), JOIN_TIMEOUT_MS);
  return { session, ...renderSession(session) };
}
function setMessageId(sessionId, messageId) { const session = sessions.get(sessionId); if (session) session.messageId = messageId; }
function join(sessionId, userId, meta) {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, reason: 'invalid-session' };
  if (session.status !== STATUS.WAITING) return { ok: false, reason: 'not-waiting' };
  const uid = String(userId);
  if (!session.players.R) session.players.R = { userId: uid, meta };
  else if (String(session.players.R.userId) === uid) return { ok: false, reason: 'already-joined' };
  else { session.players.Y = { userId: uid, meta }; session.rewardEligible = !isPairOnCooldown(session.players.R.userId, uid); session.status = STATUS.ACTIVE; session.currentPlayer = 'R'; clearTimeout(session.joinTimer); startTurnTimer(session); }
  return { ok: true, started: session.status === STATUS.ACTIVE, rendered: renderSession(session) };
}
function seatForUser(session, userId) { return ['R', 'Y'].find((seat) => session.players[seat] && String(session.players[seat].userId) === String(userId)) || null; }
function move(sessionId, userId, column) {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, reason: 'invalid-session' };
  if (session.status !== STATUS.ACTIVE) return { ok: false, reason: 'not-active' };
  const seat = seatForUser(session, userId);
  if (!seat) return { ok: false, reason: 'outsider' };
  if (seat !== session.currentPlayer) return { ok: false, reason: 'not-your-turn' };
  const dropped = dropToken(session.board, column, seat);
  if (!dropped.ok) return { ok: false, reason: dropped.reason };
  const winner = checkWinner(session.board);
  if (winner) {
    session.status = STATUS.WON;
    session.winnerSeat = winner;
    session.endReason = 'win';
    markPairCooldown(session.players.R.userId, session.players.Y.userId);
    awardWinnerXP(session);
    const rendered = renderSession(session);
    cleanup(session);
    return { ok: true, ended: true, rendered };
  }
  if (isBoardFull(session.board)) { session.status = STATUS.DRAW; markPairCooldown(session.players.R.userId, session.players.Y.userId); const rendered = renderSession(session); cleanup(session); return { ok: true, ended: true, rendered }; }
  session.currentPlayer = seat === 'R' ? 'Y' : 'R';
  startTurnTimer(session);
  return { ok: true, ended: false, rendered: renderSession(session) };
}
function isOpenInChat(chatId) { return activeByChatId.has(chatId); }

module.exports = { STATUS, ROWS, COLS, startChallenge, setMessageId, join, move, isOpenInChat, emptyBoard, dropToken, checkWinner, isBoardFull, isPairOnCooldown, markPairCooldown };
