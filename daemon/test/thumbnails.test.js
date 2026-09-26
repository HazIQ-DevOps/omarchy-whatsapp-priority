import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const cache = mkdtempSync(join(tmpdir(), 'wa-thumbnails-'))
process.env.OMARCHY_WHATSAPP_MEDIA = cache
const { cacheJpegThumbnail, ensureVideoThumbnail } = await import('../lib/thumbnails.js')

test('WhatsApp JPEG posters are cached without downloading a video', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const jpeg = join(cache, 'sample.jpg')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=c=blue:s=80x60', '-frames:v', '1', jpeg])
  const saved = cacheJpegThumbnail('message/id', 'video', readFileSync(jpeg))
  assert.equal(saved, join(cache, 'message_id.video.jpg'))
  assert.deepEqual(readFileSync(saved), readFileSync(jpeg))
  assert.equal(cacheJpegThumbnail('bad', 'video', Buffer.from('not jpeg')), '')
})

test('cached videos receive a local poster, while outside paths are rejected', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  const video = join(cache, 'clip.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=c=green:s=96x72:d=1', '-c:v', 'mpeg4', '-y', video])
  const poster = await ensureVideoThumbnail({ id: 'clip', videoPath: video })
  assert.equal(poster, join(cache, 'clip.video.jpg'))
  assert.equal(readFileSync(poster)[0], 0xff)
  assert.equal(await ensureVideoThumbnail({ id: 'clip', videoPath: video }), poster)
  assert.equal(await ensureVideoThumbnail({ id: 'outside', videoPath: '/etc/hosts' }), '')
})

test.after(() => rmSync(cache, { recursive: true, force: true }))
