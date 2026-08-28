const assert = require('assert');
const { matchesAnswer } = require('../src/answerMatch');

const cases = [
  ['The Core Chooses Only the Worthy', { answer: 'The Core Chooses Only the Worthy', type: 'text' }, true],
  ['the core chooses only the worthy', { answer: 'The Core Chooses Only the Worthy', type: 'text' }, true],
  ['core chooses only the worthy', { answer: 'The Core Chooses Only the Worthy', type: 'text' }, true],
  ['worthy', { answer: 'The Core Chooses Only the Worthy', type: 'text' }, false],
  ['C', { answer: 'The Core Chooses Only the Worthy', type: 'multiple_choice', options: ['The Green Order', 'The Black Tide', 'The Core Chooses Only the Worthy', 'The False Keeper'] }, true],
  ['c)', { answer: 'The Core Chooses Only the Worthy', type: 'multiple_choice', options: ['The Green Order', 'The Black Tide', 'The Core Chooses Only the Worthy', 'The False Keeper'] }, true],
  ['  c.  ', { answer: 'The Core Chooses Only the Worthy', type: 'multiple_choice', options: ['The Green Order', 'The Black Tide', 'The Core Chooses Only the Worthy', 'The False Keeper'] }, true],
  ['A', { answer: 'The Core Chooses Only the Worthy', type: 'multiple_choice', options: ['The Core Chooses Only the Worthy', 'The Black Tide', 'The False Keeper', 'The Green Order'] }, true],
  ['b', { answer: 'The Core Chooses Only the Worthy', type: 'multiple_choice', options: ['The Green Order', 'The Core Chooses Only the Worthy', 'The False Keeper', 'The Black Tide'] }, true],
  ['D', { answer: 'The Core Chooses Only the Worthy', type: 'multiple_choice', options: ['The Green Order', 'The False Keeper', 'The Black Tide', 'The Core Chooses Only the Worthy'] }, true],
  ['C.', { answer: 'The Horizon is hidden in the tide', type: 'multiple_choice', options: ['The Moon', 'The Ruins', 'The Horizon is hidden in the tide', 'The Last Gate'] }, true],
  ['the horizon is hidden in the tide', { answer: 'The Horizon is hidden in the tide', type: 'text' }, true],
  ['hidden in the tide', { answer: 'The Horizon is hidden in the tide', type: 'text' }, true],
  ['the core', { answer: 'The Core Chooses Only the Worthy', type: 'text' }, false]
];

for (const [guess, riddle, expected] of cases) {
  assert.strictEqual(matchesAnswer(guess, riddle), expected, `Expected ${JSON.stringify(guess)} => ${expected} for ${JSON.stringify(riddle)}`);
}

console.log(`Answer matching tests passed (${cases.length}).`);
