# Demo video — shooting script

**Target 3:30, hard limits 2:00–4:00. Minimum 720p. Your own voice, no synthetic narration, no phone camera.**

The rule for every line below: show the thing, then say what it means. Not the other way round. A judge who mutes the audio should still follow the story, and a judge who only listens should still learn something. Nothing is claimed here that is not on screen while it is claimed.

---

## Before you record

**Terminal.** Font size up to roughly 18–20pt so it is legible at 720p. Dark or light, but pick one and keep it. Clear the scrollback before each take (`cls`).

**Never on screen.** `.env` open in an editor, the contents of `.keys/`, any `--env-file` command whose output could echo a key. The commands below never print one, but do not open the files "to show the setup".

**Say it once, early:** the seed phrase in the demo is a throwaway generated for the recording and guards nothing. This costs four seconds and removes the only objection a security-minded judge will otherwise carry through the whole video.

**Windows.** Turn off notifications (Focus Assist). Close Slack, Discord, mail.

**Record in six takes**, in the order below, then cut them together. Do not attempt one continuous run — the chain confirmations take 15–30 seconds each and you will either wait on camera or panic. Where a command writes to the chain, record it, then cut the wait out. That is editing, not deception; the transaction hashes are all in the repo.

**Pre-warm.** Open `https://nextkey.li/demo.html` and the two Etherscan tabs before you start, so nothing loads on camera.

---

## Take 1 — the problem (0:00–0:25)

**On screen:** `nextkey.li`, the hero. Slow scroll to the handover diagram, stop there.

> "You have a seed phrase. One day someone else is going to need it — a partner, an executor, yourself after you have lost a device. Right now your options are a piece of paper in a drawer, a password manager somebody else operates, or a message you will regret sending.
>
> They all fail the same way. Either nobody can get to it when it matters, or the wrong person already has.
>
> This is NextKey. It hands a secret over to a specific person, under conditions that nobody — including us — can bypass."

**Note:** do not read the H1 aloud. It is on screen; saying it as well wastes four seconds and sounds like an advertisement.

---

## Take 2 — store and share (0:25–1:15)

**On screen:** terminal, cleared.

```
node --env-file=.env scripts/nextkey.mjs store visa alice "witch collapse practice feed shame open despair creek road again ice least"
```

> "The secret is encrypted here, on my machine, with a key that never leaves it. What goes on chain is ciphertext, in an ENS text record."

Let the transaction confirm. Then:

```
node --env-file=.env scripts/nextkey.mjs share visa alice anna.nextkey.eth
```

> "Now I share it with Anna. Not with an address — with her name.
>
> NextKey reads the public key Anna publishes on her own ENS name, and wraps the key to this one secret to it. Anna never registered with us. She does not have an account. She has a name and a key, and that is enough."

**Point at the line `grant record nextkey.grant.e8d67b99…` when it appears:**

> "And notice the address that grant is written to. That is not a name — it is a fingerprint of Anna's key. Names move. Keys do not."

---

## Take 3 — the payoff (1:15–1:45)

**On screen:** same terminal.

```
node scripts/nextkey.mjs open visa anna
node scripts/nextkey.mjs open visa alice
```

> "Anna opens it with her own key. And so does Alice, who owns it — through exactly the same path. There is no owner branch in the code and no master key.
>
> That matters, because 'we cannot read your secrets' is a claim every product makes. Here it is a property of the code rather than a promise about our conduct. The honest cost comes with it: lose your key file and the secret is gone, because there is nobody who could recover it for you."

**This is the emotional centre of the video. Do not rush it.** Two commands, two identical outputs, one sentence about what that means.

---

## Take 4 — the live page (1:45–2:20)

**On screen:** `nextkey.li/demo.html`, already loaded. Scroll to "The recipient".

> "Everything on this page is read from Sepolia as it loads. Nothing cached, nothing replayed."

**Point at `derived here`:**

> "This is the part I would look at if I were judging. Nothing on this page was told where Anna's grant lives. It read the key she publishes on her own name, fingerprinted it in the browser, and looked there. No directory. No lookup service. No server of ours in the path at all."

**Scroll to "The secret":**

> "The ciphertext is public and you are reading it right now. That is not a leak — it is AES-256-GCM under a key that exists on no server."

---

## Take 5 — the agent and its limits (2:20–3:00)

**On screen:** terminal.

```
node --env-file=.env scripts/agent.mjs propose visa anna.nextkey.eth
```

> "Some releases have to happen when the owner is not there. So there is an agent. It has its own ENS name, its own key, and exactly one permission: write one record on its own name."

**Then:**

```
node --env-file=.env scripts/agent.mjs prove-boundary visa
```

> "Here it tries to overwrite the secret. Same resolver contract, different name."

**Let the rejection appear. Switch to the Etherscan tab showing the reverted transaction.**

> "And it is refused. Not by our code being careful — by ENS. That is a real transaction on Sepolia, and 'reverted' is the result we wanted. You can open it yourself; the hash is in the README."

---

## Take 6 — the enclave, and the honest ending (3:00–3:30)

**On screen:** the CRE simulation output, or `evidence/cre-decision.log` in the editor.

> "The decision itself runs inside a Chainlink confidential workflow. Who the guardians are and how many approved never leaves the enclave — a public guardian list is a target list.
>
> But that creates a problem: if nobody can see the inputs, why would anyone believe the verdict? So the verdict carries the hash of the request. Read the record off the chain, hash it yourself, compare."

**Switch to the demo page, "The agent's proposal", where the two hashes sit one above the other:**

> "Hashed in the browser. Returned by the enclave. Same value."

**Final, on the demo page or the README status box:**

> "This is a prototype on a testnet, built in nine days, and it has not been audited — don't put a real seed phrase in it. What does work end to end is the part that matters: a secret handed to a named person, released by rules, and revoked by a registry rather than by us.
>
> A human is involved. No human is in control."

---

## If you are over four minutes

Cut in this order, and only in this order:

1. Take 1 down to two sentences. The problem is the least surprising part.
2. The `store` command in Take 2 — start at `share`, and say the secret is already stored.
3. Take 6's first paragraph. The hash comparison survives; the explanation of enclaves can go.

**Never cut:** the two `open` commands in Take 3, the `derived here` line in Take 4, or the rejected transaction in Take 5. Those three are the whole argument.

---

## If you are under two minutes

You are talking too fast. Slow down rather than adding material — a judge watching thirty of these notices pace before content.

---

## What the video must not do

No claims the repository does not back. Specifically, do not say "guardians approve" as though guardians exist — they are a shape in a fixture, and the honest phrasing is *"the rule counts guardian approvals; the guardian layer itself is a fixture in this build."* Do not say the World ID flow works unless it does by then. Do not say "military grade", "unhackable", or "your secrets are safe with us" — the last one is the opposite of the design.

If World access has not arrived, say nothing about World at all. Silence reads as focus. A half-built integration mentioned in passing reads as padding.
