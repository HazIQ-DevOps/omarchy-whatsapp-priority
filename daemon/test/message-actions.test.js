import test from 'node:test'
import assert from 'node:assert/strict'
import { generateForwardMessageContent } from 'baileys'
import { quotedMessageFor, forwardMessageFor } from '../lib/message-actions.js'

const key = { remoteJid: '123@s.whatsapp.net', id: 'one', fromMe: false }

test('replies preserve the original key and text', () => {
  const quoted = quotedMessageFor({ key, type: 'extendedTextMessage', text: 'Hello' })
  assert.deepEqual(quoted, { key, message: { conversation: 'Hello' } })
})

test('forwards are encoded as forwarded WhatsApp messages', () => {
  const original = forwardMessageFor({ key, type: 'conversation', text: 'Hello' })
  const content = generateForwardMessageContent(original)
  assert.equal(content.extendedTextMessage.text, 'Hello')
  assert.equal(content.extendedTextMessage.contextInfo.isForwarded, true)
})

test('image forwarding retains encrypted media metadata', () => {
  const original = forwardMessageFor({
    key,
    type: 'imageMessage',
    text: 'A photo',
    media: {
      kind: 'image',
      mimetype: 'image/jpeg',
      mediaKey: Buffer.alloc(32, 1).toString('base64'),
      directPath: '/v/t62/test',
      fileSha256: Buffer.alloc(32, 2).toString('base64'),
      fileEncSha256: Buffer.alloc(32, 3).toString('base64'),
      fileLength: 100
    }
  })
  const content = generateForwardMessageContent(original)
  assert.equal(content.imageMessage.caption, 'A photo')
  assert.equal(content.imageMessage.contextInfo.isForwarded, true)
  assert.deepEqual(Buffer.from(content.imageMessage.mediaKey), Buffer.alloc(32, 1))
})

test('unsupported media is not silently forwarded as a placeholder', () => {
  assert.equal(forwardMessageFor({ key, type: 'videoMessage', text: 'Video' }), null)
})
