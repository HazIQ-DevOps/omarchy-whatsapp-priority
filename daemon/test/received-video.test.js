import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPreviewMedia } from '../lib/message.js'
import { existingMediaPath, MAX_VIDEO_BYTES, mediaByteLimit, mediaPathFor, MediaCache } from '../lib/media.js'

const mediaKey = Buffer.alloc(32, 7)

test('received videos and video notes retain the metadata needed for decryption', () => {
  for (const type of ['videoMessage', 'ptvMessage']) {
    const media = extractPreviewMedia({ [type]: {
      mediaKey,
      directPath: '/v/t62/synthetic',
      mimetype: 'video/mp4',
      fileLength: 123,
      caption: 'A clip'
    } })
    assert.equal(media.kind, 'video')
    assert.equal(media.messageType, type)
    assert.equal(media.mimetype, 'video/mp4')
    assert.equal(media.mediaKey, mediaKey.toString('base64'))
    assert.equal(media.fileLength, 123)
    assert.equal(media.caption, 'A clip')
  }
})

test('video downloads are requested explicitly and use a video file extension', () => {
  const cache = new MediaCache()
  cache.pump = () => {}
  const message = {
    id: `synthetic-${Date.now()}`,
    media: { kind: 'video', mimetype: 'video/mp4', fileLength: 123 }
  }
  assert.equal(cache.enqueue('chat', message), false)
  assert.equal(cache.queue.length, 0)
  assert.equal(cache.enqueue('chat', message, { requested: true }), true)
  assert.equal(cache.queue.length, 1)
  assert.match(mediaPathFor(message.id, message.media.mimetype), /\.mp4$/)
  assert.equal(existingMediaPath(message), '')
  assert.equal(mediaByteLimit(message.media), MAX_VIDEO_BYTES)
  assert.throws(() => cache.enqueue('chat', {
    id: 'oversize', media: { kind: 'video', mimetype: 'video/mp4', fileLength: MAX_VIDEO_BYTES + 1 }
  }, { requested: true }), /100 MB/)
})
