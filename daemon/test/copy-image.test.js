import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('copies a cached image with its MIME type and rejects files outside the media cache',
  { skip: spawnSync('file', ['--version']).status !== 0 }, () => {
    const runtime = mkdtempSync(join(tmpdir(), 'wa-copy-image-'))
    const helper = fileURLToPath(new URL('../../bin/omarchy-whatsapp-copy-image', import.meta.url))
    const mediaDir = join(runtime, 'media')
    const bin = join(runtime, 'bin')
    mkdirSync(mediaDir)
    mkdirSync(bin)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    const image = join(mediaDir, 'message.png')
    writeFileSync(image, png)
    writeFileSync(join(bin, 'wl-copy'), '#!/bin/sh\nprintf "%s\\n" "$*" > "$COPY_ARGS"\ncat > "$COPY_DATA"\n', { mode: 0o755 })
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      OMARCHY_WHATSAPP_MEDIA: mediaDir,
      COPY_ARGS: join(runtime, 'copy-args'),
      COPY_DATA: join(runtime, 'copy-data')
    }
    try {
      execFileSync('bash', [helper, image], { env })
      assert.equal(readFileSync(env.COPY_ARGS, 'utf8').trim(), '--type image/png')
      assert.deepEqual(readFileSync(env.COPY_DATA), png)
      const outside = join(runtime, 'outside.png')
      writeFileSync(outside, png)
      assert.notEqual(spawnSync('bash', [helper, outside], { env }).status, 0)
      const link = join(mediaDir, 'link.png')
      symlinkSync(image, link)
      assert.notEqual(spawnSync('bash', [helper, link], { env }).status, 0)
    } finally {
      rmSync(runtime, { recursive: true, force: true })
    }
  })
