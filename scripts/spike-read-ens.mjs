/**
 * Spike 1 — can we read from the ENSv2 hackathon deployment?
 *
 * Throwaway code. Its only job is to answer three questions before we build
 * anything on top:
 *
 *   1. Does the Universal Resolver override actually take effect?
 *   2. Does the hackathon deployment resolve a name to an address?
 *   3. Can we read text records — the mechanism NextKey's whole sharing model
 *      rests on?
 *
 * Usage:
 *   node scripts/spike-read-ens.mjs                 # defaults to nextkey.eth
 *   node scripts/spike-read-ens.mjs somename.eth
 *
 * Optional: set SEPOLIA_RPC_URL if the public endpoint rate-limits you.
 */

import { createPublicClient, http } from 'viem'
import { sepolia } from 'viem/chains'
import {
  ENSV2_SEPOLIA,
  VIEM_DEFAULT_SEPOLIA_UNIVERSAL_RESOLVER,
  NEXTKEY_RECORDS,
} from './deployment.mjs'

// ---------------------------------------------------------------------------
// The override. This is the single most important line in the file.
//
// viem ships a built-in Universal Resolver address for Sepolia. Without this
// override every lookup silently goes to the production ENS deployment and
// returns null — no error, no warning, just nothing. It is the failure mode
// that costs people an afternoon.
// ---------------------------------------------------------------------------
const hackathonSepolia = {
  ...sepolia,
  contracts: {
    ...sepolia.contracts,
    ensUniversalResolver: {
      address: ENSV2_SEPOLIA.upgradableUniversalResolverProxy,
    },
  },
}

const client = createPublicClient({
  chain: hackathonSepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
})

const name = process.argv[2] ?? 'nextkey.eth'

const line = (label, value) =>
  console.log(`  ${label.padEnd(22)} ${value}`)

console.log(`\nENSv2 hackathon deployment — read spike`)
console.log(`─`.repeat(60))

// --- 1. Prove the override took ---------------------------------------------
const active = client.chain.contracts.ensUniversalResolver.address
line('Universal Resolver', active)

if (active.toLowerCase() === VIEM_DEFAULT_SEPOLIA_UNIVERSAL_RESOLVER.toLowerCase()) {
  console.error(
    `\n  ✗ This is viem's built-in address, not the hackathon one.` +
    `\n    Every lookup below would hit the production deployment.\n`
  )
  process.exit(1)
}
line('', '✓ hackathon deployment, not viem default')

// --- 2. Resolve the name ----------------------------------------------------
console.log(`\nResolving ${name}`)
console.log(`─`.repeat(60))

let address
try {
  address = await client.getEnsAddress({ name })
} catch (err) {
  console.error(`  ✗ getEnsAddress threw: ${err.shortMessage ?? err.message}`)
  process.exit(1)
}

if (address) {
  line('address', address)
} else {
  line('address', '— (null)')
  console.log(
    `\n  Not necessarily a bug. null means the name resolves to nothing here:` +
    `\n  either it is not registered in THIS deployment (a mainnet registration` +
    `\n  does not count), or it has no address record set.\n`
  )
}

// --- 3. Read text records ---------------------------------------------------
console.log(`Text records`)
console.log(`─`.repeat(60))

const keys = [
  'description',
  'url',
  'avatar',
  NEXTKEY_RECORDS.publicKey,
  NEXTKEY_RECORDS.notify,
]

for (const key of keys) {
  try {
    const value = await client.getEnsText({ name, key })
    line(key, value ?? '—')
  } catch (err) {
    line(key, `✗ ${err.shortMessage ?? err.message}`)
  }
}

console.log(
  `\nWhat this tells us: if the Universal Resolver line is the hackathon` +
  `\naddress and the calls returned without throwing, the read path works.` +
  `\nValues being empty is a data question, not a plumbing question.\n`
)
