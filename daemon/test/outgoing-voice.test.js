import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateWAMessageContent } from 'baileys'
import { MAX_OUTGOING_VOICE_BYTES, validateOutgoingVoice } from '../lib/outgoing-voice.js'

test('accepts a private Ogg Opus voice note and rejects other files', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'wa-voice-test-'))
  try {
    const voiceDir = join(runtime, 'omarchy-whatsapp-voice')
    mkdirSync(voiceDir, { mode: 0o700 })
    const voicePath = join(voiceDir, 'voice.12345678.ogg')
    const header = Buffer.alloc(128)
    header.write('OggS', 0)
    header.write('OpusHead', 28)
    writeFileSync(voicePath, header, { mode: 0o600 })
    assert.deepEqual(validateOutgoingVoice(voicePath, runtime), {
      path: voicePath, mimetype: 'audio/ogg; codecs=opus', bytes: header.length
    })

    const link = join(voiceDir, 'voice.abcdefgh.ogg')
    symlinkSync(voicePath, link)
    assert.throws(() => validateOutgoingVoice(link, runtime), /private recording/)

    const outside = join(runtime, 'voice.abcdefgh.ogg')
    writeFileSync(outside, header, { mode: 0o600 })
    assert.throws(() => validateOutgoingVoice(outside, runtime), /private recording/)

    header.write('RIFF', 0)
    writeFileSync(voicePath, header, { mode: 0o600 })
    assert.throws(() => validateOutgoingVoice(voicePath, runtime), /Ogg Opus/)
    truncateSync(voicePath, MAX_OUTGOING_VOICE_BYTES + 1)
    assert.throws(() => validateOutgoingVoice(voicePath, runtime), /12 MB limit/)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})

test('recording helper encodes a playable WhatsApp voice note', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'wa-voice-encode-'))
  const helper = fileURLToPath(new URL('../../bin/omarchy-whatsapp-voice', import.meta.url))
  const env = { ...process.env, XDG_RUNTIME_DIR: runtime }
  try {
    const prepared = JSON.parse(execFileSync('bash', [helper, 'prepare'], { env, encoding: 'utf8' }))
    assert.equal(prepared.kind, 'prepared')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=400:duration=1', '-ac', '1', prepared.path])
    const result = JSON.parse(execFileSync('bash', [helper, 'finish', prepared.path], { env, encoding: 'utf8' }))
    assert.equal(result.kind, 'voice')
    assert.equal(validateOutgoingVoice(result.path, runtime).mimetype, 'audio/ogg; codecs=opus')
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', result.path], { encoding: 'utf8' })
    assert.ok(Number(probe) >= 0.9)
    const content = await generateWAMessageContent({
      audio: { url: result.path }, mimetype: 'audio/ogg; codecs=opus', ptt: true
    }, { upload: async () => ({ mediaUrl: 'https://example.invalid/audio', directPath: '/synthetic/audio' }) })
    assert.equal(content.audioMessage.ptt, true)
    assert.equal(content.audioMessage.mimetype, 'audio/ogg; codecs=opus')
    assert.equal(content.audioMessage.seconds, 1)
    execFileSync('bash', [helper, 'delete', result.path], { env })
    assert.throws(() => validateOutgoingVoice(result.path, runtime))

    const silent = JSON.parse(execFileSync('bash', [helper, 'prepare'], { env, encoding: 'utf8' }))
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=mono', '-t', '1', silent.path])
    const rejected = JSON.parse(execFileSync('bash', [helper, 'finish', silent.path], { env, encoding: 'utf8' }))
    assert.equal(rejected.kind, 'error')
    assert.match(rejected.message, /No microphone audio/)
    const unavailable = spawnSync('bash', [helper, 'record', silent.path, 'nonexistent.microphone'], { env })
    assert.equal(unavailable.status, 14)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})
