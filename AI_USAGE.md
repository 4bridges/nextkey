# AI Usage Disclosure

ETHGlobal permits AI tools to assist development but not to create the entire project, and requires full attribution along with documentation of prompts and planning artifacts where a spec-driven workflow is used. This document is that disclosure. It is updated as the project progresses, not written retroactively.

## Tools used

| Tool | Used for |
|---|---|
| Claude (Anthropic) | Rules research, sponsor track analysis, prize strategy, architecture discussion, documentation drafting, code assistance |

## How it was used

**Planning and research.** Before the kickoff, Claude was used to read and cross-check the ETHOnline 2026 rules, submission guidelines and all sponsor prize pages, to decide between the Continuity and From Scratch tracks, and to choose which three partner prizes to target. It also drafted the product positioning and the project description. These are planning artifacts, not code or designs — see below for where they live.

**During the build.** Claude is used as a coding assistant: drafting boilerplate, explaining unfamiliar SDK surfaces (ENSv2 Enhanced Access Control, World ID Selfie Check, Ledger DMK), reviewing code, and drafting documentation. Architecture decisions, integration design and debugging are the author's; the assistant accelerates the typing and the reading of documentation.

**Documentation.** This file, the README and the feedback documents were drafted with assistance and edited by the author. Factual claims about contract addresses, SDK behaviour and sponsor requirements were checked against primary sources.

## What is not AI-generated

## Planning artifacts

The spec-driven part of this project is documented in:

- `docs/decisions.md` — dated decision log kept during the build
- `docs/architecture.md` — data model and flow
- Strategy dossier and repository/landing-page plans, produced before the kickoff — 

## Statement

AI tools assisted this project. They did not create it. Every integration was designed, wired and debugged by the author, and every factual claim in the submission was verified against primary sources.
