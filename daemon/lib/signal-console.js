// libsignal logs entire SessionEntry objects via console.info/warn, including
// private ratchet keys. Keep the event marker for diagnostics without writing
// key material into the user's systemd journal.
const SESSION_DUMP_LABELS = new Set([
  'Closing session:',
  'Opening session:',
  'Removing old closed session:',
  'Session already closed'
])

export function installSignalConsoleRedaction(target = console) {
  for (const method of ['info', 'warn']) {
    const original = target[method].bind(target)
    target[method] = (...args) => {
      if (SESSION_DUMP_LABELS.has(args[0]) && args.length > 1) {
        original(args[0], '[session details redacted]')
        return
      }
      original(...args)
    }
  }
}
