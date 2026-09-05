/**
 * The release agent — an autonomous actor with an identity and one permission.
 *
 * The agent exists to answer a question the product cannot avoid: what happens
 * to a secret when its owner does not act? Someone has to be able to start a
 * release. Nobody should be able to *perform* one alone.
 *
 * So the agent is a namespace, not a service account. `agent.nextkey.eth` is a
 * name in our own registry, and the agent's key holds the setter role on that
 * name and on nothing else. It writes a proposal onto its own name. It cannot
 * write onto `visa.nextkey.eth`, and `prove-boundary` demonstrates that against
 * the live contracts rather than asserting it.
 *
 * That boundary is not our code being careful. It is Enhanced Access Control
 * refusing the call — the same refusal it would give an attacker holding the
 * agent's key.
 *
 * What the agent proposes is public on purpose: anyone watching the name sees
 * that a release was requested, for which secret, for whom, and when. What
 * stays confidential is the decision — who the guardians are and who approved
 * is evaluated inside a Chainlink CRE Confidential Workflow, and only the
 * verdict comes back out. Transparency about the request, confidentiality about
 * the deliberation.
 *
 *   node scripts/agent.mjs keygen
 *   node --env-file=.env scripts/agent.mjs fund [eth]
 *   node --env-file=.env scripts/agent.mjs propose visa anna.nextkey.eth
 *   node scripts/agent.mjs show
 *   node --env-file=.env scripts/agent.mjs prove-boundary visa [--onchain]
 *   node scripts/agent.mjs fixture 2 60 2
 *
 * Between `keygen`/`fund` and `propose`, the owner must create the name and
 * hand over the one role:
 *
 *   node --env-file=.env scripts/register-subname.mjs register agent
 *   node --env-file=.env scripts/resolver.mjs attach       agent <resolver>
 *   node --env-file=.env scripts/resolver.mjs grant-setter agent <agent address>
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import {
  createPublicClient, createWalletClient, http,
  toHex, keccak256, toBytes, parseEther, formatEther, zeroAddress,
} from 'viem'
import { packetToBytes } from 'viem/ens'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA as D } from './deployment.mjs'

const PARENT = 'nextkey.eth'
const AGENT_NAME = `agent.${PARENT}`
const REGISTRY = process.env.NEXTKEY_REGISTRY ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const KEYS = new URL('../.keys/', import.meta.url)
const AGENT_KEYFILE = new URL('agent-eoa.json', KEYS)

const RECORD_REQUEST = 'nextkey.request'

// ─── Chain plumbing ────────────────────────────────────────────────────────
const hackathonSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: D.upgradableUniversalResolverProxy } },
}
const reader = createPublicClient({ chain: hackathonSepolia, transport: http(RPC) })

const registryAbi = [{ name: 'getResolver', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] }]
const resolverAbi = [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }],
  outputs: [] }]

const resolverFor = async (label) => {
  const r = await reader.readContract({
    address: REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label] })
  if (r === zeroAddress) throw new Error(`${label}.${PARENT} has no resolver — run resolver.mjs attach first`)
  return r
}

const dns = (label) => toHex(packetToBytes(`${label}.${PARENT}`))

// ─── The agent's own key ───────────────────────────────────────────────────
// Separate from the owner's key on purpose. An agent that signs with the
// owner's key is not an agent with a permission; it is the owner with extra
// steps, and every claim about the boundary would be theatre.
const loadAgent = () => {
  if (!existsSync(AGENT_KEYFILE)) throw new Error('no agent key — run: node scripts/agent.mjs keygen')
  const { privateKey } = JSON.parse(readFileSync(AGENT_KEYFILE, 'utf8'))
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    wallet: createWalletClient({ account, chain: sepolia, transport: http(RPC) }),
  }
}

const ownerWallet = () => {
  const pk = process.env.REGISTRAR_PRIVATE_KEY
  if (!pk) throw new Error('REGISTRAR_PRIVATE_KEY not set — this command spends the owner\'s funds')
  return createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })
}

// ─── Commands ──────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2)
const onchain = rest.includes('--onchain')

const usage = () => console.log(`
  agent.mjs keygen
  agent.mjs fund           [eth]
  agent.mjs propose        <label> <recipient.eth>
  agent.mjs show
  agent.mjs prove-boundary <label> [--onchain]
  agent.mjs fixture        [quorum] [delaySeconds] [approvals]
`)

if (cmd === 'keygen') {
  if (existsSync(AGENT_KEYFILE)) {
    const { address } = JSON.parse(readFileSync(AGENT_KEYFILE, 'utf8'))
    console.log(`\n  agent key already exists — ${address}`)
    console.log(`  delete .keys/agent-eoa.json first if you really want a new one\n`)
    process.exit(0)
  }
  mkdirSync(KEYS, { recursive: true })
  const privateKey = generatePrivateKey()
  const { address } = privateKeyToAccount(privateKey)
  writeFileSync(AGENT_KEYFILE, JSON.stringify({ address, privateKey }, null, 2))
  console.log(`\n  agent address  ${address}`)
  console.log(`  stored in      .keys/agent-eoa.json  (gitignored)`)
  console.log(`
  Next, as the owner:
    node --env-file=.env scripts/register-subname.mjs register agent
    node --env-file=.env scripts/resolver.mjs attach       agent <resolver>
    node --env-file=.env scripts/resolver.mjs grant-setter agent ${address}
    node --env-file=.env scripts/agent.mjs fund
`)
}

else if (cmd === 'fund') {
  const { account } = loadAgent()
  const amount = rest.find((a) => !a.startsWith('--')) ?? '0.01'
  const owner = ownerWallet()
  const before = await reader.getBalance({ address: account.address })
  console.log(`\n  funding ${account.address}`)
  console.log(`  balance now  ${formatEther(before)} ETH`)
  const hash = await owner.sendTransaction({ to: account.address, value: parseEther(amount) })
  process.stdout.write(`  → ${hash} `)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(r.status)
  console.log(`  balance now  ${formatEther(await reader.getBalance({ address: account.address }))} ETH\n`)
}

else if (cmd === 'propose') {
  const [label, recipient] = rest.filter((a) => !a.startsWith('--'))
  if (!label || !recipient) { usage(); process.exit(1) }
  const { account, wallet } = loadAgent()

  const request = {
    v: 1,
    secret: `${label}.${PARENT}`,
    recipient,
    filedAt: Math.floor(Date.now() / 1000),
    agent: account.address,
  }
  // The id is the hash of the request itself, so it cannot be filed twice with
  // different contents under the same id, and so the confidential workflow can
  // bind its verdict to exactly this request.
  const value = JSON.stringify(request)
  const requestId = keccak256(toBytes(value)).slice(0, 18)
  const payload = JSON.stringify({ requestId, ...request })

  console.log(`\n  agent      ${account.address}`)
  console.log(`  proposing  release of ${request.secret} to ${recipient}`)
  console.log(`  requestId  ${requestId}`)
  console.log(`  writing to ${AGENT_NAME} · ${RECORD_REQUEST}`)
  console.log(`
  Note where this is written: the agent's own name. It is a proposal, visible
  to anyone, and it changes nothing about who can open the secret.`)

  const resolver = await resolverFor('agent')
  const hash = await wallet.writeContract({
    address: resolver, abi: resolverAbi, functionName: 'setText',
    args: [dns('agent'), RECORD_REQUEST, payload],
  })
  process.stdout.write(`\n  → ${hash} `)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(r.status)
  console.log(`\n  requestHash ${keccak256(toBytes(payload))}`)
  console.log(`  The workflow returns this hash with its verdict, so a verdict
  can be checked against the request it was actually given.\n`)
}

else if (cmd === 'show') {
  const value = await reader.getEnsText({ name: AGENT_NAME, key: RECORD_REQUEST })
  if (!value) { console.log(`\n  ${AGENT_NAME} holds no open request\n`); process.exit(0) }
  console.log(`\n  ${AGENT_NAME} · ${RECORD_REQUEST}`)
  console.log(`  requestHash ${keccak256(toBytes(value))}\n`)
  console.log(JSON.stringify(JSON.parse(value), null, 2), '\n')
}

else if (cmd === 'prove-boundary') {
  const [label] = rest.filter((a) => !a.startsWith('--'))
  if (!label) { usage(); process.exit(1) }
  const { account, wallet } = loadAgent()
  const resolver = await resolverFor(label)

  console.log(`\n  Boundary test`)
  console.log(`  ${'─'.repeat(70)}`)
  console.log(`  agent    ${account.address}`)
  console.log(`  holds    the setter role on ${AGENT_NAME}`)
  console.log(`  attempts to overwrite nextkey.secret on ${label}.${PARENT}`)
  console.log(`  resolver ${resolver}   (the same contract — only the name differs)\n`)

  const call = {
    address: resolver, abi: resolverAbi, functionName: 'setText',
    args: [dns(label), 'nextkey.secret', 'overwritten by the agent'],
    account,
  }

  try {
    await reader.simulateContract(call)
    console.error(`  ✗ THE CALL SUCCEEDED IN SIMULATION.

  That is a finding, not a passing test: the agent can write to a name it
  should not reach. Do not record this run as evidence. Check that
  grant-setter was issued for "agent" and not for "${label}".\n`)
    process.exit(1)
  } catch (e) {
    const reason = e.shortMessage ?? e.message.split('\n')[0]
    console.log(`  ✓ rejected — ${reason}`)
    console.log(`
  The refusal comes from the resolver's role check, not from this script.
  Enhanced Access Control scopes the setter role to a single name, so the
  agent's permission ends exactly where its own namespace ends.`)
  }

  if (!onchain) {
    console.log(`
  Re-run with --onchain to file the rejected call as a transaction anyone
  can open on Etherscan. It costs a little gas and fails on purpose.\n`)
    process.exit(0)
  }

  // Deliberately bypass gas estimation, which would refuse to send a call it
  // knows will revert. We want the failure recorded on chain, where a judge
  // can click it, rather than only in our own terminal output.
  console.log(`\n  filing the rejected call on chain as evidence`)
  const hash = await wallet.writeContract({ ...call, gas: 120_000n })
  process.stdout.write(`  → ${hash} `)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(r.status)
  console.log(`  https://sepolia.etherscan.io/tx/${hash}`)
  console.log(`\n  Status "reverted" is the result we wanted. The protocol said no.\n`)
}

else if (cmd === 'fixture') {
  /**
   * Build the state the confidential workflow evaluates.
   *
   * Two halves, and the point of this command is that only one of them is
   * invented here. `onChainRequest` is read off the chain verbatim — the exact
   * bytes stored at agent.nextkey.eth, not a reconstruction — so the hash the
   * enclave computes is the hash of what the agent actually filed. Anyone can
   * repeat that: read the record, hash it, compare it to the verdict.
   *
   * The guardian approvals around it are fabricated, because guardians are not
   * built yet and pretending otherwise would be the dishonest kind of demo.
   * They stand in for the confidential half: the shape is real, the people are
   * not, and the file says so.
   *
   *   node scripts/agent.mjs fixture [quorum] [delaySeconds] [approvals]
   */
  const nums = rest.filter((a) => !a.startsWith('--')).map(Number)
  const [quorum = 2, delaySeconds = 60, approvalCount = 2] = nums

  const onChainRequest = await reader.getEnsText({ name: AGENT_NAME, key: RECORD_REQUEST })
  if (!onChainRequest) throw new Error(`${AGENT_NAME} holds no request — run propose first`)

  const filedAt = JSON.parse(onChainRequest).filedAt
  const approvals = Array.from({ length: approvalCount }, (_, i) => ({
    guardianRef: `g${i + 1}`,
    at: filedAt + 30 * (i + 1),
  }))
  const quorumReachedAt = approvals.length >= quorum ? approvals[quorum - 1].at : filedAt

  const fixture = {
    _note: 'onChainRequest is read verbatim from agent.nextkey.eth; the approvals around it are fabricated stand-ins for guardians that do not exist yet.',
    onChainRequest,
    policy: { quorum, delaySeconds },
    approvals,
    cancelledAt: null,
    observedAt: quorumReachedAt + delaySeconds + 1,
  }

  const out = new URL('../fixtures/release-request.json', import.meta.url)
  mkdirSync(new URL('../fixtures/', import.meta.url), { recursive: true })
  writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')

  console.log(`\n  read from   ${AGENT_NAME} · ${RECORD_REQUEST}`)
  console.log(`  requestHash ${keccak256(toBytes(onChainRequest))}`)
  console.log(`  policy      quorum ${quorum}, delay ${delaySeconds}s, ${approvalCount} approval(s)`)
  console.log(`  expecting   ${approvalCount >= quorum ? 'RELEASE' : 'PENDING (quorum_not_met)'}`)
  console.log(`  written to  fixtures/release-request.json\n`)
  console.log(`  Commit and push it, then the enclave can fetch it from the raw URL.\n`)
}

else usage()
