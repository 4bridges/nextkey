/**
 * Which functions does this contract actually have?
 *
 * The ENSv2 hackathon contracts are unverified on Etherscan and the docs have
 * been wrong twice already — once about the registry initializer, once (it
 * seems) about getResolver. Both failed the same way: a proxy delegating into
 * a function that does not exist reverts with *empty* data, which is
 * indistinguishable from a business-logic failure.
 *
 * Solidity dispatchers compare the incoming selector against constants
 * embedded in the bytecode, so the real function list can be read off the
 * deployed code. This extracts those selectors and looks them up in the public
 * signature database.
 *
 * Usage:
 *   node scripts/probe-abi.mjs 0xContractAddress
 *   node scripts/probe-abi.mjs 0xContractAddress --impl   # follow EIP-1967
 */

import { createPublicClient, http, getAddress } from 'viem'
import { sepolia } from 'viem/chains'

const target = process.argv[2]
const follow = process.argv.includes('--impl')
if (!target?.startsWith('0x')) {
  console.error('\nUsage: node scripts/probe-abi.mjs 0xContractAddress [--impl]\n')
  process.exit(1)
}

const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
})

/** EIP-1967 implementation slot. A proxy's own bytecode holds no business logic. */
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

let address = getAddress(target)

if (follow) {
  const raw = await client.getStorageAt({ address, slot: IMPL_SLOT })
  const impl = raw && raw !== `0x${'0'.repeat(64)}` ? getAddress(`0x${raw.slice(26)}`) : null
  if (impl) {
    console.log(`\n  ${address} is a proxy → ${impl}`)
    address = impl
  } else {
    console.log(`\n  No EIP-1967 implementation slot set; reading ${address} directly`)
  }
}

const code = await client.getCode({ address })
if (!code || code === '0x') {
  console.error(`\n  ✗ no bytecode at ${address}\n`)
  process.exit(1)
}

// PUSH4 is opcode 0x63. Selectors appear as PUSH4 constants in the dispatcher.
const selectors = new Set()
for (let i = 2; i + 10 <= code.length; i += 2) {
  if (code.slice(i, i + 2) === '63') {
    const sel = `0x${code.slice(i + 2, i + 10)}`
    if (!/^0x0{4}/.test(sel)) selectors.add(sel.toLowerCase())
  }
}

console.log(`\n  ${selectors.size} candidate selectors in ${(code.length - 2) / 2} bytes of code`)
console.log('─'.repeat(72))

// Look them up in bulk. Unknown selectors are usually false positives from
// constants that merely look like selectors — or genuinely unpublished ones.
const list = [...selectors]
const named = []
const unknown = []

for (let i = 0; i < list.length; i += 20) {
  const batch = list.slice(i, i + 20)
  const url = `https://api.openchain.xyz/signature-database/v1/lookup?filter=true&function=${batch.join(',')}`
  try {
    const res = await fetch(url)
    const json = await res.json()
    for (const sel of batch) {
      const hit = json?.result?.function?.[sel]?.[0]?.name
      if (hit) named.push([sel, hit])
      else unknown.push(sel)
    }
  } catch (err) {
    console.log(`  ! lookup failed for a batch: ${err.message}`)
    unknown.push(...batch)
  }
}

named.sort((a, b) => a[1].localeCompare(b[1]))
for (const [sel, name] of named) console.log(`  ${sel}  ${name}`)

if (unknown.length) {
  console.log(`\n  ${unknown.length} selector(s) with no published signature:`)
  console.log(`  ${unknown.join(' ')}`)
  console.log(`  (many of these are not functions at all — PUSH4 is also used for constants)`)
}
console.log()
