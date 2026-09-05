/**
 * Register a .eth name directly against the ENSv2 hackathon ETHRegistrar,
 * bypassing the manager app's chain-abstraction layer.
 *
 * The registrar uses commit–reveal: you publish a commitment, wait out
 * MIN_COMMITMENT_AGE (60s), then register. The `secret` used to build the
 * commitment must be the same in both steps, so this script persists it to
 * disk between them. Lose that file between commit and register and the
 * commitment is unusable — you wait out MAX_COMMITMENT_AGE and start over.
 *
 * Two modes:
 *
 *   Without REGISTRAR_PRIVATE_KEY in the environment, nothing is sent. Each
 *   step prints the contract, function and arguments so you can execute it from
 *   Sepolia Etherscan's "Write Contract" tab with your own wallet. Your key
 *   never leaves the wallet. Slower, and the right default.
 *
 *   With REGISTRAR_PRIVATE_KEY set, the script signs and sends. Only do this
 *   with a throwaway testnet key, and only from a .env that is gitignored.
 *
 * Usage:
 *   node scripts/register-name.mjs check    nextkey
 *   node scripts/register-name.mjs approve  nextkey
 *   node scripts/register-name.mjs commit   nextkey
 *   node scripts/register-name.mjs register nextkey
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, formatUnits, zeroAddress, zeroHash } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA } from './deployment.mjs'

// ── Parameters you may want to change ──────────────────────────────────────
const OWNER = process.env.REGISTRAR_OWNER ?? '0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B'
const DURATION = 31_536_000n            // one year, in seconds
const PAYMENT_TOKEN = ENSV2_SEPOLIA.mockUSDC
/** Left at zero deliberately — the UserRegistry is linked later with setSubregistry(). */
const SUBREGISTRY = zeroAddress
/** Also zero; the resolver is set once we deploy a Permissioned Resolver proxy. */
const RESOLVER = zeroAddress
const REFERRER = zeroHash

const [command, label] = process.argv.slice(2)
if (!command || !label) {
  console.error('\nUsage: node scripts/register-name.mjs <check|approve|commit|register> <label>\n')
  process.exit(1)
}

const stateFile = new URL(`../.registration-${label}.json`, import.meta.url)

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
})

const pk = process.env.REGISTRAR_PRIVATE_KEY
const account = pk ? privateKeyToAccount(pk) : undefined
const walletClient = account
  ? createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) })
  : undefined

// ── Minimal ABIs ───────────────────────────────────────────────────────────
const registrarAbi = [
  { name: 'isAvailable', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'bool' }] },
  { name: 'getRegisterPrice', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'duration', type: 'uint64' },
      { name: 'paymentToken', type: 'address' },
    ],
    outputs: [{ name: 'base', type: 'uint256' }, { name: 'premium', type: 'uint256' }] },
  { name: 'makeCommitment', type: 'function', stateMutability: 'pure',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'secret', type: 'bytes32' },
      { name: 'subregistry', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'duration', type: 'uint64' },
      { name: 'referrer', type: 'bytes32' },
    ],
    outputs: [{ type: 'bytes32' }] },
  { name: 'commit', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }], outputs: [] },
  { name: 'register', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'secret', type: 'bytes32' },
      { name: 'subregistry', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'duration', type: 'uint64' },
      { name: 'paymentToken', type: 'address' },
      { name: 'referrer', type: 'bytes32' },
    ],
    outputs: [] },
]

const erc20Abi = [
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
]

// ── Helpers ────────────────────────────────────────────────────────────────
const readState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null)

const price = async () => {
  const [base, premium] = await publicClient.readContract({
    address: ENSV2_SEPOLIA.ethRegistrar, abi: registrarAbi, functionName: 'getRegisterPrice',
    args: [label, DURATION, PAYMENT_TOKEN],
  })
  return { base, premium, total: base + premium }
}

/**
 * Either send the transaction, or print what to execute by hand. Printing is
 * the default because it needs no private key at all.
 */
