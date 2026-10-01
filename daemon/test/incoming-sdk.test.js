import test from 'node:test'
import assert from 'node:assert/strict'
import { ActiveCall, CallState } from '../calling/dist/index.mjs'

test('incoming SDK answers with voice only and closes on another device answering', () => {
  let accepts = 0, rejects = 0
  const engine = { acceptCall: () => accepts++, rejectCall: () => rejects++, endCall: () => {}, setMute: () => {} }
  const call = new ActiveCall('synthetic', engine, 0)
  call.incoming = true
  call._updateState(CallState.ReceivedCall)
  assert.equal(call._audioSource, 'silence')
  call.accept('microphone:test', 10000)
  assert.equal(accepts, 1)
  assert.equal(call._audioSource, 'microphone:test')
  call._updateState(CallState.ActiveElsewhere)
  assert.throws(() => call.accept(), /no longer ringing/)
  const next = new ActiveCall('synthetic-next', engine, 0)
  next.incoming = true
  next._updateState(CallState.ReceivedCall)
  next.decline()
  assert.equal(rejects, 1)
})
