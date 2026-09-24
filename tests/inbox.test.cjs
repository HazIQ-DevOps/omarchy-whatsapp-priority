const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')

const source = readFileSync(join(__dirname, '..', 'Model.js'), 'utf8')
const { inboxRows } = runInNewContext(
  source.replace(/^\.pragma library\s*/, '') + '\n;({ inboxRows })', {}
)

const chats = [
  { jid: 'group@g.us', name: 'Busy group', isGroup: true, muted: true },
  { jid: 'archived@s.whatsapp.net', name: 'Archived', archived: true },
  { jid: 'person@s.whatsapp.net', name: 'Alice' },
  { jid: 'other@g.us', name: 'Other group', isGroup: true },
]

test('main inbox shows individuals first and keeps groups collapsed', () => {
  const rows = inboxRows(chats, 'chats', '', false, 40, () => false)
  assert.deepEqual(Array.from(rows, row => row.jid || `groups:${row.groupCount}`), [
    'person@s.whatsapp.net', 'groups:2',
  ])
  const expanded = inboxRows(chats, 'chats', '', true, 40, () => false)
  assert.deepEqual(Array.from(expanded, row => row.jid || 'section'), [
    'person@s.whatsapp.net', 'section', 'group@g.us', 'other@g.us',
  ])
})

test('archived chats stay out of the main inbox and its search', () => {
  const rows = inboxRows(chats, 'chats', 'Archived', false, 40, () => false)
  assert.equal(rows.length, 0)
  const groups = inboxRows(chats, 'chats', 'Busy', false, 40, () => false)
  assert.equal(groups[0].jid, 'group@g.us')
  const forward = inboxRows(chats, 'forward', 'Archived', false, 40, () => false)
  assert.equal(forward[0].jid, 'archived@s.whatsapp.net')
})

test('hidden previews stay hidden until searching', () => {
  const dismissed = chat => chat.jid === 'person@s.whatsapp.net'
  const rows = inboxRows(chats, 'chats', '', false, 40, dismissed)
  assert.equal(rows[0].isGroupHeader, true)
  const matches = inboxRows(chats, 'chats', 'Alice', false, 40, dismissed)
  assert.equal(matches[0].jid, 'person@s.whatsapp.net')
})
