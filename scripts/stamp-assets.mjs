/**
 * Stamp each page's script tags with a hash of the file they load.
 *
 * The failure this prevents: `demo.html` and `demo.js` are two files on a static
 * host, uploaded separately and cached separately. When they drift, the newer
 * script looks for elements the older page does not have, and a judge on a
 * phone gets `Cannot set properties of null` — on a page whose entire subject
 * is cryptography, which is the worst possible place to show an error that
 * looks like a broken cipher.
 *
 * Server headers are the textbook answer and we ship an `.htaccess` for it, but
 * it depends on `mod_headers` being enabled, and when it is not, it fails
 * silently. This does not depend on the server at all:
 *
 *   <script src="./demo.js?v=3f9a1c7e">
 *
 * Change one byte of `demo.js` and that becomes a URL the browser has never seen,
 * so it fetches it — no revalidation, no expiry, nothing to configure. Change
 * nothing and the URL is identical, so the cached copy is used and the visitor
 * pays no bandwidth for a deploy that did not touch it.
 *
 * The version is a hash rather than a number somebody bumps, because a number
 * somebody bumps is a number somebody forgets at eleven at night, and the
 * symptom appears on a device they are not holding.
 *
 *   node scripts/stamp-assets.mjs             stamp, and say what changed
 *   node scripts/stamp-assets.mjs --check     fail if anything is unstamped
 *
 * Run it after building the bundles and before uploading. `--check` is for
 * making that non-optional later, in a deploy script or a hook.
 *
 * Note what this does *not* fix: a stale `demo.html` still in a browser's cache
 * from before any of this existed. Nothing served can fix that, because the
 * browser never asks. One visit to a URL it has not seen — `demo.html?v=3` —
 * clears it for good, and the page's own version check prints exactly that link
 * when it detects the mismatch.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
const PAGES = ['index.html', 'poc.html', 'demo.html', 'blog.html', 'explorer.html']
const check = process.argv.includes('--check')

const hash = (file) =>
  createHash('sha256').update(readFileSync(join(WEB, file))).digest('hex').slice(0, 8)

let changed = 0
let unstamped = 0

for (const page of PAGES) {
  const path = join(WEB, page)
  const before = readFileSync(path, 'utf8')

  // Local scripts only: `./name.js`, with or without a version already on it.
  // A CDN URL or an absolute one is somebody else's cache to worry about.
  const after = before.replace(
    /src="\.\/([A-Za-z0-9._-]+\.js)(\?v=[0-9a-f]+)?"/g,
    (whole, file, existing) => {
      let v
      try { v = hash(file) } catch {
        console.error(`  ✗  ${page} loads ./${file}, which is not in web/`)
        process.exitCode = 1
        return whole
      }
      const wanted = `src="./${file}?v=${v}"`
      if (whole !== wanted) {
        unstamped++
        console.log(`  ${page.padEnd(12)} ${file.padEnd(12)} ${existing ? existing.slice(3) : '(none)'} → ${v}`)
      }
      return wanted
    })

  if (after !== before) {
    changed++
    if (!check) writeFileSync(path, after)
  }
}

if (check) {
  console.log(unstamped
    ? `\n  ${unstamped} script tag${unstamped > 1 ? 's are' : ' is'} out of date. Run it without --check.\n`
    : `\n  Every script tag matches the file it loads.\n`)
  if (unstamped) process.exitCode = 1
} else {
  console.log(changed
    ? `\n  Stamped ${changed} page${changed > 1 ? 's' : ''}. Upload the pages together with the scripts.\n`
    : `\n  Nothing to do — every script tag already matches its file.\n`)
}
