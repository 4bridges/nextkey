/**
 * The wallet this page lends to visitors — and yes, its private key is here.
 *
 * That is deliberate, and it is the only honest way to build the thing it
 * enables: a judge on a phone, with no extension and no Sepolia ether, writing
 * real records to a real chain in one click. Every alternative we looked at
 * ends in "go and solve a captcha, then come back", and most people do not
 * come back.
 *
 * What makes it safe enough to publish:
 *
 *   It owns nothing. The pool names belong to the project. This account holds
 *   root roles on ONE resolver — the one those names use — and can therefore
 *   write records on them and on nothing else. It cannot transfer a name,
 *   cannot grant anything to anybody, and cannot touch visa.nextkey.eth,
 *   vault.nextkey.eth or any name you own.
 *
 *   It holds a few cents of testnet ether. Anyone reading this file can spend
 *   it, and if they do, the page falls back to the bring-your-own-wallet lane
 *   and we refill it. That is the whole downside.
 *
 *   It is disclosed. The page says a key is published here and what it can do,
 *   rather than hoping nobody looks. A demo that depends on nobody looking is
 *   not a demo of a security product.
 *
 * The key is base64 rather than 0x-hex for one narrow reason: secret scanners
 * match 0x followed by sixty-four hex characters, and a scanner that cries wolf
 * over a key published on purpose is a scanner people stop reading. It is not
 * concealment — this comment is three lines above it.
 *
 * Regenerate and repoint with:
 *   node --env-file=.env scripts/demo-wallet.mjs new
 *   node --env-file=.env scripts/demo-wallet.mjs resolver
 *   node --env-file=.env scripts/demo-wallet.mjs series hero 20
 *   node scripts/demo-wallet.mjs publish        ← prints the two lines below
 */

/** Printed by `demo-wallet.mjs publish`. Replace both together. */
export const DEMO_KEY = 'kflgx8K/fYF+3dJJ2JEvbo7ehdW+SoMHVOY0dHlILF4='
export const DEMO_ADDRESS = '0x45f0b8e270245e356A1760456ea84eDB8712C62b'

/**
 * The resolver those names use. Held here rather than looked up, because
 * knowing it in advance saves a round trip and, more usefully, lets the page
 * refuse to write to a pool name whose resolver is not this one — which would
 * mean someone re-registered it and the demo wallet's roles no longer apply.
 */
export const POOL_RESOLVER = '0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65'

/**
 * The pool.
 *
 * A name holds exactly one secret: `nextkey.eph` is written once and never
 * replaced, so a name a visitor has used is spent. The page picks an unused one
 * at random — at random rather than in order, so that two visitors arriving in
 * the same minute are unlikely to collide.
 *
 * Extend it with `demo-wallet.mjs series hero 40` and add the names here.
 */
export const POOL = Array.from({ length: 20 },
  (_, i) => `hero${String(i + 1).padStart(2, '0')}`)
