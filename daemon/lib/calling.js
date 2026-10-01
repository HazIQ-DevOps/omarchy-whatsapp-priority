import { spawn } from 'node:child_process'

export async function resolveCallTarget({ jid, phone }, socket, canonical = value => value) {
  if (phone !== undefined && String(phone).trim()) {
    const number = String(phone).replace(/[ +()-]/g, '')
    if (!/^\d{7,15}$/.test(number)) throw new Error('Use an international phone number including country code')
    return number
  }
  let target = canonical(String(jid || ''))
  if (target.endsWith('@lid')) target = await socket.signalRepository?.lidMapping?.getPNForLID(target)
  if (!target || !target.endsWith('@s.whatsapp.net')) throw new Error('Could not find this contact’s phone number. Use Call a phone number from the chat list.')
  const number = target.split('@')[0].split(':')[0]
  if (!/^\d{7,15}$/.test(number)) throw new Error('This conversation cannot receive a voice call')
  return number
}

// A single calling engine shares the chat daemon's existing linked-device
// socket. It never owns or closes that socket, and initializes only on demand.
export class CallingManager {
  constructor({ getSocket, publish, canonicalJid, nameFor, diagnostic = () => {}, onIncoming = () => {}, loadClient = () => import('../calling/dist/index.mjs') }) {
    this.getSocket = getSocket
    this.publish = publish
    this.canonicalJid = canonicalJid
    this.diagnostic = diagnostic
    this.onIncoming = onIncoming
    this.nameFor = nameFor
    this.loadClient = loadClient
    this.client = null
    this.socket = null
    this.pending = null
    this.call = null
    this.player = null
    this.epoch = 0
    this.playback = { sampleRate: 16000, channels: 1 }
    this.state = { phase: 'idle', jid: '', name: '', muted: false, error: '', startedAt: 0 }
  }
  update(patch) {
    this.state = { ...this.state, ...patch }
    this.publish({ t: 'callState', call: this.state })
  }
  stopPlayback() {
    const player = this.player
    this.player = null
    player?.stdin?.end()
    player?.kill('SIGTERM')
  }
  play(pcm) {
    if (!this.call) return
    if (!this.player) {
      const player = spawn('pw-play', ['--raw', '--format', 'f32', '--rate', String(this.playback.sampleRate || 16000), '--channels', String(this.playback.channels || 1), '--latency', '40ms', '--media-role', 'Communication', '-'], { stdio: ['pipe', 'ignore', 'pipe'] })
      this.player = player
      player.stdin.on('error', () => {})
      player.stderr.on('data', () => {})
      player.on('error', () => this.update({ error: 'Could not open the speaker. Install pipewire-audio and check the system output.' }))
      player.once('exit', code => {
        if (this.player !== player) return
        this.player = null
        if (code && this.call) this.update({ error: 'Speaker playback stopped. Check the system output.' })
      })
    }
    if (this.player.stdin.writableLength > 16000) return
    const bytes = Buffer.allocUnsafe(pcm.length * 4)
    for (let i = 0; i < pcm.length; i++) bytes.writeFloatLE(pcm[i], i * 4)
    this.player.stdin.write(bytes)
  }
  async prepare() {
    const socket = this.getSocket()
    if (!socket) throw new Error('WhatsApp is not connected')
    if (this.client && this.socket === socket && !this.pending) return this.client
    if (this.pending) return this.pending
    const epoch = this.epoch
    this.pending = (async () => {
      const { VoipClient } = await this.loadClient()
      if (epoch !== this.epoch) throw new Error('Call cancelled')
      const client = new VoipClient({ socket, authDir: '' })
      this.client = client
      this.socket = socket
      client.on('native-log', data => this.diagnostic('native log', data))
      client.on('signaling-trace', data => this.diagnostic('signaling trace', data))
      client.on('call-stanza', data => this.diagnostic('call stanza', data))
      client.on('call-state-diagnostic', data => this.diagnostic('native call state', data))
      client.on('signaling-error', error => this.diagnostic('signaling error', { message: String(error?.message || error).replace(/[\w:+.-]+@(s\.whatsapp\.net|lid|g\.us)/g, '[peer]') }))
      client.on('engine-event', data => { if ([2, 16].includes(data.eventType)) this.diagnostic('native event', data) })
      client.on('incoming-call', call => {
        if (this.client !== client || epoch !== this.epoch) { call.decline(); return }
        if (this.state.phase !== 'idle') { call.decline(); return }
        const jid = this.canonicalJid(call.peerJid)
        this.watchCall(call)
        this.update({ phase: 'incoming', jid, name: this.nameFor(jid), direction: 'incoming', error: '', muted: false, startedAt: 0 })
        this.onIncoming(this.state)
      })
      client.on('playback-config' , config => { this.playback = config })
      client.on('audio-error', () => {
        if (this.client === client && this.state.phase !== 'idle' && this.state.phase !== 'ending')
          this.update({ error: 'Microphone unavailable. Choose another microphone in Settings.' })
      })
      try {
        await client.connect()
        this.diagnostic('engine ready', {})
        if (epoch !== this.epoch || socket !== this.getSocket()) throw new Error('Call cancelled or WhatsApp disconnected')
        return client
      } catch (err) {
        client.disconnect()
        if (this.client === client) { this.client = null; this.socket = null }
        throw err
      }
    })().finally(() => { this.pending = null })
    return this.pending
  }
  async start({ jid = '', phone, microphone = '' }) {
    if (this.state.phase !== 'idle') throw new Error('A call is already in progress')
    const socket = this.getSocket()
    if (!socket) throw new Error('WhatsApp is not connected')
    const epoch = this.epoch
    this.update({ phase: 'initializing', direction: 'outgoing', jid, name: jid ? this.nameFor(jid) : String(phone || ''), error: '', muted: false, startedAt: 0 })
    try {
      const number = await resolveCallTarget({ jid, phone }, socket, this.canonicalJid)
      const client = await this.prepare()
      if (epoch !== this.epoch) return
      this.update({ phase: 'dialing' })
      const call = await client.call(number, { audioSource: `microphone:${String(microphone).trim()}`, durationMs: 10 * 60 * 1000 })
      if (epoch !== this.epoch) { call.end(); return }
      this.watchCall(call)
      if (call.state === 2) this.update({ phase: 'ringing' })
      if (call.state === 6) this.update({ phase: 'active', startedAt: Date.now() })
    } catch (err) {
      if (epoch === this.epoch) this.update({ phase: 'idle', error: err.message })
      throw err
    }
  }
  watchCall(call) {
    this.call = call
    call.on('ringing', () => { if (this.call === call && !call.incoming) this.update({ phase: 'ringing' }) })
    call.on('connected', () => { if (this.call === call) this.update({ phase: 'active', startedAt: Date.now() }) })
    call.on('audio', pcm => this.play(pcm))
    call.on('error', err => { if (this.call === call) this.update({ error: err.message }) })
    call.once('ended', reason => {
      if (this.call !== call) return
      this.call = null
      this.stopPlayback()
      this.update({ phase: 'idle', error: '', muted: false, startedAt: 0, ended: reason })
    })
  }
  answer(microphone = '') {
    if (this.state.phase !== 'incoming' || !this.call) throw new Error('No incoming call to answer')
    this.update({ phase: 'answering', error: '' })
    try { this.call.accept(`microphone:${String(microphone).trim()}`, 10 * 60 * 1000) }
    catch (err) { this.update({ phase: 'incoming', error: err.message }); throw err }
  }
  decline() {
    if (this.state.phase !== 'incoming' || !this.call) throw new Error('No incoming call to decline')
    this.update({ phase: 'ending', error: '' })
    this.call.decline()
  }
  hangup() {
    if (this.state.phase === 'incoming') { this.decline(); return }
    if (this.call) {
      this.update({ phase: 'ending', error: '' })
      this.call.end()
    }
    else if (this.state.phase !== 'idle') this.dispose('cancelled')
  }
  mute(muted) {
    if (!this.call) throw new Error('No connected call to mute')
    this.call.mute(Boolean(muted))
    this.update({ muted: Boolean(muted) })
  }
  dismiss() { if (this.state.phase === 'idle') this.update({ error: '' }) }
  dispose(reason = 'disconnected') {
    this.epoch++
    this.call?.end()
    this.call = null
    this.stopPlayback()
    this.client?.disconnect()
    this.client = null
    this.socket = null
    this.update({ phase: 'idle', error: '', muted: false, startedAt: 0, ended: reason })
  }
}
