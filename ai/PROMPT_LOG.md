# Prompt log

*Kept continuously, not reconstructed afterwards.*

ETHGlobal permits spec-driven workflows provided prompts and planning artifacts are documented. This file records the prompts that shaped the project. It is not a keystroke transcript — routine completions and autocomplete are not logged, and logging them would obscure rather than reveal. What is logged: every prompt that produced a document, a design decision, or a non-trivial piece of code, with a note on what came back and what was changed afterwards.

**Format**

```
### YYYY-MM-DD · [tool] · what it was for
> the prompt, quoted

**Result:** what came back, in one or two lines.
**Changed afterwards:** what the author corrected, rejected or rewrote.
```

The "changed afterwards" line matters more than the prompt. It is the honest record of where the assistant was wrong and where judgement was applied.

---

## Before the kickoff — planning

### 2026-09-02 · Claude · rules, disqualification risks, prize strategy

> ich habe mich angemeldet beim nächsten ETH Hackathon. Ziel ist es das bereits bei ETH bekannte Projekt pKeep weiterzuentwickeln mit message funktion die den user über neue Nachrichten informiert und welches die 1inch wallet und ENS Namen verwendet. es geht darum, dass du die regeln verstehst, dass man nicht disqualifiziert wird und richtig die git commits sendet, weiter brauchen wir eine github account und prüfe die gewinnchance mit unserem vorhaben, welche preise wir anvisieren sollen von welchen partnern mit unserer lösung.

**Result:** analysis of the ETHOnline 2026 rules, the Continuity/From Scratch distinction, git-history requirements, and a first pass at prize selection.
**Changed afterwards:** the first recommendation (Privy, 1inch Aqua) was wrong — it was made before the assistant had seen what pKeep actually was. Both tracks require money to move. Discarded and redone once the pKeep showcase entry was supplied. See `docs/planning/00-track-and-sponsor-decisions.md` §4.

### 2026-09-03 · Claude · track decision

> [ETHGlobal Discord answer supplied: "From scratch has no tags. Continuity shows: This prize is only available to Continuity Track participants."]

**Result:** every prize track checked against the tag rule; conclusion that Continuity would forfeit all well-fitting prizes.
**Changed afterwards:** nothing — decision accepted and acted on.

### 2026-09-03 · Claude · naming

> das sind alles keine guten namen für ein produkt, dass man international vermarkten möchte über gio und seo soll es auffindbar sein und zugleich einfach zu merken für die leute. das leitmotiv muss überarbeitet werden, da man nicht einfach menschen vertraut, das ziehl ist dem prozess zu trauen und ein mensch ist involviert

**Result:** the motto was rewritten to *"A human is involved. No human is in control."* and three name candidates proposed under GEO/SEO constraints.
**Changed afterwards:** the correction came from the author, not the assistant — the earlier positioning ("secrets to people, not to addresses") was both weaker and technically wrong. `NextKey` was chosen from the candidates by the author.

### 2026-09-03 · Claude · repository plan and landing page specification

> anderer Vorbereitungsschritt für morgen wichtiger, etwa die Repo-Struktur und die Doku-Gerüste als Textplan
>
> schreibe jetzt die Landingpage-Spec, wir haben ja zeit

**Result:** `docs/planning/01-repo-plan.md` and `docs/planning/02-landing-page-spec.md`.
**Changed afterwards:** <!-- TODO: note what you revise once you build against them -->

---

## During the build

<!--
From here on, log as you go. One entry per prompt that shaped a document, a
decision, or non-trivial code. Keep the "Changed afterwards" line honest —
it is the most useful part of this file for anyone reviewing the work.
-->

### 2026-09-04 · Claude · repository documentation

> Wenn das Repo steht, sag Bescheid — dann schreibe ich dir README, AI_USAGE.md und FEEDBACK-WORLD.md

**Result:** first drafts of `README.md`, `AI_USAGE.md`, `FEEDBACK-WORLD.md`, including the ENSv2 hackathon deployment addresses and the viem Universal Resolver override.
**Changed afterwards:** <!-- TODO -->
