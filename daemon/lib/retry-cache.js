import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { proto } from 'baileys'

// Keep the original protobuf, including media keys, quoted context and protocol
// actions. Reconstructing a resend from the panel's text preview changes it.
export class RetryCache {
  constructor(directory, { maxEntries = 1000, maxAgeMs = 7 * 86400000 } = {}) {
    this.directory = directory
    this.maxEntries = maxEntries
    this.maxAgeMs = maxAgeMs
    this.entries = new Map()
  }

  path(id) {
    return join(this.directory, createHash('sha256').update(id).digest('hex') + '.json')
  }

  load() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    for (const file of readdirSync(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
      try {
        const entry = JSON.parse(readFileSync(join(this.directory, file), 'utf8'))
        if (typeof entry.id === 'string' && typeof entry.content === 'string' && Number.isFinite(entry.ts)
            && this.path(entry.id) === join(this.directory, file)) this.entries.set(entry.id, entry)
      } catch { /* one incomplete cache file must not prevent connection */ }
    }
    this.prune()
  }

  remember(raw) {
    if (!raw?.key?.fromMe || !raw.key.id || !raw.message) return
    const id = String(raw.key.id)
    const entry = { id, ts: Date.now(), content: Buffer.from(proto.Message.encode(raw.message).finish()).toString('base64') }
    const path = this.path(id)
    writeFileSync(path + '.tmp', JSON.stringify(entry), { mode: 0o600 })
    renameSync(path + '.tmp', path)
    this.entries.delete(id)
    this.entries.set(id, entry)
    this.prune()
  }

  get(id) {
    const entry = this.entries.get(id)
    if (!entry || Date.now() - entry.ts > this.maxAgeMs) return undefined
    try { return proto.Message.decode(Buffer.from(entry.content, 'base64')) }
    catch { return undefined }
  }

  prune() {
    const entries = [...this.entries.values()].reverse().sort((a, b) => b.ts - a.ts)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (i < this.maxEntries && Date.now() - entry.ts <= this.maxAgeMs) continue
      this.entries.delete(entry.id)
      try { unlinkSync(this.path(entry.id)) } catch { /* already removed */ }
    }
  }

  clear() {
    rmSync(this.directory, { recursive: true, force: true })
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.entries.clear()
  }
}
