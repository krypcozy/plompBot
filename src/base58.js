/**
 * Base58 encoding and decoding for Solana public-key validation.
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map();
for (let index = 0; index < ALPHABET.length; index += 1) {
  ALPHABET_MAP.set(ALPHABET[index], index);
}

function encodeBase58(bytes) {
  if (!bytes || bytes.length === 0) return '';

  const source = Buffer.from(bytes);
  let zeros = 0;
  while (zeros < source.length && source[zeros] === 0) zeros += 1;

  const size = Math.floor(((source.length - zeros) * 138) / 100) + 1;
  const encoded = Buffer.alloc(size);
  let length = 0;

  for (let index = zeros; index < source.length; index += 1) {
    let carry = source[index];
    let position = 0;
    for (let slot = size - 1; slot >= 0 && (carry !== 0 || position < length); slot -= 1, position += 1) {
      carry += 256 * encoded[slot];
      encoded[slot] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = position;
  }

  let start = size - length;
  while (start < size && encoded[start] === 0) start += 1;

  let result = '1'.repeat(zeros);
  for (let index = start; index < size; index += 1) result += ALPHABET[encoded[index]];
  return result;
}

function decodeBase58(value) {
  if (typeof value !== 'string' || value.length === 0) return null;

  let zeros = 0;
  while (zeros < value.length && value[zeros] === '1') zeros += 1;

  const size = Math.floor(((value.length - zeros) * 733) / 1000) + 1;
  const decoded = Buffer.alloc(size);
  let length = 0;

  for (let index = zeros; index < value.length; index += 1) {
    const digit = ALPHABET_MAP.get(value[index]);
    if (digit === undefined) return null;

    let carry = digit;
    let position = 0;
    for (let slot = size - 1; slot >= 0 && (carry !== 0 || position < length); slot -= 1, position += 1) {
      carry += 58 * decoded[slot];
      decoded[slot] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = position;
  }

  let start = size - length;
  while (start < size && decoded[start] === 0) start += 1;

  const output = Buffer.alloc(zeros + (size - start));
  let offset = zeros;
  for (let index = start; index < size; index += 1) output[offset++] = decoded[index];
  return output;
}

module.exports = { ALPHABET, encodeBase58, decodeBase58 };
