import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { CallingManager, resolveCallTarget } from '../lib/calling.js'

const socket = { signalRepository: { lidMapping: { getPNForLID: async () => '27123456789@s.whatsapp.net' } } }

test('contact calls resolve phone aliases and LIDs; groups cannot be dialed', async () => {
  assert.equal(await resolveCallTarget({ jid: '123@lid' }, socket), '27123456789')
  assert.equal(await resolveCallTarget({ jid: '123@lid' }, socket, () => '27876543210@s.whatsapp.net'), '27876543210')
  await assert.rejects(resolveCallTarget({ jid: '123@g.us' }, socket), /phone number/)
  await assert.rejects(resolveCallTarget({ phone: 'abc+27' }, socket), /international/)
  assert.equal(await resolveCallTarget({ phone: '+27 (12) 345-6789' }, socket), '27123456789')
})

function harness(connect = async () => {}) {
  const events = [], clients = []
  let dialed = 0, ended = 0
  class Client extends EventEmitter {
    constructor(config) { super(); this.config = config; this.disposed = false; clients.push(this) }
    async connect() { await connect() }
    disconnect() { this.disposed = true }
    async call() {
      dialed++
      const call = new EventEmitter()
      call.state = 1
      call.end = () => { ended++; call.emit('ended', 'hangup') }
      call.mute = () => {}
      return call
    }
  }
  const manager = new CallingManager({ getSocket: () => socket, publish: e => events.push(e), canonicalJid: j => j, nameFor: () => 'Contact', loadClient: async () => ({ VoipClient: Client }) })
  return { manager, clients, events, dialed: () => dialed, ended: () => ended }
}

test('calling reuses the chat socket, allows one call, and ends without logging out', async () => {
  const h = harness()
  await h.manager.start({ phone: '+27123456789' })
  assert.equal(h.clients[0].config.socket, socket)
  await assert.rejects(h.manager.start({ phone: '+27123456789' }), /already/)
  h.manager.hangup()
  assert.equal(h.manager.state.phase, 'idle')
  assert.equal(h.ended(), 1)
  await h.manager.start({ phone: '+27123456789' })
  assert.equal(h.clients.length, 1)
  h.manager.dispose()
  assert.equal(h.clients[0].disposed, true)
})

test('hangup during engine initialization prevents a delayed call from being placed', async () => {
  let release
  const h = harness(() => new Promise(resolve => { release = resolve }))
  const attempt = h.manager.start({ phone: '+27123456789' })
  await new Promise(resolve => setImmediate(resolve))
  h.manager.hangup()
  release()
  await assert.rejects(attempt, /cancelled/)
  assert.equal(h.dialed(), 0)
  assert.equal(h.manager.state.phase, 'idle')
  assert.equal(h.clients[0].disposed, true)
})

 test('microphone teardown errors do not persist after hangup', async () => {
  const h = harness()
  await h.manager.start({ phone: '+27123456789' })
  h.clients[0].emit('audio-error', 'capture failed')
  assert.match(h.manager.state.error, /Microphone unavailable/)
  const call = h.manager.call
  call.end = () => {
    h.clients[0].emit('audio-error', 'capture stopped')
    call.emit('ended', 'hangup')
  }
  h.manager.hangup()
  h.clients[0].emit('audio-error', 'late capture shutdown')
  assert.equal(h.manager.state.phase, 'idle')
  assert.equal(h.manager.state.error, '')
})

function incomingCall() {
  const call = new EventEmitter()
  call.incoming = true
  call.peerJid = '27123456789@s.whatsapp.net'
  call.accept = (source, duration) => { call.source = source; call.duration = duration }
  call.decline = () => call.emit('ended', 'declined')
  call.end = () => call.emit('ended', 'hangup')
  call.mute = () => {}
  return call
}

test('incoming calls wait for explicit answer, use selected microphone and end cleanly', async () => {
  const h = harness()
  await h.manager.prepare()
  const call = incomingCall()
  h.clients[0].emit('incoming-call', call)
  assert.equal(h.manager.state.phase, 'incoming')
  assert.equal(call.source, undefined)
  await assert.rejects(h.manager.start({ phone: '+27123456789' }), /already/)
  h.manager.answer('test-source')
  assert.equal(call.source, 'microphone:test-source')
  assert.equal(call.duration, 600000)
  assert.equal(h.manager.state.phase, 'answering')
  call.emit('connected')
  assert.equal(h.manager.state.phase, 'active')
  call.emit('ended', 'remote_end')
  assert.equal(h.manager.state.phase, 'idle')
  assert.equal(h.manager.state.error, '')
})

test('decline and remote cancellation dismiss ringing without activating microphone', async () => {
  const h = harness()
  await h.manager.prepare()
  const first = incomingCall()
  h.clients[0].emit('incoming-call', first)
  h.manager.decline()
  assert.equal(h.manager.state.phase, 'idle')
  assert.equal(first.source, undefined)
  const second = incomingCall()
  h.clients[0].emit('incoming-call', second)
  second.emit('ended', 'answered_elsewhere')
  assert.equal(h.manager.state.phase, 'idle')
  assert.throws(() => h.manager.answer(), /No incoming/)
  assert.equal(second.source, undefined)
})
