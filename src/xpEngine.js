const path = require('path');
const fs = require('fs');
const { getUser, saveUsers } = require('./users');

function loadSettings() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../config/settings.json'), 'utf8'));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyCapIfNeeded(user) {
  const today = todayStr();
  if (user.dailyXpDate !== today) {
    user.dailyXpDate = today;
    user.dailyXpEarned = 0;
  }
}

/**
 * Award XP to a user in a given category ('chronicles' or 'community').
 * Community XP respects the configurable daily cap unless ignoreCap is set
 * (used for streak bonuses, riddle rewards, admin grants, etc).
 */
function awardXP(userId, meta, category, amount, opts = {}) {
  const settings = loadSettings();
  const user = getUser(userId, meta);
  resetDailyCapIfNeeded(user);

  if (category === 'community' && !opts.ignoreCap) {
    const cap = settings.antiSpam.dailyXpCap;
    const remaining = cap - user.dailyXpEarned;
    if (remaining <= 0) {
      saveUsers();
      return { awarded: 0, capped: true };
    }
    amount = Math.min(amount, remaining);
    user.dailyXpEarned += amount;
  }

  user.lifetimeXP[category] = (user.lifetimeXP[category] || 0) + amount;
  user.seasonXP[category] = (user.seasonXP[category] || 0) + amount;
  saveUsers();
  return { awarded: amount, capped: false };
}

/**
 * Call once per eligible message. Updates the user's daily streak and
 * awards streak bonuses at 3 and 7 days. Returns the new streak count.
 */
function updateStreak(userId, meta) {
  const settings = loadSettings();
  const user = getUser(userId, meta);
  const today = todayStr();

  if (user.lastActiveDate === today) return user.streak; // already counted today

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (user.lastActiveDate === yesterday) {
    user.streak += 1;
  } else {
    user.streak = 1;
  }
  user.lastActiveDate = today;
  saveUsers();

  if (user.streak === 3) {
    awardXP(userId, meta, 'community', settings.xp.streak_3day, { ignoreCap: true });
  } else if (user.streak === 7) {
    awardXP(userId, meta, 'community', settings.xp.streak_7day, { ignoreCap: true });
  }

  return user.streak;
}

module.exports = { awardXP, updateStreak, todayStr, loadSettings };
