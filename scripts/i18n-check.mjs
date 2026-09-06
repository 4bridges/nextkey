/**
 * Which translations are missing, and which have gone stale?
 *
 * The site carries 203 keys in nine languages. Adding a sentence to try.js adds
 * nine obligations, and forgetting one costs a visitor exactly one sentence of
 * English in the middle of their own language — invisible from a desk where
 * everything is English anyway.
 *
 * The worse failure is the one this file exists for. Changing the *English* of
 * an existing key leaves every translation in place and silently wrong: the
 * German still says "two records" while the page now shows three. Nothing
 * breaks, nothing warns, and it is not a missing string — it is a confident
 * false one, which is worse than English.
 *
 * So the English fallbacks are stamped. web/i18n.stamp.json records a short
 * hash of each key's English text at the time the translations were last known
 * good; when the English changes, the stamp no longer matches and the key is
 * reported as stale rather than complete.
 *
 *   node scripts/i18n-check.mjs           report
 *   node scripts/i18n-check.mjs --stamp   accept the current English as the
 *                                         baseline (only after translating)
 *
 * Reads no chain and writes nothing unless --stamp is given.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEB = join(ROOT, 'web')
const STAMP = join(WEB, 'i18n.stamp.json')

const PAGES = ['index.html', 'demo.html', 'try.html']
const SOURCES = ['src/app.js', 'src/try.js']

const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

// ─── Which keys does the site actually use? ────────────────────────────────
// Two spellings, because the page has two kinds of string: markup that exists
// before anything happens carries data-i18n, and text built after a button is
// pressed looks itself up through t('key', 'English fallback').
const used = new Map()   // key → English source text, where we can see it

for (const page of PAGES) {
  const html = readFileSync(join(WEB, page), 'utf8')
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) {
    if (!used.has(m[1])) used.set(m[1], null)   // English lives in the element
  }
}

for (const file of SOURCES) {
  const js = readFileSync(join(WEB, file), 'utf8')
  // t('key', 'English') — the fallback may be a template literal and may run
  // over several lines, so the closing quote is matched lazily against the
  // quote that opened it.
  for (const m of js.matchAll(/\bt\(\s*'([^']+)'\s*,\s*(['"`])([\s\S]*?)\2\s*\)/g)) {
    used.set(m[1], m[3])
  }
}

// ─── What do the translations have? ────────────────────────────────────────
// i18n.js assigns one object to window.I18N. Evaluating it in a Function with a
// stand-in window is enough, and avoids depending on its exact formatting.
const i18nSrc = readFileSync(join(WEB, 'i18n.js'), 'utf8')
const scope = { window: {} }
new Function('window', i18nSrc)(scope.window)
const dicts = scope.window.I18N ?? {}
const langs = Object.keys(dicts).sort()

if (!langs.length) {
  console.error(`\n  web/i18n.js defined no translations — did its shape change?\n`)
  process.exit(1)
}

// ─── Stale English ─────────────────────────────────────────────────────────
const stamp = existsSync(STAMP) ? JSON.parse(readFileSync(STAMP, 'utf8')) : {}
const stale = []
const unstamped = []
for (const [key, english] of used) {
  if (english === null) continue          // English is in the HTML, not here
  const now = digest(english)
  if (!(key in stamp)) unstamped.push(key)
  else if (stamp[key] !== now) stale.push(key)
}

// ─── Report ────────────────────────────────────────────────────────────────
if (process.argv.includes('--stamp')) {
  const next = {}
  for (const [key, english] of used) if (english !== null) next[key] = digest(english)
  writeFileSync(STAMP, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`\n  Stamped ${Object.keys(next).length} English fallbacks as the baseline.`)
  console.log(`  Do this only after the translations have caught up — it is a`)
  console.log(`  promise about them, not a record of them.\n`)
  process.exit(0)
}

console.log(`\n  ${used.size} keys in use · ${langs.length} translated languages\n`)

let missingTotal = 0
for (const lang of langs) {
  const missing = [...used.keys()].filter((k) => !(k in dicts[lang]))
  missingTotal += missing.length
  const orphans = Object.keys(dicts[lang]).filter((k) => !used.has(k))
  const bits = []
  if (missing.length) bits.push(`${missing.length} missing`)
  if (orphans.length) bits.push(`${orphans.length} unused`)
  console.log(`  ${lang}   ${bits.length ? bits.join(', ') : 'complete'}`)
  for (const k of missing) console.log(`         missing  ${k}`)
}

if (stale.length) {
  console.log(`\n  Stale — the English changed since these were last translated:\n`)
  for (const k of stale) console.log(`    ${k}`)
  console.log(`
  These are not missing. Every language still has a string for them, and that
  string now describes something the page no longer does. A wrong translation
  outranks a missing one: a missing key falls back to English and is merely
  untranslated, while a stale one is confidently false.`)
}

if (unstamped.length && Object.keys(stamp).length) {
  console.log(`\n  New since the last stamp (${unstamped.length}): ${unstamped.slice(0, 8).join(', ')}${unstamped.length > 8 ? ' …' : ''}`)
}

console.log()
if (missingTotal || stale.length) {
  console.log(`  ${missingTotal} missing, ${stale.length} stale.\n`)
  process.exitCode = 1
} else {
  console.log(`  All ${used.size} keys present in all ${langs.length} languages.\n`)
}
