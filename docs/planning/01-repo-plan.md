# Repository plan

*Planning artifact, written 3 September 2026 — the evening before the kickoff. Prose only: structure, contents and sequence, no code and no designs. Originally drafted in German; presented here in English.*

Every choice below is optimised for **one developer, ten days**. Where in doubt, the option with fewer moving parts wins.

## Stack

| Component | Choice | Reason |
|---|---|---|
| Frontend | Vite + React + TypeScript, static build | `nextkey.li` runs on Cyon shared hosting — no Node server. A static bundle over SFTP is the shortest route to a stable demo link. |
| Chain access | viem (+ wagmi for wallet connect) | Direct contact with the ENSv2 ABIs, good TypeScript types, no ORM layer in between. |
| Encryption | WebCrypto, AES-GCM | Built into the browser, no dependency. One random key per secret. |
| Key handover | ECDH (X25519), recipient's public key published as an **ENS text record** | ENS supplies not just the identity but the cryptographic material. No key server, and the recipient never registers with us. |
| Ciphertext storage | ENS text record first; IPFS only as a stretch | A seed phrase or password fits in a record. Makes ENS more load-bearing and removes an entire integration. External storage only becomes necessary when files are involved. |
| Notification | Channel declared as an ENS text record, small Node notifier | The recipient does not sign up anywhere — that is the moment that explains the product. |
| Release agent | Small Node script with its own ENS namespace | Runs locally for the demo. Describe it as exactly that, not as a deployed service. |
| Confidential evaluation | Chainlink CRE Confidential Workflow, verified by CLI simulation | The release condition is core product logic. Simulation qualifies for the prize; secrets resolve locally, not from the Vault DON. |

**Warning for day one.** ENSv2 is in beta on Sepolia and this hackathon uses a *dedicated* deployment with its own addresses. viem and ethers ship a built-in Universal Resolver address that must be overridden, or resolution silently hits the wrong deployment. Put every address found on day one into a constants file with the source and date beside it.

## Structure

```
nextkey/
├── README.md              # what judges read first
├── AI_USAGE.md            # required by the rules
├── FEEDBACK-WORLD.md      # qualification requirement for Selfie Check
├── LICENSE                # MIT
├── ai/
│   └── PROMPT_LOG.md      # prompts that shaped documents, decisions, code
├── docs/
│   ├── architecture.md    # data model and flow
│   ├── decisions.md       # dated decision log kept during the build
│   └── planning/          # pre-kickoff planning artifacts (this directory)
├── evidence/              # logs, transaction hashes, screenshots
├── app/                   # Vite frontend
├── agent/                 # Node release agent
└── scripts/               # deploy registry, seed demo data
```

`docs/decisions.md` is the underrated part: one dated line per decision. On 12 September the "How it's made" submission field writes itself from it, including the friction nobody would otherwise remember — and both World and Chainlink ask for exactly that kind of detail.

`evidence/` likewise: every successful step gets a screenshot or a log immediately. Several sponsors require proof, and it cannot be manufactured retroactively.

## Documentation scaffolds

**README** — order is deliberate: name and tagline · repository note about the kickoff boundary · what it does · how it works · **ENSv2 in NextKey** (the mapping table from user action to protocol operation, with file and line pointers — this is the section the ENS judge reads) · World Selfie Check · Chainlink CRE · run it locally · demo and Sepolia addresses · evidence · prize tracks · team · license.

**FEEDBACK-WORLD.md** — World prescribes four headings verbatim, so use them verbatim: Selfie Check docs and integration flow · Developer Portal navigation, search, product discovery, debugging guidance · Sandbox App states, proof flows, test users, errors, edge cases · what was confusing, missing, broken or hard to test.

## First-day commit sequence

Small and frequent, each commit one completed thought: README scaffold and kickoff note · AI usage and feedback documents · Vite + React + TypeScript · viem/wagmi and Sepolia configuration · spike: read the ENSv2 registry · spike: register a subname and grant roles · record the addresses and their sources · spike: trigger Selfie Check via the Sandbox App.

Eight small commits on the first day are a better signal than one large one, and they cost nothing.

## Explicitly not built

User accounts and login · multi-chain · a mobile app · IPFS while records suffice · an elaborate landing page before the core path · any setting that does not appear in the demo video.

**Cut line:** if the core path — place, share, notify, recover — does not run end to end by Tuesday evening, the third sponsor slot is dropped and the submission goes out with two. Two clean integrations beat three half-finished ones, because *Practicality* and *Usability* are two of the five judging categories.
