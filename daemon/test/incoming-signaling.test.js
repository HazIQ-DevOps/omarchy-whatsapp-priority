import test from 'node:test'
import assert from 'node:assert/strict'
import { SignalingBridge } from '../calling/dist/signaling.mjs'

test('incoming native offers use exact creator identity and retain named platform', async () => {
 const errors = []
 const keys = { set: async () => {}, get: async (_type, ids) => Object.fromEntries(ids.map(id => [id, {token: Buffer.from([1])}])) }
 const bridge = new SignalingBridge({sock: { authState: {keys} }, onError: error => errors.push(error)})
 await bridge.init()
 let offer, followup
 const native = {handleSignalingOffer: value => {offer=value}, handleSignalingMessage: value => {followup=value}}
 const creator = '27123456789@lid'
 bridge.processIncomingCall({tag:'call', attrs:{from:'27123456789:2@lid',platform:'android',version:'2.26.37.73'},content:[{tag:'offer',attrs:{'call-id':'synthetic','call-creator':creator},content:[]}]}, native, 'synthetic')
 for (let i=0;i<10&&!offer;i++) await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(errors, [])
 assert.equal(offer.peerJid, creator.replace("@lid", ":0@lid"))
 assert.equal(offer.peerPlatform, 'android')
 bridge.processIncomingCall({tag:'call', attrs:{from:'27123456789:2@lid'},content:[{tag:'relaylatency',attrs:{'call-id':'synthetic','call-creator':creator},content:[]}]}, native, 'synthetic')
 for (let i=0;i<10&&!followup;i++) await new Promise(resolve=>setImmediate(resolve))
 assert.equal(followup.peerJid, creator.replace("@lid", ":0@lid"))
 bridge.destroy()
})
