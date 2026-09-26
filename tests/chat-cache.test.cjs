const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')

const source = readFileSync(join(__dirname, '..', 'Model.js'), 'utf8')
const { searchChatMessages, cachedGalleryItems, documentKind } = runInNewContext(
  source.replace(/^\.pragma library\s*/, '') + '\n;({ searchChatMessages, cachedGalleryItems, documentKind })', {}
)

const messages = [
  { id: 'one', text: 'Dinner tonight?', ts: 1 },
  { id: 'two', text: 'Dinner photo', imagePath: '/cache/two.jpg', ts: 2 },
  { id: 'three', text: 'Dinner plans', deleted: true, ts: 3 },
  { id: 'four', text: 'Clip', videoPath: '/cache/four.mp4', ts: 4 },
  { id: 'five', type: 'documentMessage', cachePath: '/cache/five.pdf', ts: 5 },
  { id: 'six', type: 'audioMessage', audioPath: '/cache/six.ogg', ts: 6 },
  { id: 'seven', text: 'not downloaded', type: 'imageMessage', ts: 7 },
]

test('chat search matches cached message text without including deleted messages', () => {
  assert.deepEqual(Array.from(searchChatMessages(messages, 'DINNER'), message => message.id), ['two', 'one'])
  assert.deepEqual(Array.from(searchChatMessages(messages, ''), message => message.id), [])
})

test('gallery shows only files already cached for the open chat', () => {
  assert.deepEqual(Array.from(cachedGalleryItems(messages, 'media'), message => message.id), ['four', 'two'])
  assert.deepEqual(Array.from(cachedGalleryItems(messages, 'documents'), message => message.id), ['five'])
  assert.deepEqual(Array.from(cachedGalleryItems(messages, 'audio'), message => message.id), ['six'])
})

test('document tiles distinguish archives and common file types', () => {
  assert.equal(documentKind('backup.tar.gz').label, 'Archive')
  assert.equal(documentKind('invoice.pdf').label, 'PDF')
  assert.equal(documentKind('budget.xlsx').label, 'Spreadsheet')
  assert.equal(documentKind('unknown.blob').label, 'BLOB')
})
