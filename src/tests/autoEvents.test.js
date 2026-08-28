const assert = require('assert');
const { buildEventLeaderboard } = require('../src/autoEvents');

const users = {
  '1': { username: 'alice', firstName: 'Alice', seasonXP: { chronicles: 200, community: 10 }, questionsAnswered: 3, correctAnswers: 2 },
  '2': { username: 'bob', firstName: 'Bob', seasonXP: { chronicles: 150, community: 5 }, questionsAnswered: 1, correctAnswers: 0 },
  '3': { username: null, firstName: 'Charlie', seasonXP: { chronicles: 50, community: 0 }, questionsAnswered: 0, correctAnswers: 0 },
  '4': { username: 'dana', firstName: 'Dana', seasonXP: { chronicles: 300, community: 2 }, questionsAnswered: 4, correctAnswers: 3 }
};

const result = buildEventLeaderboard(users);
assert.ok(result.includes('@alice'));
assert.ok(result.includes('@dana'));
assert.ok(!result.includes('Charlie'));
assert.ok(result.indexOf('@dana') < result.indexOf('@alice'));
console.log('Auto-event leaderboard tests passed.');
