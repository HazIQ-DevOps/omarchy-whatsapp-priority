const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')

const source = readFileSync(join(__dirname, '..', 'Model.js'), 'utf8')
const { inboxRows, hoverSections, unreadMessageCount } = runInNewContext(
  source.replace(/^\.pragma library\s*/, '') + '\n;({ inboxRows, hoverSections, unreadMessageCount })', {}
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

test('hover preview separates personal chats and groups and excludes archived chats', () => {
  const sections = hoverSections(chats, 5, () => false)
  assert.deepEqual(Array.from(sections.individuals, chat => chat.jid), ['person@s.whatsapp.net'])
  assert.deepEqual(Array.from(sections.groups, chat => chat.jid), ['group@g.us', 'other@g.us'])
})

test('busy muted groups do not displace individual hover cards', () => {
  const groupOnlyUnread = [
    { jid: 'busy@g.us', isGroup: true, muted: true, unread: 8 },
    { jid: 'friend@s.whatsapp.net', isGroup: false, unread: 0 },
  ]
  const sections = hoverSections(groupOnlyUnread, 5, () => false)
  assert.equal(sections.individuals[0].jid, 'friend@s.whatsapp.net')
  assert.equal(sections.groups[0].jid, 'busy@g.us')
})

test('both group headings count unread messages in visible groups', () => {
  const withUnread = [
    { jid: 'friend@s.whatsapp.net', unread: 4 },
    { jid: 'family@g.us', isGroup: true, unread: 2 },
    { jid: 'busy@g.us', isGroup: true, muted: true, unread: 3 },
    { jid: 'archived@g.us', isGroup: true, archived: true, unread: 8 },
    { jid: 'hidden@g.us', isGroup: true, unread: 7 },
  ]
  const isDismissed = chat => chat.jid === 'hidden@g.us'
  const header = inboxRows(withUnread, 'chats', '', false, 40, isDismissed)
    .find(row => row.isGroupHeader)
  assert.equal(header.groupCount, 2)
  assert.equal(header.groupUnreadCount, 5)
  const hover = hoverSections(withUnread, 5, isDismissed)
  assert.equal(unreadMessageCount(hover.groups), 5)
})
