import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { ensureLarkSkills } from './lark-skills.mjs'

const command = fileURLToPath(new URL(`../assets/lark-1.0.98/${process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli'}`, import.meta.url))
test('the pinned native CLI exports complete business skills and reference files', { skip: !existsSync(command) }, () => {
  const root = ensureLarkSkills(command, '1.0.98')
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  for (const name of ['lark-shared', 'lark-im', 'lark-doc', 'lark-calendar', 'lark-task']) {
    assert.ok(manifest.names.includes(name))
    assert.match(readFileSync(join(root, name, 'SKILL.md'), 'utf8'), /name: lark-/)
  }
  assert.ok(manifest.files.every(file => existsSync(join(root, file))))
  assert.ok(manifest.files.some(file => file.startsWith('lark-shared/references/')))
  assert.equal(dirname(root), dirname(command))
})