const submit = async ({ to, abi, functionName, args, human }) => {
  if (!walletClient) {
    console.log(`\n  Execute this yourself:`)
    console.log(`    Contract  ${to}`)
    console.log(`    Function  ${functionName}`)
    args.forEach((a, i) => console.log(`      ${String(i + 1).padStart(2)}. ${abi.find(f => f.name === functionName).inputs[i].name.padEnd(13)} ${a}`))
    console.log(`\n  On Sepolia Etherscan: open the contract → Contract → Write Contract →`)
    console.log(`  Connect to Web3 → ${functionName}. ${human ?? ''}\n`)
    return null
  }
  const hash = await walletClient.writeContract({ address: to, abi, functionName, args })
  console.log(`  → sent ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`  → ${receipt.status}`)
  return hash
}

// ── Commands ───────────────────────────────────────────────────────────────
console.log(`\nENSv2 direct registration — ${label}.eth`)
console.log('─'.repeat(66))
console.log(`  registrar   ${ENSV2_SEPOLIA.ethRegistrar}`)
console.log(`  owner       ${OWNER}`)
console.log(`  mode        ${walletClient ? 'signing (key present)' : 'print-only (no key)'}`)

if (command === 'check') {
  const available = await publicClient.readContract({
    address: ENSV2_SEPOLIA.ethRegistrar, abi: registrarAbi, functionName: 'isAvailable', args: [label],
  })
  console.log(`\n  available   ${available ? '✓ yes' : '✗ no — pick another label'}`)
  if (!available) process.exit(0)

  const [symbol, decimals, balance] = await Promise.all([
    publicClient.readContract({ address: PAYMENT_TOKEN, abi: erc20Abi, functionName: 'symbol' }),
    publicClient.readContract({ address: PAYMENT_TOKEN, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: PAYMENT_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [OWNER] }),
  ])
  const p = await price()
  console.log(`  price       ${formatUnits(p.base, decimals)} + ${formatUnits(p.premium, decimals)} premium = ${formatUnits(p.total, decimals)} ${symbol}`)
  console.log(`  balance     ${formatUnits(balance, decimals)} ${symbol} ${balance >= p.total ? '✓ enough' : '✗ not enough'}`)
  console.log(`\n  Next: node scripts/register-name.mjs approve ${label}\n`)
}

else if (command === 'approve') {
  const p = await price()
  const allowance = await publicClient.readContract({
    address: PAYMENT_TOKEN, abi: erc20Abi, functionName: 'allowance',
    args: [OWNER, ENSV2_SEPOLIA.ethRegistrar],
  })
  if (allowance >= p.total) {
    console.log(`\n  ✓ allowance already sufficient\n  Next: node scripts/register-name.mjs commit ${label}\n`)
  } else {
    await submit({
      to: PAYMENT_TOKEN, abi: erc20Abi, functionName: 'approve',
      args: [ENSV2_SEPOLIA.ethRegistrar, p.total],
      human: `Then: node scripts/register-name.mjs commit ${label}`,
    })
  }
}

else if (command === 'commit') {
  // Generated once and written to disk. The register step must present exactly
  // this value or the commitment does not match and the call reverts.
  const secret = generatePrivateKey()
  const commitment = await publicClient.readContract({
    address: ENSV2_SEPOLIA.ethRegistrar, abi: registrarAbi, functionName: 'makeCommitment',
    args: [label, OWNER, secret, SUBREGISTRY, RESOLVER, DURATION, REFERRER],
  })

  writeFileSync(stateFile, JSON.stringify(
    { label, owner: OWNER, secret, commitment, committedAt: Math.floor(Date.now() / 1000) }, null, 2))
  console.log(`\n  secret saved to .registration-${label}.json — do NOT commit this file to git`)
  console.log(`  commitment  ${commitment}`)

  await submit({
    to: ENSV2_SEPOLIA.ethRegistrar, abi: registrarAbi, functionName: 'commit', args: [commitment],
    human: `Then wait 60 seconds and run: node scripts/register-name.mjs register ${label}`,
  })
}

else if (command === 'register') {
  const state = readState()
  if (!state) {
    console.error(`\n  ✗ no .registration-${label}.json — run the commit step first\n`)
    process.exit(1)
  }
  const waited = Math.floor(Date.now() / 1000) - state.committedAt
  console.log(`\n  committed   ${waited}s ago ${waited >= 60 ? '✓' : `✗ wait ${60 - waited}s more`}`)
  if (waited < 60) process.exit(1)

  await submit({
    to: ENSV2_SEPOLIA.ethRegistrar, abi: registrarAbi, functionName: 'register',
    args: [label, state.owner, state.secret, SUBREGISTRY, RESOLVER, DURATION, PAYMENT_TOKEN, REFERRER],
    human: `Afterwards verify with: node scripts/spike-read-ens.mjs ${label}.eth`,
  })
}

else {
  console.error(`\n  unknown command: ${command}\n`)
  process.exit(1)
}
