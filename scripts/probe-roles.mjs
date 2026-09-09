/**
 * Which function actually grants a role on the whole registry?
 *
 *   node --env-file=.env scripts/probe-roles.mjs
 *
 * `grantRoles(0, ROLE_REGISTRAR, …)` reverts with 0xc2842458, which is
 * `EACRootResourceNotAllowed()` — EnhancedAccessControl refuses to treat the
 * root resource as an ordinary one. That is a deliberate design in that
 * contract, not a bug in ours: root roles apply to *every* name in the
 * registry, so they are granted through their own entry points rather than by
 * passing 0 to the general one and hoping.
 *
 * This asks the deployed contract which of those entry points it has. Nothing
 * is signed and nothing is sent: every call below is an `eth_call`, so the
 * answers cost nothing and change nothing.
 *
 * How to read the result:
 *
 *   ok           the call succeeded — the function exists and would work
 *   reverts …    the function exists and refused, and the reason is named
 *   no function  empty revert data — that selector is not on this contract
 *
 * The last one is the trap this project has hit before, with `register` taking
 * a string where the documentation said bytes32: a missing function reverts
 * exactly like a failing one, and reads as "your call failed" rather than
 * "that function is not there".
 */
import { createPublicClient, http, encodeFunctionData, keccak256, toHex } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const NEXTKEY_REGISTRY = process.env.NEXTKEY_REGISTRY
  ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

const ROLE_REGISTRAR = 1n << 0n

const pk = process.env.REGISTRAR_PRIVATE_KEY
const from = pk ? privateKeyToAccount(pk).address : undefined
const subject = process.argv[2] ?? '0x0000000000000000000000000000000000000dEaD'

const reader = createPublicClient({ chain: sepolia, transport: http(RPC) })

/** Every error selector we might see back, so a revert can be named. */
const KNOWN_ERRORS = [
  'EACRootResourceNotAllowed()',
  'EACUnauthorizedAccountAdminRoles(uint256,uint256,address)',
  'EACUnauthorizedAccountRoles(uint256,uint256,address)',
  'Error(string)',
  'Panic(uint256)',
]
const errorName = new Map(
  KNOWN_ERRORS.map((sig) => [keccak256(toHex(sig)).slice(0, 10), sig]))

/** Candidate ways to say "give this account the registrar role everywhere". */
const CANDIDATES = [
  { sig: 'grantRootRoles(uint256,address)', args: [ROLE_REGISTRAR, subject] },
  { sig: 'revokeRootRoles(uint256,address)', args: [ROLE_REGISTRAR, subject] },
  { sig: 'hasRootRoles(uint256,address)', args: [ROLE_REGISTRAR, subject] },
  { sig: 'grantRoles(uint256,uint256,address)', args: [0n, ROLE_REGISTRAR, subject] },
  { sig: 'hasRoles(uint256,uint256,address)', args: [0n, ROLE_REGISTRAR, subject] },
  { sig: 'ROOT_RESOURCE()', args: [] },
  { sig: 'getAssignedRoles(uint256,address)', args: [0n, subject] },
  { sig: 'roles(uint256,address)', args: [0n, subject] },
]

/** Build a viem ABI entry from a plain signature, all inputs unnamed. */
const abiFor = (sig) => {
  const name = sig.slice(0, sig.indexOf('('))
  const inner = sig.slice(sig.indexOf('(') + 1, -1)
  const types = inner ? inner.split(',') : []
  return [{
    name, type: 'function', stateMutability: 'nonpayable',
    inputs: types.map((type, i) => ({ name: `a${i}`, type })),
    outputs: [],
  }]
}

console.log(`\nWhich role functions does this registry have?`)
console.log('─'.repeat(72))
console.log(`  registry    ${NEXTKEY_REGISTRY}`)
console.log(`  asking as   ${from ?? '— no key configured; permission answers will be wrong'}`)
console.log(`  about       ${subject}\n`)

for (const { sig, args } of CANDIDATES) {
  const abi = abiFor(sig)
  const data = encodeFunctionData({ abi, functionName: abi[0].name, args })
  let verdict
  try {
    await reader.call({ to: NEXTKEY_REGISTRY, data, account: from })
    verdict = 'ok — exists, and this call would go through'
  } catch (e) {
    const raw = e.walk?.((x) => typeof x?.data === 'string')?.data ?? e.data
    if (!raw || raw === '0x') verdict = 'no function — empty revert, that selector is not here'
    else {
      const named = errorName.get(raw.slice(0, 10))
      verdict = named
        ? `reverts ${named}`
        : `reverts ${raw.slice(0, 10)} — unknown, look it up at 4byte.sourcify.dev`
    }
  }
  console.log(`  ${data.slice(0, 10)}  ${sig.padEnd(46)}${verdict}`)
}

console.log(`
  A line saying "ok" on one of the grantRoot… functions is the answer: that is
  the entry point name-registrar.mjs has to use instead of grantRoles(0, …).
  If every one of them says "no function", this registry spells root roles some
  other way and the next step is its source, not another guess.
`)
