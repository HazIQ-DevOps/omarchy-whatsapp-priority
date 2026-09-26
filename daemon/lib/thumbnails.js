import { existsSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, join, sep } from 'node:path'
import { mediaDir } from './paths.js'

const runFile = promisify(execFile)
const pending = new Map()

function thumbnailPath(id, kind) {
  const safe = String(id || 'media').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  return join(mediaDir, `${safe}.${kind}.jpg`)
}

// WhatsApp often includes a small JPEG with a video or link. Keep that poster
// locally without fetching the full video or the linked website.
export function cacheJpegThumbnail(id, kind, bytes) {
  const target = thumbnailPath(id, kind)
  if (existsSync(target)) return target
  if (!bytes) return ''
  const image = Buffer.from(bytes)
  if (image.length < 4 || image.length > 256 * 1024
    || image[0] !== 0xff || image[1] !== 0xd8
    || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) return ''
  try {
    writeFileSync(target, image, { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if (err.code !== 'EEXIST') return ''
  }
  return target
}

export async function ensureVideoThumbnail(message) {
  if (!message?.videoPath || !message.id) return message?.videoThumbnailPath || ''
  const target = thumbnailPath(message.id, 'video')
  if (existsSync(target)) return target
  if (pending.has(target)) return pending.get(target)
  const job = (async () => {
    let tmp = ''
    try {
      // A snapshot must never make ffmpeg read files outside this plugin's
      // private media cache, even if a local store entry was tampered with.
      const source = realpathSync(message.videoPath)
      const cacheRoot = realpathSync(mediaDir)
      if (!source.startsWith(cacheRoot + sep) || !existsSync(source)) return ''
      tmp = join(mediaDir, `.${basename(target)}.${process.pid}.${Date.now()}.jpg`)
      await runFile('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-ss', '0.2', '-i', source, '-frames:v', '1',
        '-vf', 'scale=480:-2:force_original_aspect_ratio=decrease',
        '-q:v', '4', tmp
      ], { timeout: 12000 })
      if (!existsSync(tmp)) return ''
      renameSync(tmp, target)
      return target
    } catch {
      return ''
    } finally {
      if (tmp) rmSync(tmp, { force: true })
    }
  })()
  pending.set(target, job)
  try { return await job } finally { pending.delete(target) }
}
