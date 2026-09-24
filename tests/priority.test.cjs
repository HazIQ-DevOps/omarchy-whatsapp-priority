const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')

const source = readFileSync(join(__dirname, '..', 'Model.js'), 'utf8')
const model = runInNewContext(
  source.replace(/^\.pragma library\s*/, '') + '\n;({ hasPriorityUnread })', {}
)

test('priority name matches one unread contact, ignoring case and whitespace', () => {
  const chats = [
    { name: '  Alice   Smith ', jid: '1@s.whatsapp.net', unread: 2 },
    { name: 'Alice', jid: '2@s.whatsapp.net', unread: 4 },
  ]
  assert.equal(model.hasPriorityUnread(chats, 'alice smith'), true)
  assert.equal(model.hasPriorityUnread(chats, 'bob'), false)
  assert.equal(model.hasPriorityUnread(chats, ''), false)
})

test('read chats do not trigger red and group sender can trigger it', () => {
  assert.equal(model.hasPriorityUnread([
    { name: 'Alice', jid: '1@s.whatsapp.net', unread: 0 },
  ], 'Alice'), false)
  assert.equal(model.hasPriorityUnread([
    { name: 'Family', isGroup: true, lastSender: 'Alice', unread: 3, lastFromMe: false },
  ], 'alice'), true)
  assert.equal(model.hasPriorityUnread([
    { name: 'Family', isGroup: true, lastSender: 'Alice', unread: 3, lastFromMe: true },
  ], 'Alice'), false)
})
