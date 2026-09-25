import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractPreviewMedia } from '../lib/message.js'
import {
  MAX_AUDIO_BYTES, MAX_DOCUMENT_BYTES, mediaByteLimit, mediaPathFor,
  MediaCache, safeDocumentName, saveDocumentToDownloads
} from '../lib/media.js'

const mediaKey = Buffer.alloc(32, 8)

test('voice notes retain decryption details and playback duration', () => {
  const media = extractPreviewMedia({ audioMessage: {
    mediaKey, directPath: '/v/t62/audio', mimetype: 'audio/ogg; codecs=opus',
    fileLength: 300, ptt: true, seconds: 12
  } })
  assert.equal(media.kind, 'audio')
  assert.equal(media.mediaKey, mediaKey.toString('base64'))
  assert.equal(media.ptt, true)
  assert.equal(media.seconds, 12)
  assert.match(mediaPathFor('audio-example', media.mimetype), /\.ogg$/)
  assert.equal(mediaByteLimit(media), MAX_AUDIO_BYTES)
  const cache = new MediaCache()
  assert.throws(() => cache.enqueue('chat', {
    id: 'oversize-audio', media: { kind: 'audio', mimetype: 'audio/ogg', fileLength: MAX_AUDIO_BYTES + 1 }
  }, { requested: true }), /50 MB/)
})

test('captioned documents retain their filename and use on-demand downloads', () => {
  const media = extractPreviewMedia({ documentWithCaptionMessage: { message: {
    documentMessage: {
      mediaKey, directPath: '/v/t62/document', mimetype: 'application/pdf',
      fileLength: 1024, fileName: 'report.pdf', caption: 'For review'
    }
  } } })
  assert.equal(media.kind, 'document')
  assert.equal(media.fileName, 'report.pdf')
  assert.equal(media.caption, 'For review')
  assert.equal(mediaByteLimit(media), MAX_DOCUMENT_BYTES)
  assert.match(mediaPathFor('document-example', media.mimetype), /\.pdf$/)
  const cache = new MediaCache()
  cache.pump = () => {}
  const message = { id: `synthetic-document-${Date.now()}`, media }
  assert.equal(cache.enqueue('chat', message), false)
  assert.equal(cache.queue.length, 0)
  assert.equal(cache.enqueue('chat', message, { requested: true }), true)
  assert.equal(cache.queue.length, 1)
  assert.throws(() => cache.enqueue('chat', {
    id: 'oversize-document', media: { kind: 'document', mimetype: 'application/pdf', fileLength: MAX_DOCUMENT_BYTES + 1 }
  }, { requested: true }), /200 MB/)
})

test('document saving strips path traversal and never overwrites an existing file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'omarchy-whatsapp-attachment-'))
  try {
    const cachePath = join(directory, 'cached.bin')
    const downloads = join(directory, 'Downloads')
    writeFileSync(cachePath, 'document bytes')
    assert.equal(safeDocumentName('../../report.pdf', 'id', 'application/pdf'), 'report.pdf')
    assert.equal(safeDocumentName('..\\..\\report.pdf', 'id', 'application/pdf'), 'report.pdf')
    const first = { id: 'one', cachePath, media: { fileName: '../../report.pdf', mimetype: 'application/pdf' } }
    const second = { id: 'two', cachePath, media: { fileName: '../../report.pdf', mimetype: 'application/pdf' } }
    assert.equal(await saveDocumentToDownloads(first, downloads), join(downloads, 'report.pdf'))
    assert.equal(await saveDocumentToDownloads(second, downloads), join(downloads, 'report (1).pdf'))
    assert.equal(readFileSync(first.documentPath, 'utf8'), 'document bytes')
    assert.equal(readFileSync(second.documentPath, 'utf8'), 'document bytes')
    assert.equal(await saveDocumentToDownloads(first, downloads), first.documentPath)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
