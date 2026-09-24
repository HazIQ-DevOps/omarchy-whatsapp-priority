import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installSignalConsoleRedaction } from '../lib/signal-console.js'

test('libsignal session dumps are redacted while normal logs remain', () => {
  const lines = []
  const target = {
    info: (...args) => lines.push(['info', ...args]),
    warn: (...args) => lines.push(['warn', ...args])
  }
  installSignalConsoleRedaction(target)
  const secret = { currentRatchet: { rootKey: 'secret' } }
  target.info('Closing session:', secret)
  target.warn('Session already closed', secret)
  target.info('connection ready', 1)
  assert.deepEqual(lines, [
    ['info', 'Closing session:', '[session details redacted]'],
    ['warn', 'Session already closed', '[session details redacted]'],
    ['info', 'connection ready', 1]
  ])
})
