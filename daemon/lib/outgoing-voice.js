import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export const MAX_OUTGOING_VOICE_BYTES = 12 * 1024 * 1024

export function validateOutgoingVoice(path, runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`) {
  if (typeof path !== 'string' || !path) throw new Error('sendVoice: voice path required')
  const allowedDir = realpathSync(join(runtimeDir, 'omarchy-whatsapp-voice'))
  const dirDetails = lstatSync(allowedDir)
  const realPath = realpathSync(path)
  const details = lstatSync(path)
  if (!dirDetails.isDirectory() || dirDetails.uid !== process.getuid() || (dirDetails.mode & 0o077) !== 0
      || dirname(realPath) !== allowedDir || !/^voice\.[A-Za-z0-9]{8}\.ogg$/.test(basename(realPath))
      || !details.isFile() || details.isSymbolicLink() || details.uid !== process.getuid()
      || (details.mode & 0o077) !== 0)
    throw new Error('sendVoice: voice note must be a private recording')
  if (details.size < 100 || details.size > MAX_OUTGOING_VOICE_BYTES)
    throw new Error('sendVoice: voice note exceeds the 12 MB limit')

  const handle = openSync(realPath, 'r')
  const header = Buffer.alloc(128)
  let bytesRead
  try { bytesRead = readSync(handle, header, 0, header.length, 0) }
  finally { closeSync(handle) }
  if (bytesRead < 36 || header.toString('ascii', 0, 4) !== 'OggS'
      || !header.subarray(0, bytesRead).includes(Buffer.from('OpusHead')))
    throw new Error('sendVoice: recording is not Ogg Opus audio')
  return { path: realPath, mimetype: 'audio/ogg; codecs=opus', bytes: details.size }
}
