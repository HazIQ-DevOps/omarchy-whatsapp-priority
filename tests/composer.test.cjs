const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')

const source = readFileSync(join(__dirname, '..', 'Model.js'), 'utf8')
const model = runInNewContext(
  source.replace(/^\.pragma library\s*/, '') + '\n;({ matchesChatSearch, expandEmoticons })', {}
)

test('contact search matches names, group sender, and phone number', () => {
  const chat = { name: 'Marnus Viljoen', lastSender: 'Ryno', jid: '27123456789@s.whatsapp.net' }
  assert.equal(model.matchesChatSearch(chat, '  marnus  '), true)
  assert.equal(model.matchesChatSearch(chat, 'RYNO'), true)
  assert.equal(model.matchesChatSearch(chat, '12345'), true)
  assert.equal(model.matchesChatSearch(chat, 'nobody'), false)
})

test('typed emoticons become emoji without changing longer words or links', () => {
  assert.equal(model.expandEmoticons('Hi :) :D LOL <3'), 'Hi 🙂 😄 😂 ❤️')
  assert.equal(model.expandEmoticons('sad :( wink ;) :p'), 'sad 🙁 wink 😉 😛')
  assert.equal(model.expandEmoticons('lollipop https://example.com/lol'), 'lollipop https://example.com/lol')
  assert.equal(model.expandEmoticons('LOL!'), '😂!')
})
