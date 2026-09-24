import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Curve, generateSignalPubKey, useMultiFileAuthState } from 'baileys'
import { makeLibSignalRepository } from 'baileys/lib/Signal/libsignal.js'
import { installSignalConsoleRedaction } from '../lib/signal-console.js'

installSignalConsoleRedaction()
const logger = Object.fromEntries(['trace', 'debug', 'info', 'warn', 'error'].map((level) => [level, () => {}]))

async function endpoint(directory) {
  const { state: auth, saveCreds } = await useMultiFileAuthState(directory)
  await saveCreds()
  // This test is sequential; the socket normally supplies transaction locking.
  auth.keys.transaction = async (work) => work()
  const repo = makeLibSignalRepository(auth, logger)
  return { auth, repo }
}

test('encrypted messages survive PN-to-LID addressing changes and repository restart', async (t) => {
  // Synthetic peers only: this test never connects to WhatsApp or reads real keys.
  const alicePn = '10001:1@s.whatsapp.net'
  const aliceLid = '90001:1@lid'
  const bobPn = '10002:2@s.whatsapp.net'
  const directory = mkdtempSync(join(tmpdir(), 'whatsapp-signal-test-'))
  const alice = await endpoint(join(directory, 'alice'))
  const bob = await endpoint(join(directory, 'bob'))
  t.after(() => {
    alice.repo.close?.()
    bob.repo.close?.()
    rmSync(directory, { recursive: true, force: true })
  })
  const preKey = Curve.generateKeyPair()
  await bob.auth.keys.set({ 'pre-key': { '1': preKey } })
  await alice.repo.injectE2ESession({ jid: bobPn, session: {
    registrationId: bob.auth.creds.registrationId,
    identityKey: generateSignalPubKey(bob.auth.creds.signedIdentityKey.public),
    signedPreKey: {
      keyId: bob.auth.creds.signedPreKey.keyId,
      publicKey: generateSignalPubKey(bob.auth.creds.signedPreKey.keyPair.public),
      signature: bob.auth.creds.signedPreKey.signature
    },
    preKey: { keyId: 1, publicKey: generateSignalPubKey(preKey.public) }
  } })
  const first = await alice.repo.encryptMessage({ jid: bobPn, data: Buffer.from('initial') })
  assert.equal((await bob.repo.decryptMessage({ jid: alicePn, ...first })).toString(), 'initial')
  const reply = await bob.repo.encryptMessage({ jid: alicePn, data: Buffer.from('ack') })
  assert.equal((await alice.repo.decryptMessage({ jid: bobPn, ...reply })).toString(), 'ack')

  const next = await alice.repo.encryptMessage({ jid: bobPn, data: Buffer.from('address changed') })
  assert.equal(next.type, 'msg')
  await assert.rejects(bob.repo.decryptMessage({ jid: aliceLid, ...next }), /session/i)
  assert.equal(typeof bob.repo.migrateSession, 'function', 'protocol library must migrate PN sessions to LID')
  await bob.auth.keys.set({ 'device-list': { '10001': ['1'] } })
  await bob.repo.lidMapping.storeLIDPNMappings([{ pn: alicePn, lid: aliceLid }])
  const migration = await bob.repo.migrateSession(alicePn, aliceLid)
  assert.equal(migration.migrated, 1)
  assert.equal((await bob.repo.decryptMessage({ jid: aliceLid, ...next })).toString(), 'address changed')

  bob.repo.close?.()
  const restored = await endpoint(join(directory, 'bob'))
  bob.repo = restored.repo
  const afterRestart = await alice.repo.encryptMessage({ jid: bobPn, data: Buffer.from('after restart') })
  assert.equal((await bob.repo.decryptMessage({ jid: aliceLid, ...afterRestart })).toString(), 'after restart')
})
