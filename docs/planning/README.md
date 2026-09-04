# Planning artifacts

ETHGlobal permits spec-driven workflows on the condition that prompts and planning artifacts are documented in the repository. This directory is that documentation.

## The kickoff boundary

ETHOnline 2026 kicked off on **4 September 2026**. Everything in this directory dated **2–3 September** is planning: research into the rules and sponsor tracks, decisions about which track and which prizes to target, and written specifications for what would be built.

**No code, designs or assets predate the kickoff.** These documents are prose. They exist precisely so that the boundary is verifiable rather than asserted — you can read exactly what was decided before the event and see in `git log` that everything executable came after it.

| Document | Dated | What it is |
|---|---|---|
| [`00-track-and-sponsor-decisions.md`](./00-track-and-sponsor-decisions.md) | 2–4 Sep | Why the From Scratch track, why these three sponsors, what was rejected |
| [`01-repo-plan.md`](./01-repo-plan.md) | 3 Sep | Stack choices, repository structure, documentation scaffolds |
| [`02-landing-page-spec.md`](./02-landing-page-spec.md) | 3 Sep | Content and copy specification for nextkey.li |

Decisions taken *during* the build are logged separately and continuously in [`../decisions.md`](../decisions.md).

AI tool usage is disclosed in [`../../AI_USAGE.md`](../../AI_USAGE.md); the prompts behind these artifacts are in [`../../ai/PROMPT_LOG.md`](../../ai/PROMPT_LOG.md).
