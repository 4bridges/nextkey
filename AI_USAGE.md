# AI Usage Disclosure

ETHGlobal permits AI tools to assist development but not to create the entire project, requires full attribution, and permits spec-driven workflows on the condition that prompts and planning artifacts are documented. This file is that disclosure. It is updated as the project progresses rather than written at the end.

## Where to find the evidence

| What | Where |
|---|---|
| Planning artifacts, dated, from before the kickoff | [`docs/planning/`](./docs/planning) |
| Prompts that shaped documents, decisions and code | [`ai/PROMPT_LOG.md`](./ai/PROMPT_LOG.md) |
| Decisions taken during the build, dated | [`docs/decisions.md`](./docs/decisions.md) |
| The kickoff boundary, in machine-checkable form | `git log` |

## Tools used

| Tool | Used for |
|---|---|
| Claude (Anthropic) | Rules research, sponsor track analysis, positioning, architecture discussion, documentation drafting, code assistance |

<!-- TODO: add editor-integrated assistants, code completion, or any other AI tool actually used, and say what each was used for -->

## How it was used

**Planning, before the kickoff.** Claude was used to read and cross-check the ETHOnline 2026 rules, the submission guidelines and every sponsor prize page; to decide between the Continuity and From Scratch tracks; and to choose the three partner prizes. It also drafted the product positioning and the project description. All of this is prose, and all of it is in `docs/planning/` with its dates. No code, designs or assets predate the kickoff.

**During the build.** Claude is used as a coding assistant: drafting boilerplate, explaining unfamiliar SDK surfaces (ENSv2 Enhanced Access Control, World ID Selfie Check, Chainlink CRE), reviewing code and drafting documentation. Architecture decisions, integration design and debugging are the author's.

**Where the assistant was wrong.** Worth stating plainly, because it is the honest measure of how the tool was used. Its first prize recommendation (Privy, 1inch Aqua) was wrong and was discarded — both tracks require value transfer, which a credential vault does not do. It also misread the Chainlink documentation and concluded that CLI simulation needed no beta access, then reversed that, and then reversed again once Chainlink Labs answered directly in Discord. Each correction is recorded in `ai/PROMPT_LOG.md` and `docs/planning/00-track-and-sponsor-decisions.md` rather than quietly edited away.

**Verification.** Every factual claim in the submission — contract addresses, SDK behaviour, sponsor qualification requirements — was checked against primary sources: the sponsor documentation, the prize pages, and answers given by sponsor teams in the event Discord.

## What is not AI-generated

<!-- TODO: keep this specific as the project grows. Name the parts you wrote yourself,
     the integrations you wired by hand, and the bugs you found and fixed. -->

## Statement

AI tools assisted this project. They did not create it. Every integration was designed, wired and debugged by the author; the assistant accelerated reading documentation and writing prose. The planning artifacts and prompt log in this repository exist so that this claim can be checked rather than taken on faith.
