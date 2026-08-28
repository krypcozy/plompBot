/**
 * Shared answer-matching logic for Keeper's Riddle, Ashborn Trial, and
 * Hidden Clue Drops. Centralized here so a fix in one place fixes all three.
 *
 * Handles:
 *  - exact text match (case/punctuation-insensitive)
 *  - partial phrase containment in either direction, guarded so short
 *    words can't accidentally match everything
 *  - answering multiple-choice questions with just the option letter
 *    (A / B / C / D, with or without a closing parenthesis or period) —
 *    this was the main reason correct answers weren't being recognized,
 *    since most people naturally answer a lettered question with a letter.
 */

function normalize(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/["'.!?,]/g, '')
    .replace(/\s+/g, ' ');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesAnswer(guessRaw, riddle) {
  const guess = normalize(guessRaw);
  const answer = normalize(riddle.answer);
  if (!guess) return false;

  if (guess === answer) return true;

  // Only treat phrase containment as valid when it is a meaningful multi-word phrase,
  // not a single-word fragment like "worthy" or a tiny two-word shorthand like "the core".
  const containsMeaningfulPhrase = (a, b) => {
    const wordsA = a.split(/\s+/).filter(Boolean);
    const wordsB = b.split(/\s+/).filter(Boolean);
    if (wordsA.length < 3 || wordsB.length < 3) return false;

    const re = new RegExp(`\\b${escapeRegex(a)}\\b`);
    return re.test(b);
  };

  if (containsMeaningfulPhrase(guess, answer)) return true;
  if (containsMeaningfulPhrase(answer, guess)) return true;

  // Multiple-choice: allow answering with just the option letter
  if (riddle.type === 'multiple_choice' && Array.isArray(riddle.options)) {
    const letterMatch = guess.match(/^([a-d])\)?$/);
    if (letterMatch) {
      const idx = letterMatch[1].charCodeAt(0) - 97; // a -> 0, b -> 1, ...
      const option = riddle.options[idx];
      if (option && normalize(option) === answer) return true;
    }
  }

  return false;
}

module.exports = { normalize, matchesAnswer };
