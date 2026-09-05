/**
 * Deploy NextKey's own UserRegistry and hang it under nextkey.eth.
 *
 * This is the step that turns a name into a namespace. Once the registry is
 * linked, every secret NextKey stores becomes a subname inside it, and the
 * whole sharing model — grantRoles for one record, expiry for time-limited
 * access, revokeRoles to withdraw it — is protocol state rather than rows in
 * a database of ours.
 *
 * Two commands:
 *   node scripts/deploy-registry.mjs deploy   # VerifiableFactory.deployProxy
 *   node scripts/deploy-registry.mjs link 0x… # ETHRegistry.setSubregistry
 *
 * Without REGISTRAR_PRIVATE_KEY set, nothing is sent: each step prints the
 * contract, function and arguments to execute from Etherscan's Write Contract
 * tab with your own wallet.
 */

import {
  createPublicClient, createWalletClient, http,
  keccak256, toBytes, stringToHex, namehash,
  encodeAbiParameters, encodeFunctionData, parseAbiItem,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA } from './deployment.mjs'

const NAME = process.env.NEXTKEY_NAME ?? 'nextkey.eth'
const LABEL = NAME.split('.')[0]
const OWNER = process.env.REGISTRAR_OWNER ?? '0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B'
const VERSION = 0n

/**
 * Every role granted to the deployer. Each role occupies one nybble, so this
 * is "1" in all 64 positions — the deployer becomes root of their own registry.
 * Tighten this later if the registry is ever operated by more than one account.
 */
const ROLE_BITMAP =
  0x1111111111111111111111111111111111111111111111111111111111111111n

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) })

const pk = process.env.REGISTRAR_PRIVATE_KEY
const account = pk ? privateKeyToAccount(pk) : undefined
const walletClient = account
  ? createWalletClient({ account, chain: sepolia, transport: http(RPC) })
  : undefined

// ─── ABIs ──────────────────────────────────────────────────────────────────
const factoryAbi = [
  { name: 'deployProxy', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'salt', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }] },
]

/**
 * The initializer the implementation actually exposes.
 *
 * The docs describe `initialize(address rootAccount, uint256 roleBitmap)`
 * (selector 0xcd6dc687). The deployed implementation expects
 * `initialize((address,uint256)[])` (selector 0x37cb53a8) — an array of
 * account/roleBitmap pairs. Calling the documented signature reverts with
 * empty data, because the proxy's delegatecall into a non-existent function
 * fails without a reason string. Recovered by decoding a working deployment:
 * scripts/inspect-deploy-tx.mjs.
 *
 * The real signature is the better one: several accounts can be granted
 * different roles at deployment time — which is exactly the model NextKey
 * demonstrates.
 */
const registryInitAbi = [
  { name: 'initialize', type: 'function', stateMutability: 'nonpayable',
    inputs: [{
      name: 'assignments', type: 'tuple[]',
      components: [
        { name: 'account', type: 'address' },
        { name: 'roleBitmap', type: 'uint256' },
      ],
    }],
    outputs: [] },
]

const ethRegistryAbi = [
  { name: 'setSubregistry', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'registry', type: 'address' },
    ],
    outputs: [] },
]

// ─── Derived values ────────────────────────────────────────────────────────
//
// The salt is deterministic: keccak256("UserRegistry"), the namehash of the
// parent, and a version counter. Deterministic means the address is knowable
// in advance — and that a second deploy with the same version would collide,
// which is what the version field is for.
const salt = BigInt(
  keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
      [keccak256(stringToHex('UserRegistry')), namehash(NAME), VERSION],
    ),
  ),
)

const initData = encodeFunctionData({
  abi: registryInitAbi,
  functionName: 'initialize',
  args: [[{ account: OWNER, roleBitmap: ROLE_BITMAP }]],
})

/** Token id of the parent label inside the .eth registry. */
const labelId = BigInt(keccak256(toBytes(LABEL)))

const submit = async ({ to, abi, functionName, args, note }) => {
  if (!walletClient) {
    const inputs = abi.find((f) => f.name === functionName).inputs
    console.log(`\n  Execute this yourself:`)
    console.log(`    Contract  ${to}`)
    console.log(`    Function  ${functionName}`)
    args.forEach((a, i) => console.log(`      ${i + 1}. ${inputs[i].name.padEnd(14)} ${a}`))
    if (note) console.log(`\n  ${note}`)
    console.log()
    return
  }
  const hash = await walletClient.writeContract({ address: to, abi, functionName, args })
  console.log(`  → sent ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`  → ${receipt.status}`)
  return receipt
}

// ─── Commands ──────────────────────────────────────────────────────────────
const command = process.argv[2]

console.log(`\nNextKey registry — ${NAME}`)
console.log('─'.repeat(72))
console.log(`  factory     ${ENSV2_SEPOLIA.verifiableFactory}`)
console.log(`  impl        ${ENSV2_SEPOLIA.userRegistryImpl}`)
console.log(`  owner       ${OWNER}`)
console.log(`  mode        ${walletClient ? 'signing' : 'print-only'}`)

if (command === 'deploy') {
  console.log(`\n  salt        ${salt}`)
  console.log(`  initData    ${initData}`)

  await submit({
    to: ENSV2_SEPOLIA.verifiableFactory,
    abi: factoryAbi,
    functionName: 'deployProxy',
    args: [ENSV2_SEPOLIA.userRegistryImpl, salt, initData],
    note: `Afterwards open the transaction on Etherscan, find the ProxyDeployed
  event and copy its proxyAddress. Then:
    node scripts/deploy-registry.mjs link 0xTheProxyAddress`,
  })
}

else if (command === 'link') {
  const proxy = process.argv[3]
  if (!proxy?.startsWith('0x')) {
    console.error(`\n  Usage: node scripts/deploy-registry.mjs link 0xProxyAddress\n`)
    process.exit(1)
  }
  console.log(`\n  registry    ${proxy}`)
  console.log(`  label       ${LABEL}`)
  console.log(`  tokenId     ${labelId}`)

  await submit({
    to: ENSV2_SEPOLIA.ethRegistry,
    abi: ethRegistryAbi,
    functionName: 'setSubregistry',
    args: [labelId, proxy],
    note: `Once this lands, ${NAME} has its own namespace. Verify by resolving a
  subname you register in it — the Universal Resolver will traverse down into
  the new registry.`,
  })
}

else if (command === 'events') {
  // Find the ProxyDeployed event for our salt, so the proxy address can be
  // recovered without hunting through Etherscan.
  const latest = await publicClient.getBlockNumber()
  const logs = await publicClient.getLogs({
    address: ENSV2_SEPOLIA.verifiableFactory,
    event: parseAbiItem(
      'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
    ),
    args: { sender: OWNER },
    fromBlock: latest - 2_000n,
    toBlock: latest,
  })
  if (logs.length === 0) {
    console.log(`\n  No ProxyDeployed events from ${OWNER} in the last 2000 blocks.\n`)
  } else {
    for (const l of logs) {
      const mine = l.args.salt === salt ? '  ← this is ours' : ''
      console.log(`\n  proxy  ${l.args.proxyAddress}${mine}`)
      console.log(`  salt   ${l.args.salt}`)
      console.log(`  tx     https://sepolia.etherscan.io/tx/${l.transactionHash}`)
    }
    console.log()
  }
}

else {
  console.error(`\n  Usage: node scripts/deploy-registry.mjs <deploy|link|events> [proxyAddress]\n`)
  process.exit(1)
}
