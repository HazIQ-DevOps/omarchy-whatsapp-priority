import { pathFromClipboardUris, stageClipboardFile } from './lib/clipboard-file.js'

try {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const source = pathFromClipboardUris(Buffer.concat(chunks).toString('utf8'))
  const result = source ? stageClipboardFile(source, process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`)
    : { kind: 'none' }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ kind: 'error', message: String(error?.message || 'Could not paste file') })}\n`)
}
