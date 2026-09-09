# Demo video — shooting script

**Target 3:30, hard limits 2:00–4:00. Minimum 720p. Your own voice, no synthetic narration.**

The rule for every line below: show the thing, then say what it means. Not the
other way round. A judge who mutes the audio should still follow the story, and a
judge who only listens should still learn something. Nothing is claimed here that
is not on screen while it is claimed.

**What changed in this draft (9 September 2026).** Take 3. It used to prove the
v1-versus-v2 point by scrolling between two panels on `poc.html`, which is a
picture of an argument. The explorer now *makes* the argument live: it offers the
visitor the attack, runs it, finds the grant on a v1 name, and on a v2 name says
it cannot even compute the address. Same claim, but the page does it while the
judge watches instead of reporting that it was done earlier.

The earlier change stands: it opens on a phone with no wallet, because that is
the part a judge can reproduce while watching, and everything after it lands
harder once they know the whole thing is one tap away.

---

## Before you record

**Screen-record the phone, do not film it.** Android: built-in screen recorder.
iOS: Control Centre → Record. A camera pointed at a screen looks like an excuse.

**Terminal.** Font up to roughly 18–20pt so it is legible at 720p. Dark or light,
pick one and keep it. Clear the scrollback before each take (`cls`).

**Browser.** One window, no bookmarks bar, no other tabs visible. The site's own
language selector on **EN**. Dark or light — the pages support both; pick the one
your terminal is not, so the cuts read as different places.

**Never on screen.** `.env` open in an editor, the contents of `.keys/`, any
command whose output could echo a key. The commands below never print one — do
not open the files "to show the setup".

**Say it once, early:** the phrase in the demo is a throwaway generated for the
recording and guards nothing. Four seconds, and it removes the only objection a
security-minded judge would otherwise carry through the whole video.

**Prepare the chain state first**, off camera:

```powershell
node --env-file=.env scripts/demo-wallet.mjs free hero 200
node --env-file=.env scripts/nextkey.mjs share vault alice anna.nextkey.eth
```

The first tells you how many lent names are still unused — the pool holds two
hundred, so this is a sanity check rather than a worry; if it ever runs low,
`prepare` a new range — `demo-wallet.mjs prepare hero201 hero202 …`, then raise
the count in `web/src/demo-wallet.js`, in that order. The second restores Anna's
grant on `vault`, which the evidence run revoked; take 5 needs something to take
away.

**Know which names you are showing in take 3**, and check both before you record:

- a **v1** name that still carries a grant to a published key — the attack must
  succeed on camera
- a **v2** name — `vault.nextkey.eth` — where it must fail

`node --env-file=.env scripts/nextkey.mjs eph <name>` answers which scheme a name
is on. Do not discover this during a take.

**Windows.** Focus Assist on. Slack, Discord, mail closed.

**Pre-warm** `nextkey.li/demo`, `nextkey.li/explorer`, `nextkey.li/poc` and the
terminal, so nothing loads on camera. The explorer's live window fills itself on
open and takes a few seconds — let it finish before you start rolling.

**Record in seven takes**, in order, then cut them together. Do not attempt one
continuous run — chain confirmations take 15–30 seconds and you will either wait
on camera or panic. Record the wait, cut it out. That is editing, not deception;
every transaction hash is in `evidence/`.

---

## Take 1 — a phone with no wallet (0:00–0:40)

**On screen:** the phone. `nextkey.li/demo`. Nothing installed, nothing signed in.

> "This is a phone. No wallet extension, no browser extension, no testnet ether —
> nothing installed at all."

**Tap through: generate a phrase, generate a recipient, encrypt.**

> "A secret. Someone to give it to. Encrypted here, in the tab."

**Tick the confirmation, tap "Seal and grant it". Let it run.**

> "And now it goes on a chain. We lend the name and pay the gas, so that this is
> something you can do rather than something you watch me do."

**Cut the wait. Show the transaction links.**

> "Records on Sepolia. Real ones."

**Note:** do not explain the lent wallet here. It is disclosed on the page and in
the README, and a judge who wants it will find it. Explaining it now costs fifteen
seconds at the exact moment the video is winning.

---

