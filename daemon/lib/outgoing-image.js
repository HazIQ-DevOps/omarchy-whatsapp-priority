import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export const MAX_OUTGOING_IMAGE_BYTES = 12 * 1024 * 1024

function detectedMime(header) {
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
    return 'image/jpeg'
  if (header.length >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  return ''
}

export function validateOutgoingImage(path, claimedMime, runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`) {
  if (typeof path !== 'string' || !path) throw new Error('sendImage: image path required')
  const allowedDir = realpathSync(join(runtimeDir, 'omarchy-whatsapp-paste'))
  const realPath = realpathSync(path)
  const details = lstatSync(path)
  if (dirname(realPath) !== allowedDir || !basename(realPath).startsWith('paste.') || !details.isFile() || details.isSymbolicLink() || details.uid !== process.getuid())
    throw new Error('sendImage: image must be a private pasted file')
  if (details.size < 1 || details.size > MAX_OUTGOING_IMAGE_BYTES)
    throw new Error('sendImage: image exceeds the 12 MB limit')

  const handle = openSync(realPath, 'r')
  const header = Buffer.alloc(12)
  let bytesRead
  try {
    bytesRead = readSync(handle, header, 0, header.length, 0)
  } finally {
    closeSync(handle)
  }
  const mimetype = detectedMime(header.subarray(0, bytesRead))
  if (!mimetype || mimetype !== claimedMime)
    throw new Error('sendImage: image format does not match the clipboard')
  return { path: realPath, mimetype, bytes: details.size }
}
