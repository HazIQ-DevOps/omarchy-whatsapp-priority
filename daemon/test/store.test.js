import assert from 'node:assert/strict'
import test from 'node:test'

import { Store } from '../lib/store.js'

test('conversation requests show the full 200-message local cache', () => {
  const store = new Store()
  const jid = 'person@s.whatsapp.net'
  store.messages.set(jid, Array.from({ length: 200 }, (_, index) => ({ id: String(index) })))
  assert.equal(store.messageList(jid).length, 200)
  assert.equal(store.messageList(jid, 500).length, 200)
  assert.equal(store.messageList(jid, 25).length, 25)
})

test('unread total excludes muted and archived chats but includes expired mutes', () => {
  const store = new Store()

  store.setUnread('active@s.whatsapp.net', 2)

  const muted = store.setUnread('muted@s.whatsapp.net', 4)
  muted.muteEndTime = -1
  muted.muted = true

  const archived = store.setUnread('archived@s.whatsapp.net', 8)
  archived.archived = true

  const expired = store.setUnread('expired@s.whatsapp.net', 16)
  expired.muteEndTime = 1
  expired.muted = true

  assert.equal(store.totalUnread(), 18)
})

test('attention chats include unread conversations beyond the recent list', () => {
  const store = new Store()
  const older = store.setUnread('older@s.whatsapp.net', 1)
  older.name = 'Priority contact'
  older.lastTs = 1
  for (let i = 0; i < 65; i++) {
    const chat = store.chat(`${i + 1000}@s.whatsapp.net`)
    chat.lastTs = i + 2
  }
  assert.equal(store.chatList(60).some((chat) => chat.jid === older.jid), false)
  assert.equal(store.attentionChats().some((chat) => chat.jid === older.jid), true)
})

test('inbox list keeps individuals available when groups dominate recent activity', () => {
  const store = new Store()
  const person = store.chat('person@s.whatsapp.net')
  person.lastTs = 1
  for (let i = 0; i < 75; i++) {
    const group = store.chat(`${i + 1000}@g.us`)
    group.lastTs = i + 2
    group.muted = true
  }
  const archived = store.chat('archived@s.whatsapp.net')
  archived.lastTs = 100
  archived.archived = true

  const rows = store.inboxChatList(40)
  assert.equal(rows[0].jid, person.jid)
  assert.equal(rows.filter((chat) => chat.isGroup).length, 40)
  assert.equal(rows.at(-1).jid, archived.jid)
})

test('alias merge preserves an active mute from the secondary chat', () => {
  const store = new Store()
  const lid = store.chat('123@lid')
  lid.muteEndTime = -1
  lid.muted = true

  store.alias('123@lid', '555@s.whatsapp.net')

  const canonical = store.chat('555@s.whatsapp.net')
  assert.equal(canonical.muteEndTime, -1)
  assert.equal(canonical.muted, true)
})

test('alias merge prefers Always mute over a shorter primary timed mute', () => {
  const store = new Store()
  const phone = store.chat('555@s.whatsapp.net')
  phone.muteEndTime = Math.floor(Date.now() / 1000) + 60
  phone.muted = true

  const lid = store.chat('123@lid')
  lid.muteEndTime = -1
  lid.muted = true

  store.alias('123@lid', '555@s.whatsapp.net')

  const canonical = store.chat('555@s.whatsapp.net')
  assert.equal(canonical.muteEndTime, -1)
  assert.equal(canonical.muted, true)
})

test('a mapped linked-device ID resolves to its phone JID for outgoing messages', () => {
  const store = new Store()
  store.alias('123456789@lid', '27123456789@s.whatsapp.net')
  assert.equal(store.canonicalJid('123456789@lid'), '27123456789@s.whatsapp.net')
  assert.equal(store.canonicalJid('27123456789@s.whatsapp.net'), '27123456789@s.whatsapp.net')
})
