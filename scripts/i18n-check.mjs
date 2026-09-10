/**
 * Which translations are missing, and which have gone stale?
 *
 * The site carries 203 keys in nine languages. Adding a sentence to send.js adds
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

// Every page that carries translatable text, and every bundle that builds a
// string after a button is pressed. Two pages were missing here for a day:
// blog.html and explorer.html shipped with their whole vocabulary outside the
// check, so nine languages fell back to English and nothing went red. A
// checker that does not know about a file cannot report it.
const PAGES = ['index.html', 'poc.html', 'id.html', 'send.html', 'sandbox.html', 'blog.html', 'explorer.html',
               'donate.html', 'imprint.html', 'privacy.html']
const SOURCES = ['src/app.js', 'src/send.js', 'src/sandbox.js', 'src/blog.js',
                 'src/explorer.js', 'src/donate.js']

const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

// ─── Which keys does the site actually use? ────────────────────────────────
// Two spellings, because the page has two kinds of string: markup that exists
// before anything happens carries data-i18n, and text built after a button is
// pressed looks itself up through t('key', 'English fallback').
const used = new Map()   // key → English source text, where we can see it

// Which spelling a key was declared with. `data-i18n` sets textContent and
// `data-i18n-html` sets innerHTML, so a translation carrying markup under the
// first one is shown to the reader as characters — `<span class="mono">` in the
// middle of a sentence, in every language but English, where the markup is real
// because it is still sitting in the page.
const asText = new Set()
const asHtml = new Set()

// All four spellings, not one. The overlay translates data-i18n (text),
// data-i18n-html (markup), data-i18n-ph (a placeholder) and data-i18n-title (a
// tooltip) — this loop knew only the first, so 46 keys were outside the check
// while it reported everything present: the whole FAQ, the blog's form, and the
// legal notices. Five of them turned out to be untranslated in all nine
// languages and had been shipping English to every reader. A checker that does
// not know a spelling cannot report it, which is the same lesson as the two
// pages that were once missing from PAGES, one line further up.
/**
 * The English of a markup key is the element's own content, and until today
 * this file never read it.
 *
 * It recorded `null` — "English lives in the element" — and everything
 * downstream skipped those keys. So the staleness check, the one this file
 * exists for, applied to 338 of 647 keys: the ones written as `t('key',
 * 'English')` inside a bundle. Every sentence on every page was outside it.
 * Change the English of a paragraph and nine translations stay in place, now
 * describing something the page no longer does — silently, because the checker
 * could not see the thing it was meant to compare.
 *
 * That is the same shape as the two failures recorded above: a checker that
 * does not know a file cannot report it, a checker that does not know a
 * spelling cannot report it, and a checker that cannot see the English cannot
 * tell you the English changed.
 *
 * Whitespace is normalised before hashing, because the markup is re-indented by
 * hand and a re-wrapped paragraph is not a changed sentence. For `data-i18n`
 * the tags are stripped, since the overlay replaces `textContent` and the tags
 * were never part of what a translator was given; for `data-i18n-html` they are
 * kept, because there they were.
 */
const flatten = (x) => x.replace(/\s+/g, ' ').trim()
const stripTags = (x) => flatten(x.replace(/<[^>]*>/g, ''))

