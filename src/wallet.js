const path = require('path');
const JsonDB = require('./db');
const { decodeBase58 } = require('./base58');

const walletsDB = new JsonDB(path.join(__dirname, '../data/wallets.json'), {});
const PUBKEY_BYTES = 32;
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PENDING_INPUT_TTL_MS = 10 * 60 * 1000;
const pendingInputs = new Map();

function normalizeSolanaAddress(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  if (!BASE58_REGEX.test(address)) return null;
  const bytes = decodeBase58(address);
  return bytes && bytes.length === PUBKEY_BYTES ? address : null;
}

function shortenAddress(address) {
  if (typeof address !== 'string' || address.length <= 8) return address || '';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getWallet(userId) {
  return walletsDB.data[String(userId)] || null;
}

function registerWallet(userId, address) {
  const canonical = normalizeSolanaAddress(address);
  if (!canonical) return { ok: false, reason: 'invalid' };

  const id = String(userId);
  for (const [existingId, record] of Object.entries(walletsDB.data)) {
    if (existingId !== id && record.address === canonical) return { ok: false, reason: 'taken' };
  }

  walletsDB.data[id] = { address: canonical, registeredAt: new Date().toISOString() };
  walletsDB.save();
  return { ok: true, address: canonical };
}

function removeWallet(userId) {
  const id = String(userId);
  if (!walletsDB.data[id]) return false;
  delete walletsDB.data[id];
  walletsDB.save();
  return true;
}

function beginWalletInput(userId) {
  pendingInputs.set(String(userId), Date.now() + PENDING_INPUT_TTL_MS);
}

function isPendingWalletInput(userId) {
  const id = String(userId);
  const expiresAt = pendingInputs.get(id);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    pendingInputs.delete(id);
    return false;
  }
  return true;
}

function clearPendingWalletInput(userId) {
  pendingInputs.delete(String(userId));
}

module.exports = {
  normalizeSolanaAddress,
  shortenAddress,
  getWallet,
  registerWallet,
  removeWallet,
  beginWalletInput,
  isPendingWalletInput,
  clearPendingWalletInput
};
