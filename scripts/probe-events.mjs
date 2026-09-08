/**
 * What do the resolver's events actually look like?
 *
 * The explorer on nextkey.li wants to show the writes to a name — the same
 * thing the official ENS explorer shows as "Text updated" — and to do that it
 * has to decode the resolver's log entries. Guessing the event signature is not
 * an option: a wrong topic hash matches nothing and the panel would sit there
 * empty, which looks exactly like a name that was never written to.
 *
 * One detail decides whether the feature is possible at all. If the `key`
 * parameter is *indexed*, the chain carries only its keccak hash and no page
 * can ever display `nextkey.g2.…` from a log — it could only confirm a key it
 * already guessed. If it sits in the data section, the text is right there.
 *
 * This prints enough to settle both questions:
 *
 *   node --env-file=.env scripts/probe-events.mjs
 *
 * Reads only. Writes nothing, signs nothing, needs no key.
 */

import { createPublicClient, http, keccak256, toHex } from 'viem'
import { sepolia } from 'viem/chains'

const RPC = process.env.NEXTKEY_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const POOL_RESOLVER = process.env.NEXTKEY_POOL_RESOLVER
  ?? '0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65'

const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

/** Candidate spellings, so the output says which one matches rather than us
 *  deciding from a screenshot what the ABI probably is. */
const CANDIDATES = [
  'TextChanged(bytes32,string,string)',
  'TextChanged(bytes32,string,string,string)',
  'TextUpdated(bytes32,string,string)',
  'TextUpdated(address,uint256,string,string)',
  'TextUpdated(address,uint256,string)',
  'TextChanged(bytes,string,string)',
]
const topics = new Map(CANDIDATES.map((sig) => [keccak256(toHex(sig)), sig]))

const head = await client.getBlockNumber()
// Roughly the last few days on Sepolia, in chunks the public RPC will accept.
const SPAN = 800n
const CHUNKS = 40n

console.log(`\n  resolver  ${POOL_RESOLVER}`)
console.log(`  head      ${head}\n`)

const seen = new Map()
let found = 0

for (let i = 0n; i < CHUNKS && found < 6; i++) {
  const toBlock = head - i * SPAN
  const fromBlock = toBlock - SPAN + 1n
  let logs = []
  try {
    logs = await client.getLogs({ address: POOL_RESOLVER, fromBlock, toBlock })
  } catch (e) {
    console.log(`  ${fromBlock}–${toBlock}  refused: ${(e.shortMessage ?? e.message).split('\n')[0]}`)
    continue
  }
  for (const log of logs) {
    found++
    const sig = topics.get(log.topics[0])
    const key = `${log.transactionHash}#${log.logIndex}`
    if (seen.has(key)) continue
    seen.set(key, true)

    console.log(`  ── block ${log.blockNumber}  tx ${log.transactionHash}`)
    console.log(`     topic0   ${log.topics[0]}  ${sig ? `→ ${sig}` : '→ no candidate matches'}`)
    log.topics.slice(1).forEach((tpc, n) => console.log(`     topic${n + 1}   ${tpc}`))
    console.log(`     data     ${log.data.length > 400 ? `${log.data.slice(0, 400)}… (${log.data.length} chars)` : log.data}`)
    // The question that decides the feature: is the key readable, or hashed?
    const text = Buffer.from(log.data.slice(2), 'hex').toString('utf8').replace(/[^\x20-\x7e]+/g, ' ').trim()
    if (/nextkey\./.test(text)) console.log(`     readable "${text.slice(0, 120)}"`)
    console.log()
    if (found >= 6) break
  }
}

if (!found) {
  console.log(`  No logs from that resolver in the last ${SPAN * CHUNKS} blocks.`)
  console.log(`  Write something on a hero name first, then run this again.\n`)
} else {
  console.log(`  ${found} log entries seen. Paste this output back.\n`)
}
