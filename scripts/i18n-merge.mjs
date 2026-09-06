/**
 * Fold web/i18n.patch.json into web/i18n.js.
 *
 * i18n.js is 250 kB of nine languages and nobody should be editing it by hand
 * in nine places to add one sentence — that is how a language quietly ends up
 * one string short. New strings are written once into i18n.patch.json, shaped
 * { lang: { key: text } }, and merged here.
 *
 *   node scripts/i18n-merge.mjs            merge, then report what changed
 *   node scripts/i18n-merge.mjs --dry-run  say what would change, write nothing
 *
 * The file is re-emitted rather than patched textually: the object is evaluated,
 * merged, and printed back sorted, which is the shape it already has. The header
 * comment above `window.I18N` is preserved verbatim, because it explains why
 * English is not in this file and that reasoning is worth more than the data.
 *
 * An existing translation is overwritten only with --force. Silently replacing
 * one would make this tool capable of losing work, and the usual reason a key is
 * already present is that the patch file is stale.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
const TARGET = join(WEB, 'i18n.js')
const PATCH = join(WEB, 'i18n.patch.json')

const dry = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')

if (!existsSync(PATCH)) {
  console.error(`\n  No web/i18n.patch.json — nothing to merge.\n`)
  process.exit(1)
}

const source = readFileSync(TARGET, 'utf8')
const marker = 'window.I18N = {'
const at = source.indexOf(marker)
if (at === -1) {
  console.error(`\n  web/i18n.js does not assign window.I18N in the expected shape.`)
  console.error(`  Refusing to rewrite a file this tool does not understand.\n`)
  process.exit(1)
}

const header = source.slice(0, at)
const scope = {}
new Function('window', source)(scope)
const dicts = scope.I18N

const patch = JSON.parse(readFileSync(PATCH, 'utf8'))

const added = []
const skipped = []
const unknown = []

for (const [lang, entries] of Object.entries(patch)) {
  if (!dicts[lang]) { unknown.push(lang); continue }
  for (const [key, text] of Object.entries(entries)) {
    if (key in dicts[lang] && !force) { skipped.push(`${lang}·${key}`); continue }
    dicts[lang][key] = text
    added.push(`${lang}·${key}`)
  }
}

if (unknown.length) {
  console.error(`\n  The patch names languages i18n.js does not have: ${unknown.join(', ')}`)
  console.error(`  Nothing was written — a typo here would create a language nobody serves.\n`)
  process.exit(1)
}

// Sorted, two-space indent, one key per line: the shape the file already has,
// so the diff shows the new strings and nothing else.
const body = Object.keys(dicts).sort().map((lang) => {
  const entries = Object.keys(dicts[lang]).sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(dicts[lang][k])}`)
    .join(',\n')
  return ` ${JSON.stringify(lang)}: {\n${entries}\n }`
}).join(',\n')

const out = `${header}${marker}\n${body}\n}\n`

console.log(`\n  ${added.length} strings ${dry ? 'would be added' : 'added'}`)
if (skipped.length) {
  console.log(`  ${skipped.length} already present and left alone (use --force to replace)`)
}
for (const lang of Object.keys(dicts).sort()) {
  const n = added.filter((a) => a.startsWith(`${lang}·`)).length
  if (n) console.log(`    ${lang}  +${n}`)
}

if (dry) {
  console.log(`\n  Dry run — web/i18n.js untouched.\n`)
} else {
  writeFileSync(TARGET, out)
  console.log(`
  Written. Now check nothing is missing and stamp the English:
    node scripts/i18n-check.mjs
    node scripts/i18n-check.mjs --stamp
    npx esbuild web/src/try.js --bundle --format=esm --minify --target=es2022 --outfile=web/try.js
`)
}
