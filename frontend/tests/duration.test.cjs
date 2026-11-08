const { test } = require('node:test')
const assert = require('node:assert/strict')
const { formatDuration } = require('../src/lib/duration.ts')

test('durations remain readable across minutes, exact hours and long services', () => {
  for (const [minutes, expected] of [[0, '0 min'], [30, '30 min'], [90, '1 h 30 min'], [120, '2 h'], [1203, '20 h 3 min']]) {
    assert.equal(formatDuration(minutes), expected)
  }
  assert.equal(formatDuration(NaN), '—')
  assert.equal(formatDuration(-1), '—')
})
