import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MAX_OUTGOING_IMAGE_BYTES, validateOutgoingImage } from '../lib/outgoing-image.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

test('accepts a private pasted image and rejects wrong formats or locations', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'wa-paste-test-'))
  try {
    const pasteDir = join(runtime, 'omarchy-whatsapp-paste')
    mkdirSync(pasteDir)
    const imagePath = join(pasteDir, 'paste.example')
    writeFileSync(imagePath, png, { mode: 0o600 })
    assert.deepEqual(validateOutgoingImage(imagePath, 'image/png', runtime), {
      path: imagePath, mimetype: 'image/png', bytes: png.length
    })
    assert.throws(() => validateOutgoingImage(imagePath, 'image/jpeg', runtime), /format/)

    const outside = join(runtime, 'outside.png')
    writeFileSync(outside, png)
    assert.throws(() => validateOutgoingImage(outside, 'image/png', runtime), /private pasted file/)

    const link = join(pasteDir, 'paste.link')
    symlinkSync(imagePath, link)
    assert.throws(() => validateOutgoingImage(link, 'image/png', runtime), /private pasted file/)

    truncateSync(imagePath, MAX_OUTGOING_IMAGE_BYTES + 1)
    assert.throws(() => validateOutgoingImage(imagePath, 'image/png', runtime), /12 MB limit/)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})
