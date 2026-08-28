const path = require('path');
const JsonDB = require('./db');

const usersDB = new JsonDB(path.join(__dirname, '../data/users.json'), {});

function blankUser(meta = {}) {
  return {
    username: meta.username || null,
    firstName: meta.firstName || null,
    faction: meta.faction || 'Unaligned',
    lifetimeXP: { chronicles: 0, community: 0 },
    seasonXP: { chronicles: 0, community: 0 },
    messages: 0,
    questionsAnswered: 0,
    correctAnswers: 0,
    streak: 0,
    lastActiveDate: null,
    mysteryRewards: 0,
    chaptersCompleted: 0,
    lastMessageTimestamp: 0,
    dailyXpEarned: 0,
    dailyXpDate: null,
    recentMessageHashes: [],
    fastTypingWins: 0,
    riddlesSolved: 0,
    ticTacToeWins: 0,
    connectFourWins: 0
  };
}

function getUser(id, meta = {}) {
  id = String(id);
  if (!usersDB.data[id]) {
    usersDB.data[id] = blankUser(meta);
    usersDB.save();
  } else {
    // keep display name fresh
    if (meta.username) usersDB.data[id].username = meta.username;
    if (meta.firstName) usersDB.data[id].firstName = meta.firstName;
  }
  return usersDB.data[id];
}

function saveUsers() {
  usersDB.save();
}

function allUsers() {
  return usersDB.data;
}

function levelFor(user) {
  const total = (user.lifetimeXP.chronicles || 0) + (user.lifetimeXP.community || 0);
  return Math.max(1, Math.floor(total / 500) + 1);
}

module.exports = { getUser, saveUsers, allUsers, levelFor };
