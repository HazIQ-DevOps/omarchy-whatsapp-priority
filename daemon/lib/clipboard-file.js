import { copyFileSync, existsSync, statSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const MAX_PASTED_FILE_BYTES = 200 * 1024 * 1024

export function pathFromClipboardUris(value) {
  const lines = String(value || '').split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line !== 'copy' && line !== 'cut')
  if (!lines.length) return ''
  if (lines.length !== 1) throw new Error('Paste one file at a time')
  let url
  try { url = new URL(lines[0]) } catch { return '' }
  if (url.protocol !== 'file:') return ''
  if (url.hostname && url.hostname !== 'localhost') throw new Error('Only local files can be pasted')
  return fileURLToPath(url)
}

export function stageClipboardFile(source, runtimeDir, mimeDetector = detectMime) {
  const details = statSync(source)
  if (!details.isFile()) throw new Error('Paste a regular file')
  if (details.size < 1 || details.size > MAX_PASTED_FILE_BYTES)
    throw new Error('File must be between 1 byte and 200 MB')
  const directory = join(runtimeDir, 'omarchy-whatsapp-paste')
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const path = join(directory, `paste.${randomBytes(12).toString('hex')}`)
  try {
    copyFileSync(source, path)
    chmodSync(path, 0o600)
    const mime = mimeDetector(path, source)
    const isImage = ['image/png', 'image/jpeg', 'image/webp'].includes(mime) && details.size <= 12 * 1024 * 1024
    return { kind: isImage ? 'image' : 'file', path, mime, name: basename(source), bytes: details.size }
  } catch (error) {
    try { unlinkSync(path) } catch { /* copy may have failed */ }
    throw error
  }
}

function detectMime(path, source) {
  try {
    const mime = execFileSync('file', ['--brief', '--mime-type', path], { encoding: 'utf8', timeout: 3000 }).trim()
    const officeTypes = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.odt': 'application/vnd.oasis.opendocument.text',
      '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
      '.odp': 'application/vnd.oasis.opendocument.presentation'
    }
    if (mime === 'application/zip' && officeTypes[extname(source).toLowerCase()])
      return officeTypes[extname(source).toLowerCase()]
    return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : 'application/octet-stream'
  } catch {
    return 'application/octet-stream'
  }
}
