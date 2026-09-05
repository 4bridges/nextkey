/**
 * Read a working VerifiableFactory deployment and show exactly what it sent.
 *
 * Our own deployProxy simulation reverts with empty data, which usually means
 * the initializer call inside the freshly deployed proxy failed — a wrong
 * signature, or an implementation that expects something else. Rather than
 * guess, decode a deployment that is known to have worked.
 *
 * Usage:
 *   node scripts/inspect-deploy-tx.mjs 0xTransactionHash
 */

import { createPublicClient, http, decodeFunctionData, slice } from 'viem'
import { sepolia } from 'viem/chains'

const hash = process.argv[2] ??
  '0x711176dfd824996e4650a35fc0cd043d104fa4d3afbd1ac3ead0d4c190eae631'

const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
})

const factoryAbi = [
  { name: 'deployProxy', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'salt', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }] },
]

// Candidate initializers, so we can name the selector we find.
const initCandidates = [
  'initialize(address,uint256)',
  'initialize(address)',
  'initialize(address,uint256,address)',
  'initialize(address,address,uint256)',
  'initialize(bytes32,address,uint256)',
]

const tx = await client.getTransaction({ hash })

console.log(`\nDeployment transaction`)
console.log('─'.repeat(72))
console.log(`  from      ${tx.from}`)
console.log(`  to        ${tx.to}`)

let decoded
try {
  decoded = decodeFunctionData({ abi: factoryAbi, data: tx.input })
} catch (err) {
  console.log(`\n  Could not decode as deployProxy — raw selector ${slice(tx.input, 0, 4)}`)
  console.log(`  raw input:\n  ${tx.input}\n`)
  process.exit(0)
}

const [implementation, salt, data] = decoded.args
console.log(`\n  implementation  ${implementation}`)
console.log(`  salt            ${salt}`)
console.log(`  data            ${data}`)

const selector = slice(data, 0, 4)
console.log(`\n  initializer selector  ${selector}`)

// Which of our candidate signatures produces this selector?
const { keccak256, toHex, stringToBytes } = await import('viem')
for (const sig of initCandidates) {
  const s = slice(keccak256(stringToBytes(sig)), 0, 4)
  if (s.toLowerCase() === selector.toLowerCase()) {
    console.log(`  → matches           ${sig}`)
  }
}

// Decode the arguments as raw 32-byte words, which works regardless of ABI.
const body = data.slice(10)
console.log(`\n  initializer arguments, as 32-byte words:`)
for (let i = 0; i < body.length; i += 64) {
  const word = body.slice(i, i + 64)
  const asAddress = '0x' + word.slice(24)
  console.log(`    ${String(i / 64).padStart(2)}  0x${word}`)
  console.log(`        as address: ${asAddress}`)
}

console.log(`
Compare this with what our deploy script produces. If the selector differs, the
implementation expects a different initializer than the docs describe, and we
should copy this one.
`)