## Take 2 — the problem, briefly (0:40–0:55)

**On screen:** `nextkey.li`, the hero, one slow scroll.

> "You have a seed phrase, and one day someone else will need it. A partner, an
> executor, yourself after losing a device.
>
> Paper in a drawer, a password manager somebody else operates, a message you
> regret sending — they fail the same way. Either nobody can reach it when it
> matters, or the wrong person already has."

**Do not read the H1 aloud.** It is on screen; saying it too sounds like an
advertisement.

---

## Take 3 — the leak was never the ciphertext (0:55–1:50)

**This is the take that carries the submission. Do not rush it. It is also the
only one where the page does the work live, so let it.**

**On screen:** `nextkey.li/explorer`. Type the **v1** name. Press *Look it up*.

> "This page reads Sepolia as it loads — nothing cached, nothing replayed — and
> says in words what each record on a name means."

**Scroll to "Can an observer tell who has access?" Type the recipient's name.
Press the button.**

> "Now it does what a stranger watching the chain could do. It takes the public
> key that person publishes on their own name, works out where their grant would
> live, and looks."

**Let it find it. The panel turns red.**

> "Found. And that is the problem, not the feature. The address is a hash of a
> public value, so anyone holding that key can prove this person has access —
> without a private key, without asking anybody. The ciphertext was never the
> leak. The record's *name* was, and the first version of this published the
> guest list of every secret it stored."

**Beat. Now type `vault.nextkey.eth` in the field at the top and look that up
instead. Same section, same recipient, press the button again.**

> "Same page. Same key. Same person. A different name — and nothing to look at."

**Point at the explanation.**

> "The address of her grant comes out of a Diffie–Hellman exchange between this
> name's ephemeral key and her private one. She can compute it. The owner can
> compute it. This page has neither private half, so it cannot compute it, cannot
> test a guess, and cannot even tell whether this name grants to her at all.
>
> To be exact about what is hidden: the records aren't. Anyone can list them and
> count them. What nobody can say is which one is hers — or whether any of them
> is."

**If the cut is running short, hold two more seconds on the live window at the
bottom of the same page** — it fills itself with every record NextKey has written.

> "Everything this system has ever done, live. And it still cannot tell you who
> anything was for."

---

## Take 4 — two implementations, one rule (1:50–2:15)

**On screen:** terminal, cleared.

```
node --env-file=.env scripts/nextkey.mjs open nextkeyv2.eth anna
```

**Let the phrase appear.**

> "A browser wrote that name, with a wallet, on a name outside our own registry.
> This is a command line on a laptop, opening it with a key that was never in that
> browser — using Anna's public key, which it read from her own name.
>
> Two implementations, two registries, no shared state, and nothing of ours in the
> path."

**If you have four minutes rather than three and a half**, add:

```
node --env-file=.env scripts/nextkey.mjs eph nextkeyv2.eth
```

> "And this name carries no stored copy of its ephemeral key. It was recovered
> from a signature — one that MetaMask produced in the browser, and that a
> different library reproduced here, byte for byte."

---

## Take 5 — taking it back (2:15–2:40)

**On screen:** same terminal.

```
node --env-file=.env scripts/nextkey.mjs revoke vault anna.nextkey.eth alice
node --env-file=.env scripts/nextkey.mjs open vault anna
node --env-file=.env scripts/nextkey.mjs open vault alice
```

> "Revoking empties one record and leaves the ciphertext alone. Anna cannot open it
> any more. Alice, who owns it, still can — through exactly the same code path.
> There is no owner branch and no master key.
>
> The honest cost comes with that: lose your key file and the secret is gone,
> because there is nobody who could recover it for you.
>
> And what revocation is not: anyone who already read the secret still knows it. No
> system can retract knowledge, and one that says it can is selling something."

---

## Take 6 — the AI-agent and its limits (2:40–3:00)

**On screen:** terminal.

```
node --env-file=.env scripts/agent.mjs propose visa anna.nextkey.eth
```

> "Some releases have to happen when the owner is not there. So there is an
> AI-agent. It has its own ENS name, its own key, and exactly one permission: write
> one record on its own name."

**Then:**

