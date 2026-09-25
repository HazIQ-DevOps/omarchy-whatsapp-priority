import { constants, createWriteStream, existsSync, renameSync, unlinkSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, basename, extname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { downloadContentFromMessage } from 'baileys'
import { mediaDir } from './paths.js'
import { logger } from './logger.js'

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024
export const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024
const MAX_PARALLEL = 2

const EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
}

function safeId(id) {
  return String(id || 'media').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
}

function extFor(mimetype) {
  const type = String(mimetype || '').split(';')[0].trim().toLowerCase()
  return EXT[type] || (type.startsWith('video/') ? 'mp4'
    : type.startsWith('audio/') ? 'audio' : type.startsWith('image/') ? 'jpg' : 'bin')
}

export function mediaByteLimit(media) {
  return media?.kind === 'video' ? MAX_VIDEO_BYTES
    : media?.kind === 'audio' ? MAX_AUDIO_BYTES
      : media?.kind === 'document' ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES
}

export function defaultDownloadDir() {
  try {
    const value = execFileSync('xdg-user-dir', ['DOWNLOAD'], { encoding: 'utf8', timeout: 2000 }).trim()
    if (isAbsolute(value)) return value
  } catch { /* use the conventional directory */ }
  return join(homedir(), 'Downloads')
}

export function safeDocumentName(fileName, id, mimetype) {
  const raw = basename(String(fileName || '').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/^\.+/, '').trim().slice(0, 140)
  const fallback = `document-${safeId(id)}.${extFor(mimetype)}`
  if (!raw) return fallback
  return extname(raw) ? raw : `${raw}.${extFor(mimetype)}`
}

export async function saveDocumentToDownloads(message, directory = defaultDownloadDir()) {
  if (!message?.cachePath) throw new Error('Document has not been downloaded')
  if (message.documentPath && existsSync(message.documentPath)) return message.documentPath
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const name = safeDocumentName(message.media?.fileName, message.id, message.media?.mimetype)
  const suffix = extname(name)
  const stem = name.slice(0, name.length - suffix.length)
  for (let i = 0; i < 1000; i++) {
    const target = join(directory, i ? `${stem} (${i})${suffix}` : name)
    try {
      await copyFile(message.cachePath, target, constants.COPYFILE_EXCL)
      message.documentPath = target
      return target
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
  throw new Error('Could not find a free filename in Downloads')
}

export function mediaPathFor(id, mimetype) {
  return join(mediaDir, `${safeId(id)}.${extFor(mimetype)}`)
}

export function existingMediaPath(message) {
  if (!message?.id || !message.media) return ''
  const current = message.media.kind === 'video' ? message.videoPath
    : message.media.kind === 'audio' ? message.audioPath
      : message.media.kind === 'document' ? message.cachePath : message.imagePath
  if (current && existsSync(current)) return current
  if (message.media.kind === 'document' && message.documentPath && existsSync(message.documentPath))
    return message.documentPath
  const guessed = mediaPathFor(message.id, message.media.mimetype)
  return existsSync(guessed) ? guessed : ''
}

function toBuffer(value) {
  if (!value) return null
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'base64')
  if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data)
  return null
}

function toWaMessage(message) {
  const media = message.media
  const body = {
    mediaKey: toBuffer(media.mediaKey),
    directPath: media.directPath || undefined,
    url: media.url || undefined,
    mimetype: media.mimetype,
    fileEncSha256: toBuffer(media.fileEncSha256) || undefined,
    fileSha256: toBuffer(media.fileSha256) || undefined,
    fileLength: media.fileLength || undefined
  }
  return {
    key: message.key,
    // Baileys' media retry helper accepts videoMessage for both ordinary clips
    // and PTV notes; it needs the key and mediaKey to request a fresh URL.
    message: media.kind === 'sticker' ? { stickerMessage: body }
      : media.kind === 'video' ? { videoMessage: body }
        : media.kind === 'audio' ? { audioMessage: body }
          : media.kind === 'document' ? { documentMessage: body } : { imageMessage: body }
  }
}

