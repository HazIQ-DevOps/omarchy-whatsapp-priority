import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { MAX_PASTED_FILE_BYTES } from './clipboard-file.js'
import { safeDocumentName } from './media.js'

export function validateOutgoingFile(path, claimedMime, claimedName, runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`) {
  if (typeof path !== 'string' || !path) throw new Error('sendFile: file path required')
  const allowedDir = realpathSync(join(runtimeDir, 'omarchy-whatsapp-paste'))
  const realPath = realpathSync(path)
  const details = lstatSync(path)
  if (dirname(realPath) !== allowedDir || !/^paste\.[a-zA-Z0-9]+$/.test(basename(realPath))
    || !details.isFile() || details.isSymbolicLink() || details.uid !== process.getuid())
    throw new Error('sendFile: file must be a private pasted file')
  if (details.size < 1 || details.size > MAX_PASTED_FILE_BYTES)
    throw new Error('sendFile: file exceeds the 200 MB limit')
  const mimetype = typeof claimedMime === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(claimedMime)
    ? claimedMime : 'application/octet-stream'
  const fileName = safeDocumentName(claimedName, basename(realPath), mimetype)
  return { path: realPath, mimetype, fileName, bytes: details.size }
}