```
node --env-file=.env scripts/agent.mjs prove-boundary visa
```

> "Here it tries to overwrite the secret. Same resolver contract, different name."

**Let the rejection appear. Cut to the Etherscan tab with the reverted
transaction.**

> "Refused — not by our code being careful, but by ENS. That is a real transaction
> on Sepolia, and 'reverted' is the result we wanted. The hash is in the README."

---

## Take 7 — the enclave, and the honest ending (3:00–3:30)

**On screen:** the CRE simulation output, or `evidence/cre-decision.log`.

> "The decision itself runs inside a Chainlink confidential workflow. Who the
> guardians are and how many approved never leaves the enclave — a public guardian
> list is a target list.
>
> Which creates a problem: if nobody can see the inputs, why believe the verdict?
> So the verdict carries the hash of the request. Read the record off the chain,
> hash it yourself, compare."

**Switch to `nextkey.li/poc`, "The AI-agent's proposal", where the two hashes sit
one above the other:**

> "Hashed in the browser. Returned by the enclave. Same value."

**Final, on the demo page or the README status box:**

> "A prototype on a testnet, built in ten days, not audited — don't put a real seed
> phrase in it. What works end to end is the part that matters: a secret handed to
> a named person, released by rules, revoked by a registry rather than by us, and
> stored so that the chain does not say who it was for.
>
> A human is involved. No human is in control."

---

## Optional beats, if a take runs short

Neither of these is worth its own take. Both are worth ten seconds if you need
them, and both are on camera in one shot.

**The community page** (`nextkey.li/blog`). The posts fill themselves in.

> "The same record, used in the open. A post on an ENS name — written by a person
> or by an AI-agent, the same way — which is the public half of the identical
> mechanism."

**The pool.** Over the demo write in take 1, if you cut back to it:

> "Two hundred names set aside for exactly this, on a resolver that can write to
> nothing else."

**Do not show the donation page in the video.** It is a page for people who
already like the project, not an argument for liking it, and a judge who sees an
address on screen is being asked for something at the moment you want them
listening.

---

## If you are over four minutes

Cut in this order, and only in this order:

1. Take 2 down to two sentences. The problem is the least surprising part.
2. The optional `eph` command in take 4.
3. The live-window line at the end of take 3.
4. Take 7's first paragraph. The hash comparison survives; the explanation of
   enclaves can go.
5. Take 6 entirely — painful, but it is the one beat that repeats a point the
   others already make, namely that ENS enforces rather than us.

**Never cut:** the write in take 1, either half of the attack in take 3, the
`open` in take 4, or the two `open` commands in take 5. Those four are the whole
argument, and take 3 is the one that is new.

---

## If you are under two minutes

You are talking too fast. Slow down rather than adding material — a judge watching
thirty of these notices pace before content.

---

## What the video must not do

**Do not overstate what v2 hides.** The grant records are visible; text records
can be listed from their events — our own explorer lists them, on screen, in take
3. What cannot be determined is which record belongs to whom, or whether a given
person has access at all. Say that, precisely — a judge who knows ENS will check,
and the precise claim is strong enough on its own.

**Do not claim the explorer is exhaustive.** It searches back as far as a public
endpoint will let a browser walk, and it prints how far that was. If a judge asks
what happens beyond that: an indexer, which a page served from static files does
not have, and the page says so rather than implying completeness.

**Do not claim guardians exist.** They are a shape in a fixture. The honest
phrasing is *"the rule counts guardian approvals; the guardian layer itself is a
fixture in this build."*

**Do not mention World** unless the flow works by then. If access never arrived,
say nothing at all — silence reads as focus, a half-built integration mentioned in
passing reads as padding.

**Never say** "military grade", "unhackable", or "your secrets are safe with us".
The last one is the opposite of the design.

**Do not explain the lent wallet's key in take 1.** It is published deliberately,
disclosed on the page and in the README, and it owns nothing. But explaining
"there is a private key in this web page" during the opening thirty seconds hands
a judge a doubt to chew on at the exact moment you want them leaning in. If it
comes up in questions, the answer is one sentence: it owns nothing, it can write
records on names set aside for it, and the disclosure is on the page.