export class MediaCache {
  constructor() {
    this.queue = []
    this.active = 0
    this.inFlight = new Set()
    this.onReady = null
    this.onError = null
    this.getSocket = () => null
  }

  enqueue(jid, message, { requested = false } = {}) {
    if (!message?.id || !message.media) return false
    if (['video', 'audio', 'document'].includes(message.media.kind) && !requested) return false
    const limit = mediaByteLimit(message.media)
    if (message.media.fileLength && message.media.fileLength > limit) {
      if (requested) throw new Error(`${message.media.kind} exceeds the ${limit / 1024 / 1024} MB download limit`)
      return false
    }
    const already = existingMediaPath(message)
    if (already) {
      const field = message.media.kind === 'video' ? 'videoPath'
        : message.media.kind === 'audio' ? 'audioPath'
          : message.media.kind === 'document' ? 'cachePath' : 'imagePath'
      if (message[field] !== already || requested) {
        message[field] = already
        Promise.resolve(this.onReady?.(jid, message)).catch((err) => this.onError?.(jid, message, err))
      }
      return true
    }
    if (this.inFlight.has(message.id)) return true
    this.inFlight.add(message.id)
    this.queue.push({ jid, message })
    this.pump()
    return true
  }

  pump() {
    while (this.active < MAX_PARALLEL && this.queue.length) {
      const job = this.queue.shift()
      this.active += 1
      this.download(job).finally(() => {
        this.active -= 1
        this.inFlight.delete(job.message.id)
        this.pump()
      })
    }
  }

  async pull(message) {
    const media = message.media
    const kind = media.kind === 'sticker' ? 'sticker'
      : ['video', 'audio', 'document'].includes(media.kind) ? media.kind : 'image'
    const opts = { options: { timeout: 20000 } }
    const first = {
      mediaKey: toBuffer(media.mediaKey),
      directPath: media.directPath || undefined,
      url: media.url || undefined
    }
    try {
      return await downloadContentFromMessage(first, kind, opts)
    } catch (err) {
      const sock = this.getSocket?.()
      if (!sock?.updateMediaMessage) throw err
      logger.info({ id: message.id }, 'media: refreshing expired link')
      const refreshed = await sock.updateMediaMessage(toWaMessage(message))
      const node = refreshed?.message?.imageMessage || refreshed?.message?.stickerMessage
        || refreshed?.message?.videoMessage || refreshed?.message?.ptvMessage
        || refreshed?.message?.audioMessage || refreshed?.message?.documentMessage
      if (node?.directPath) {
        media.directPath = node.directPath
        media.url = node.url || ''
      }
      return downloadContentFromMessage({
        mediaKey: toBuffer(node?.mediaKey || media.mediaKey),
        directPath: node?.directPath || media.directPath,
        url: node?.url
      }, kind, opts)
    }
  }

  async download({ jid, message }) {
    const media = message.media
    const target = mediaPathFor(message.id, media.mimetype)
    const tmp = `${target}.part`
    try {
      const stream = await this.pull(message)
      let bytes = 0
      const limit = mediaByteLimit(media)
      const guard = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length
          callback(bytes > limit ? new Error('Media exceeds the playback size limit') : null, chunk)
        }
      })
      await pipeline(stream, guard, createWriteStream(tmp, { mode: 0o600 }))
      renameSync(tmp, target)
      message[media.kind === 'video' ? 'videoPath'
        : media.kind === 'audio' ? 'audioPath'
          : media.kind === 'document' ? 'cachePath' : 'imagePath'] = target
      await this.onReady?.(jid, message)
    } catch (err) {
      try { unlinkSync(tmp) } catch { /* leftover */ }
      logger.warn({ err: String(err?.message || err), id: message.id }, 'media: download failed')
      this.onError?.(jid, message, err)
    }
  }
}
