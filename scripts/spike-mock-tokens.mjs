/**
 * Spike 2 — do we hold the tokens this deployment actually accepts?
 *
 * The hackathon deployment ships its own MockUSDC and MockDAI. Circle's Sepolia
 * USDC — what every faucet hands out — is a different contract entirely, and
 * the registrar cannot see it. Holding 1,000 of the wrong USDC is
 * indistinguishable, from the registrar's point of view, from holding none.
 * That is very likely why registration reports no available balance.
 *
 * This script reads the balances and then checks, without sending anything,
 * whether the mock tokens let you mint your own.
 *
 * Usage:
 *   node scripts/spike-mock-tokens.mjs 0xYourAddress
 */

import { createPublicClient, http, formatUnits, parseUnits } from 'viem'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA, CIRCLE_SEPOLIA_USDC } from './deployment.mjs'

const address = process.argv[2]
if (!address?.startsWith('0x')) {
  console.error('\nUsage: node scripts/spike-mock-tokens.mjs 0xYourAddress\n')
  process.exit(1)
}

const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
})

const erc20 = [
  { name: 'symbol',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }],
  },
]

// Mock tokens in test deployments usually expose one of these. We only
// simulate — nothing is sent, no key is needed.
const mintCandidates = [
  {
    label: 'mint(address,uint256)',
    abi: [{ name: 'mint', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] }],
    args: (to, amount) => [to, amount],
  },
  {
    label: 'mint(uint256)',
    abi: [{ name: 'mint', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] }],
    args: (_to, amount) => [amount],
  },
  {
    label: 'drip()',
    abi: [{ name: 'drip', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }],
    args: () => [],
  },
  {
    label: 'faucet()',
    abi: [{ name: 'faucet', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }],
    args: () => [],
  },
]

const tokens = [
  { name: 'MockUSDC (deployment)', addr: ENSV2_SEPOLIA.mockUSDC, mintable: true },
  { name: 'MockDAI  (deployment)', addr: ENSV2_SEPOLIA.mockDAI,  mintable: true },
  { name: 'Circle USDC (faucets)', addr: CIRCLE_SEPOLIA_USDC,    mintable: false },
]

console.log(`\nToken balances for ${address}`)
console.log('─'.repeat(66))

for (const t of tokens) {
  let symbol = '?', decimals = 18, balance = 0n
  try {
    ;[symbol, decimals, balance] = await Promise.all([
      client.readContract({ address: t.addr, abi: erc20, functionName: 'symbol' }),
      client.readContract({ address: t.addr, abi: erc20, functionName: 'decimals' }),
      client.readContract({ address: t.addr, abi: erc20, functionName: 'balanceOf', args: [address] }),
    ])
  } catch (err) {
    console.log(`  ${t.name.padEnd(24)} ✗ unreadable — ${err.shortMessage ?? err.message}`)
    continue
  }

  const held = formatUnits(balance, decimals)
  const mark = balance > 0n ? '✓' : '·'
  console.log(`  ${mark} ${t.name.padEnd(24)} ${held.padStart(14)} ${symbol}`)
  console.log(`    ${t.addr}`)

  if (!t.mintable || balance > 0n) continue

  // Nothing is sent here. simulateContract asks the node "would this succeed",
  // which is enough to find out whether the function exists and is open.
  console.log(`    Probing for a public mint…`)
  for (const c of mintCandidates) {
    try {
      await client.simulateContract({
        address: t.addr,
        abi: c.abi,
        functionName: c.abi[0].name,
        args: c.args(address, parseUnits('1000', decimals)),
        account: address,
      })
      console.log(`    ✓ ${c.label} would succeed — mint 1000 ${symbol} yourself`)
      break
    } catch {
      /* not this one */
    }
  }
}

console.log(`
If MockUSDC shows a zero balance, that is almost certainly why registration
fails: the app is looking for THIS token, and the USDC from the faucets is a
different contract. If a mint function was found above, the simplest way to use
it is Sepolia Etherscan → the token address → Contract → Write Contract →
Connect your wallet → mint. No private key ever leaves your wallet that way.
`)
