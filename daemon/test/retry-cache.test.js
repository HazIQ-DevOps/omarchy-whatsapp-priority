import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { proto } from 'baileys'
import { RetryCache } from '../lib/retry-cache.js'

test('retry payloads preserve quotes, media keys and silent actions across restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'whatsapp-retry-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const cache = new RetryCache(directory)
  cache.load()
  const fixtures = [
    { extendedTextMessage: { text: 'reply', contextInfo: { stanzaId: 'original', participant: '123@s.whatsapp.net', quotedMessage: { conversation: 'quoted' } } } },
    { imageMessage: { caption: 'image', mediaKey: Buffer.alloc(32, 1), fileSha256: Buffer.alloc(32, 2), directPath: '/synthetic/image', mimetype: 'image/png' } },
    { reactionMessage: { key: { id: 'original', remoteJid: '123@s.whatsapp.net', fromMe: false }, text: '👍' } },
    { protocolMessage: { key: { id: 'original' }, type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT, editedMessage: { conversation: 'edited' } } },
    { protocolMessage: { key: { id: 'original' }, type: proto.Message.ProtocolMessage.Type.REVOKE } }
  ]
  for (const [index, message] of fixtures.entries()) cache.remember({ key: { fromMe: true, id: 'id-' + index }, message })
  const restored = new RetryCache(directory)
  restored.load()
  for (const [index, message] of fixtures.entries()) {
    assert.deepEqual(proto.Message.encode(restored.get('id-' + index)).finish(), proto.Message.encode(message).finish())
    assert.equal(statSync(cache.path('id-' + index)).mode & 0o777, 0o600)
  }
  assert.equal(restored.get('unknown'), undefined)
  restored.clear()
  assert.deepEqual(readdirSync(directory), [])
})

test('retry cache is bounded and does not retain incoming messages', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'whatsapp-retry-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const cache = new RetryCache(directory, { maxEntries: 2 })
  cache.load()
  for (let i = 0; i < 3; i++) cache.remember({ key: { fromMe: true, id: String(i) }, message: { conversation: String(i) } })
  cache.remember({ key: { fromMe: false, id: 'incoming' }, message: { conversation: 'incoming' } })
  assert.equal(cache.get('0'), undefined)
  assert.equal(cache.get('incoming'), undefined)
  assert.equal(cache.entries.size, 2)
  assert.equal(readdirSync(directory).length, 2)
})