for (const page of PAGES) {
  const html = readFileSync(join(WEB, page), 'utf8')

  // Attribute-valued keys: the English is another attribute on the same tag,
  // and the element may be void — an <input> has no closing tag to look for.
  for (const m of html.matchAll(/<[a-z0-9]+\b([^>]*)>/gi)) {
    const attrs = m[1]
    for (const [, kind, key] of attrs.matchAll(/\bdata-i18n-(ph|title)="([^"]+)"/g)) {
      const src = attrs.match(kind === 'ph' ? /\bplaceholder="([^"]*)"/ : /\btitle="([^"]*)"/)
      used.set(key, src ? flatten(src[1]) : null)
    }
  }

  // Content-valued keys: the English is between the tags. Matched lazily to the
  // first closing tag of the same name — these are leaf elements (p, h2, dd,
  // summary, span), and one nested inside another of its own kind would read
  // short rather than wrong.
  for (const m of html.matchAll(/<([a-z0-9]+)\b([^>]*?)\bdata-i18n(-html)?="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const [, , , isHtml, key, , content] = m
    used.set(key, isHtml ? flatten(content) : stripTags(content))
    ;(isHtml ? asHtml : asText).add(key)
  }

  // Whatever the two passes above did not reach is still in use, or a key could
  // vanish from every language unnoticed. Recorded without English, which is
  // what `null` has always meant here.
  for (const m of html.matchAll(/data-i18n(?:-html|-ph|-title)?="([^"]+)"/g)) {
    if (!used.has(m[1])) used.set(m[1], null)
  }

  // A fifth spelling, and the first one whose absence was about to cost
  // something. The page title and the meta description are not elements the
  // overlay can address by attribute — they are set by the small inline script
  // at the foot of every page, as `base['meta.title']` and `pick('meta.title')`.
  // Four keys live only there: meta.title and meta.desc on the landing page,
  // d.meta.title and d.meta.desc on the live view and the two legal pages.
  //
  // This pass exists because they were reported as unused and very nearly
  // deleted. Deleting them would not have broken a test or thrown an error: it
  // would have left every page's title and description in English in nine
  // languages, which nobody reading English could ever notice. The same lesson
  // as the four spellings above and the two missing pages above that, arriving
  // for the fourth time — and the first time where the checker's mistake was
  // an instruction to remove something that works.
  for (const m of html.matchAll(/\b(?:base|pick)\(?\[?\s*'([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)'/g)) {
    if (!used.has(m[1])) used.set(m[1], null)
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

  // A third spelling: `['key', 'English']`, handed to `t(...pair)` later. The
  // playground's MODE_TEXT is written that way, so the whole message-side
  // vocabulary — the headings and leads behind /demo/message — sat outside this
  // check and shipped English to all nine languages without once being reported
  // missing. Nobody could notice from a desk, because a desk is already English.
  //
  // The key must contain a dot, which is what an i18n key looks like here and
  // an ordinary pair of strings does not. And the pair must be a pair: the
  // closing bracket has to follow the second string directly.
  //
  // The first version wrote the value as a lazy `[\s\S]*?` closed by a
  // backreference, and that reached straight across a longer array —
  // `['vault.nextkey.eth', 'nextkeyv2.eth', 'anna…', 'bob…']`, a list of ENS
  // names in the explorer, came back as a translation key with the remaining
  // three names as its English. It was reported as missing in all nine
  // languages, which is how it was caught in the first run. Excluding the
  // quote from the value is what stops a two-element pattern from spanning a
  // four-element list.
  const PAIR = /\[\s*'([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)'\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`)\s*\]/g
  for (const m of js.matchAll(PAIR)) used.set(m[1], m[2] ?? m[3] ?? m[4])
}

// ─── What do the translations have? ────────────────────────────────────────
// i18n.js assigns one object to window.I18N. Evaluating it in a Function with a
// stand-in window is enough, and avoids depending on its exact formatting.
const i18nSrc = readFileSync(join(WEB, 'i18n.js'), 'utf8')
const scope = { window: {} }
new Function('window', i18nSrc)(scope.window)
const dicts = scope.window.I18N ?? {}
const langs = Object.keys(dicts).sort()
const langs0 = langs

if (!langs.length) {
  console.error(`\n  web/i18n.js defined no translations — did its shape change?\n`)
  process.exit(1)
}

// ─── Markup in a text-only key ─────────────────────────────────────────────
//
// Found the way these things are found: by looking at the page. The Sandbox
// shipped `<span class="mono">?api=https://…</span>` as visible characters in
// all nine languages, because the English fallback carries markup that is part
// of the page and the translations carry the same markup as a string.
//
// Two of the nine keys it turned up had been wrong for weeks — t.own.p and
// t.s4.remote, on the playground — and nothing reported them, because being
// present and being correct are different questions and this file only asked
// the first. It asks both now.
const markup = /<[a-z][^>]*>/i
const asMarkup = []
for (const key of asText) {
  if (asHtml.has(key)) continue          // declared both ways somewhere; the html one wins
  const langs = langs0.filter((l) => typeof dicts[l][key] === 'string' && markup.test(dicts[l][key]))
  if (langs.length) asMarkup.push([key, langs])
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

// Unstamped keys are their own answer, not a footnote. "0 stale" reads as "all
// the translations still match their English" and means no such thing while a
// third of the keys have no baseline to compare against — which was exactly the
// state this file was in until today, quietly, for its whole life. A checker
// that cannot judge something has to say so, in the same breath as its verdict.
if (asMarkup.length) {
  console.log(`\n  Markup under a text-only key (${asMarkup.length}) — shown to the reader as characters:\n`)
  for (const [key, langs] of asMarkup) console.log(`    ${key}  ·  ${langs.join(' ')}`)
  console.log(`
  These translations contain tags, and \`data-i18n\` writes textContent, so the
  tags arrive on screen as text. English is unaffected and always will be — its
  markup is still in the page — which is why this can ship unnoticed for weeks.
  Either declare the element \`data-i18n-html\`, or take the markup out of the
  translations.`)
}

if (unstamped.length) {
  console.log(`\n  Unstamped (${unstamped.length}) — no baseline, so staleness cannot be judged for these:\n`)
  console.log(`    ${unstamped.slice(0, 12).join(', ')}${unstamped.length > 12 ? `, … and ${unstamped.length - 12} more` : ''}`)
  console.log(`
  Either they are new since the last stamp, or nobody has ever promised their
  translations match. Run --stamp once the translations have caught up. That is
  a promise about them, not a record of them: it freezes the current English as
  the baseline, and a translation that was already wrong stays wrong and stops
  being reported.`)
}

const judged = used.size - unstamped.length
console.log()
if (missingTotal || stale.length || asMarkup.length) {
  console.log(`  ${missingTotal} missing, ${stale.length} stale, ${asMarkup.length} with stray markup, ${unstamped.length} unjudged.\n`)
  process.exitCode = 1
} else {
  console.log(`  All ${used.size} keys present in all ${langs.length} languages.`)
  console.log(unstamped.length
    ? `  ${judged} of them checked for staleness; ${unstamped.length} have no baseline.\n`
    : `  All of them checked for staleness against a stamped baseline.\n`)
}
