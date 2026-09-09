/**
 * Compile contracts/NextKeyNames.sol into an artifact the deploy script uses.
 *
 *   npm i -D solc
 *   node scripts/build-contract.mjs
 *
 * Why a script rather than a framework: this project has exactly one contract,
 * no libraries and no imports. Foundry or Hardhat would bring a toolchain, a
 * config file and a lockfile's worth of dependencies to do what solc's own JS
 * build does in thirty lines — and every one of those would have to be
 * explained in a repository whose point is that it can be read.
 *
 * The output, contracts/NextKeyNames.json, is committed. It is build output and
 * the same argument applies as to the web bundles: the site and the deployment
 * are static uploads, so the artifact has to exist without a build step. The
 * solc version is pinned in package.json for the same reason esbuild is —
 * bytecode that cannot be reproduced is bytecode nobody can check.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const SOURCE = join(ROOT, 'contracts', 'NextKeyNames.sol')
const OUT = join(ROOT, 'contracts', 'NextKeyNames.json')

let solc
try {
  solc = (await import('solc')).default
} catch {
  console.error(`
  No Solidity compiler. It is a dev dependency, not a runtime one:

    npm i -D solc

  Pin it, the way esbuild is pinned — the bytecode this produces is only
  checkable by somebody who can produce the same bytecode.
`)
  process.exit(1)
}

const source = readFileSync(SOURCE, 'utf8')

const input = {
  language: 'Solidity',
  sources: { 'NextKeyNames.sol': { content: source } },
  settings: {
    // Optimised, and the run count recorded in the artifact: a verifier who
    // uses different settings gets different bytecode and no explanation.
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'metadata'] } },
  },
}

const out = JSON.parse(solc.compile(JSON.stringify(input)))

const problems = out.errors ?? []
for (const e of problems) console.log(`  ${e.severity}: ${e.formattedMessage.trim()}`)
if (problems.some((e) => e.severity === 'error')) {
  console.error(`\n  Not written.\n`)
  process.exit(1)
}

const c = out.contracts['NextKeyNames.sol'].NextKeyNames
const artifact = {
  contract: 'NextKeyNames',
  solc: solc.version(),
  optimizer: { enabled: true, runs: 200 },
  abi: c.abi,
  bytecode: `0x${c.evm.bytecode.object}`,
}

mkdirSync(join(ROOT, 'contracts'), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`)

console.log(`
  compiler    ${artifact.solc}
  optimizer   enabled, 200 runs
  bytecode    ${(artifact.bytecode.length - 2) / 2} bytes
  written     contracts/NextKeyNames.json

  Next: node --env-file=.env scripts/deploy-names.mjs
`)
