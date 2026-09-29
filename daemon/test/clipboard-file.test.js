import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { MAX_PASTED_FILE_BYTES, pathFromClipboardUris, stageClipboardFile } from '../lib/clipboard-file.js'
import { validateOutgoingFile } from '../lib/outgoing-file.js'

test('stages a file-manager clipboard URI and validates the outgoing document', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'wa-file-test-'))
  try {
    const source = join(runtime, 'my notes #1.txt')
    writeFileSync(source, 'attached file contents')
    const uri = pathToFileURL(source).href
    assert.equal(pathFromClipboardUris(`copy\n${uri}\r\n`), source)
    const staged = stageClipboardFile(source, runtime, () => 'text/plain')
    assert.equal(staged.kind, 'file')
    assert.equal(staged.name, 'my notes #1.txt')
    assert.equal(readFileSync(staged.path, 'utf8'), 'attached file contents')
    assert.deepEqual(validateOutgoingFile(staged.path, staged.mime, staged.name, runtime), {
      path: staged.path, mimetype: 'text/plain', fileName: staged.name, bytes: 22
    })
    assert.throws(() => validateOutgoingFile(source, 'text/plain', 'notes.txt', runtime), /private pasted file/)
    const link = join(runtime, 'omarchy-whatsapp-paste', 'paste.link')
    symlinkSync(staged.path, link)
    assert.throws(() => validateOutgoingFile(link, 'text/plain', 'notes.txt', runtime), /private pasted file/)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})

test('rejects remote, multiple, missing, and oversized files', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'wa-file-test-'))
  try {
    assert.equal(pathFromClipboardUris('https://example.com/a.txt'), '')
    assert.throws(() => pathFromClipboardUris('file://remote.example/a.txt'), /local files/)
    assert.throws(() => pathFromClipboardUris('file:///a\nfile:///b'), /one file/)
    assert.throws(() => stageClipboardFile(join(runtime, 'missing'), runtime), /ENOENT/)
    const huge = join(runtime, 'huge.bin')
    writeFileSync(huge, '')
    truncateSync(huge, MAX_PASTED_FILE_BYTES + 1)
    assert.throws(() => stageClipboardFile(huge, runtime), /200 MB/)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})

test('clipboard shell helper recognizes a copied file and cleans its staged copy', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'wa-clipboard-test-'))
  try {
    const source = join(runtime, 'report.pdf')
    writeFileSync(source, '%PDF-1.7\nexample')
    const bin = join(runtime, 'bin')
    mkdirSync(bin)
    const fakePaste = join(bin, 'wl-paste')
    writeFileSync(fakePaste, '#!/bin/sh\nif [ "$1" = "--list-types" ]; then printf "text/uri-list\\ntext/plain\\n"; else cat "$TEST_CLIPBOARD"; fi\n')
    chmodSync(fakePaste, 0o755)
    const clipboard = join(runtime, 'clipboard')
    writeFileSync(clipboard, pathToFileURL(source).href + '\n')
    const helper = join(import.meta.dirname, '../../bin/omarchy-whatsapp-paste-image')
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_CLIPBOARD: clipboard,
      XDG_RUNTIME_DIR: runtime, OMARCHY_WHATSAPP_NODE: process.execPath }
    const result = JSON.parse(execFileSync('bash', [helper, 'capture'], { env, encoding: 'utf8' }))
    assert.equal(result.kind, 'file')
    assert.equal(result.name, 'report.pdf')
    assert.equal(readFileSync(result.path, 'utf8'), '%PDF-1.7\nexample')
    execFileSync('bash', [helper, 'delete', result.path], { env })
    assert.throws(() => readFileSync(result.path), /ENOENT/)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})
