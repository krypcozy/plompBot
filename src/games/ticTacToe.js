const { awardXP, loadSettings } = require('../xpEngine');
const { getUser, saveUsers } = require('../users');

const JOIN_TIMEOUT_MS = 5 * 60 * 1000;
const TURN_TIMEOUT_MS = 60 * 1000;
const WIN_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const STATUS = Object.freeze({ WAITING: 'waiting', ACTIVE: 'active', WON: 'won', DRAW: 'draw', EXPIRED: 'expired' });
const sessions = new Map();
const activeByChatId = new Map();
let sessionCounter = 0;

function emptyBoard() { return Array(9).fill(null); }
function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}
function isBoardFull(board) { return board.every((cell) => cell === 'X' || cell === 'O'); }
function displayName(meta) { return meta.username ? `@${meta.username}` : meta.firstName || 'Plomper'; }
function cellLabel(value) { return value === 'X' ? 'X' : value === 'O' ? 'O' : '·'; }
function generateSessionId() { sessionCounter += 1; return `${Date.now().toString(36)}${sessionCounter.toString(36)}`; }

function buildBoardKeyboard(session) {
  const rows = [];
  for (let row = 0; row < 3; row += 1) {
    rows.push([0, 1, 2].map((column) => {
      const cell = row * 3 + column;
      return { text: cellLabel(session.board[cell]), callback_data: `ttt:move:${session.id}:${cell}` };
    }));
  }
  return { inline_keyboard: rows };
}
function renderSession(session) {
  if (session.status === STATUS.WAITING) {
    return {
      text: `🎮 TIC-TAC-TOE\n\n${session.players.X ? `❌ ${displayName(session.players.X.meta)} is waiting for an opponent.` : 'A new challenge is open. First player to join plays X.'}`,
      keyboard: { inline_keyboard: [[{ text: 'Join game', callback_data: `ttt:join:${session.id}` }]] }
    };
  }
  if (session.status === STATUS.ACTIVE) {
    const player = session.players[session.currentPlayer];
    return {
      text: `🎮 TIC-TAC-TOE\n\n❌ ${displayName(session.players.X.meta)}\n⭕ ${displayName(session.players.O.meta)}\n\nTurn: ${session.currentPlayer === 'X' ? '❌' : '⭕'} ${displayName(player.meta)}`,
      keyboard: buildBoardKeyboard(session)
    };
  }
  if (session.status === STATUS.WON) {
    const winner = session.players[session.winnerSeat];
    const loser = session.players[session.winnerSeat === 'X' ? 'O' : 'X'];
    const timeout = session.endReason === 'timeout';
    return {
      text: timeout ? `⏱ ${displayName(loser.meta)} ran out of time.\n\n🏆 ${displayName(winner.meta)} wins!\n\n+${session.xpAwarded} XP (Community)` : `🏆 TIC-TAC-TOE — ${displayName(winner.meta)} wins!\n\n+${session.xpAwarded} XP (Community)`,
      keyboard: { inline_keyboard: [] }
    };
  }
  if (session.status === STATUS.DRAW) {
    return { text: `🤝 TIC-TAC-TOE — draw between ${displayName(session.players.X.meta)} and ${displayName(session.players.O.meta)}.`, keyboard: { inline_keyboard: [] } };
  }
  return { text: '⏱ Tic-Tac-Toe challenge expired — no opponent joined in time.', keyboard: { inline_keyboard: [] } };
}

function cleanup(session) {
  clearTimeout(session.joinTimer);
  clearTimeout(session.turnTimer);
  sessions.delete(session.id);
  if (activeByChatId.get(session.chatId) === session.id) activeByChatId.delete(session.chatId);
}
function awardWinnerXP(session) {
  const winner = session.players[session.winnerSeat];
  const amount = loadSettings().xp.minigame_win_min || 50;
  session.xpAwarded = awardXP(winner.userId, winner.meta, 'community', amount, { ignoreCap: true }).awarded;
  const user = getUser(winner.userId, winner.meta);
  user.ticTacToeWins = (user.ticTacToeWins || 0) + 1;
  saveUsers();
}
function resolveTurnTimeout(id) {
  const session = sessions.get(id);
  if (!session || session.status !== STATUS.ACTIVE) return;
  session.status = STATUS.WON;
  session.winnerSeat = session.currentPlayer === 'X' ? 'O' : 'X';
  session.endReason = 'timeout';
  awardWinnerXP(session);
  const rendered = renderSession(session);
  cleanup(session);
  if (session.editFn && session.messageId) session.editFn(session.chatId, session.messageId, rendered.text, rendered.keyboard);
}
function expireIfWaiting(id) {
  const session = sessions.get(id);
  if (!session || session.status !== STATUS.WAITING) return;
  session.status = STATUS.EXPIRED;
  const rendered = renderSession(session);
  cleanup(session);
  if (session.editFn && session.messageId) session.editFn(session.chatId, session.messageId, rendered.text, rendered.keyboard);
}
function startTurnTimer(session) {
  clearTimeout(session.turnTimer);
  session.turnTimer = setTimeout(() => resolveTurnTimeout(session.id), TURN_TIMEOUT_MS);
}

function startChallenge(chatId, editFn) {
  if (activeByChatId.has(chatId)) return null;
  const session = { id: generateSessionId(), chatId, status: STATUS.WAITING, players: { X: null, O: null }, currentPlayer: 'X', board: emptyBoard(), winnerSeat: null, endReason: null, xpAwarded: 0, messageId: null, editFn, joinTimer: null, turnTimer: null };
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
  const id = String(userId);
  if (!session.players.X) session.players.X = { userId: id, meta };
  else if (String(session.players.X.userId) === id) return { ok: false, reason: 'already-joined' };
  else { session.players.O = { userId: id, meta }; session.status = STATUS.ACTIVE; clearTimeout(session.joinTimer); startTurnTimer(session); }
  return { ok: true, rendered: renderSession(session) };
}
function move(sessionId, userId, cell) {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, reason: 'invalid-session' };
  if (session.status !== STATUS.ACTIVE) return { ok: false, reason: 'not-active' };
  const seat = ['X', 'O'].find((key) => session.players[key] && String(session.players[key].userId) === String(userId));
  if (!seat) return { ok: false, reason: 'outsider' };
  if (seat !== session.currentPlayer) return { ok: false, reason: 'not-your-turn' };
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || session.board[cell]) return { ok: false, reason: 'occupied' };
  session.board[cell] = seat;
  const winner = checkWinner(session.board);
  if (winner) { session.status = STATUS.WON; session.winnerSeat = winner; session.endReason = 'win'; awardWinnerXP(session); const rendered = renderSession(session); cleanup(session); return { ok: true, ended: true, rendered }; }
  if (isBoardFull(session.board)) { session.status = STATUS.DRAW; const rendered = renderSession(session); cleanup(session); return { ok: true, ended: true, rendered }; }
  session.currentPlayer = seat === 'X' ? 'O' : 'X';
  startTurnTimer(session);
  return { ok: true, ended: false, rendered: renderSession(session) };
}
function isOpenInChat(chatId) { return activeByChatId.has(chatId); }
module.exports = { STATUS, startChallenge, setMessageId, join, move, isOpenInChat, emptyBoard, checkWinner, isBoardFull };
