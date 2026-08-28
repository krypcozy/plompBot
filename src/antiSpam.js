const crypto = require('crypto');
const { getUser, saveUsers } = require('./users');
const { loadSettings } = require('./xpEngine');

function hashMessage(text) {
  return crypto.createHash('md5').update(text.trim().toLowerCase()).digest('hex');
}

const LOW_EFFORT_PATTERN = /^(gm+|gn+|hi+|hey+|hello+|yo+|moon+|send|pump|wagmi|lfg+|😂+|🚀+|❤️+|👍+|🔥+)$/i;

function isLowQuality(text, settings) {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (trimmed.length < settings.antiSpam.minMessageLength) return true;
  if (words.length < settings.antiSpam.minWordCount) return true;
  if (LOW_EFFORT_PATTERN.test(trimmed)) return true;
  return false;
}

/**
 * Runs a message through cooldown / duplicate / quality checks.
 * Returns { eligible: true } if it should earn XP, otherwise
 * { eligible: false, reason }. Side effect: on eligible messages,
 * updates the user's tracking fields (message count, cooldown timestamp,
 * recent-message hash window) so subsequent checks stay accurate.
 */
function checkMessage(userId, meta, text) {
  const settings = loadSettings();
  const user = getUser(userId, meta);
  const now = Date.now();

  const cooldownMs = settings.antiSpam.cooldownSeconds * 1000;
  if (now - user.lastMessageTimestamp < cooldownMs) {
    return { eligible: false, reason: 'cooldown' };
  }

  const hash = hashMessage(text);
  if (user.recentMessageHashes.includes(hash)) {
    return { eligible: false, reason: 'duplicate' };
  }

  if (isLowQuality(text, settings)) {
    return { eligible: false, reason: 'low_quality' };
  }

  user.lastMessageTimestamp = now;
  user.recentMessageHashes.push(hash);
  if (user.recentMessageHashes.length > settings.antiSpam.duplicateWindow) {
    user.recentMessageHashes.shift();
  }
  user.messages += 1;
  saveUsers();

  return { eligible: true };
}

module.exports = { checkMessage, hashMessage, isLowQuality };
