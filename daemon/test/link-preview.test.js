import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWAMessageContent } from 'baileys'
import { getLinkPreview } from 'link-preview-js'

test('the installed preview provider lets Baileys attach link metadata to text', async () => {
  assert.equal(typeof getLinkPreview, 'function')
  const content = await generateWAMessageContent(
    { text: 'Watch https://www.youtube.com/watch?v=example' },
    { getUrlInfo: async (url) => ({
      'matched-text': url,
      title: 'Example video',
      description: 'A preview',
      jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    }) }
  )
  assert.equal(content.extendedTextMessage.title, 'Example video')
  assert.equal(content.extendedTextMessage.matchedText, 'https://www.youtube.com/watch?v=example')
  assert.equal(content.extendedTextMessage.description, 'A preview')
})
