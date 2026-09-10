# Testing the two receive lanes by hand

Everything below is a thing a person does with a wallet open. The automated
suites cover what can be checked without one — 87 of them on the playground
alone — and they cannot press a button in MetaMask. Every defect this project
found in the last week was found here, not there: two names for one wallet, a
claim link that scrolled off screen, a panel that said *sealed* above an eye
that still revealed the passphrase.

Read the two warnings first. The rest is a walk through the page.

---

## Before you start

**A claim cannot be undone, and a wallet gets one name for ever.** Not one per
day, not one per session — one, enforced by the contract, with no operator
function to reset it. So every test below that reaches a real claim **spends an
address**. Plan the accounts before you start, not after.

**Prepare four accounts in MetaMask**, on Sepolia, and label them:

| Label | For | Needs Sepolia ETH |
|---|---|---|
| `nk-claim-1` | the happy path, desktop | yes, ~0.01 |
| `nk-claim-2` | the happy path, mobile | yes, ~0.01 |
| `nk-lent` | the lent-name lane | no |
| `nk-broke` | the no-gas case | **no — deliberately empty** |

The lent lane spends a name from a pool of 200 rather than an address, so
`nk-lent` can be reused. The two claim accounts cannot.

**Where things are:**

- page: `https://nextkey.li/demo.html`
- registrar: `0xc3b7a8b73ed7022a594f236e60d33f5cc61b1863`
- how many names are left: `node --env-file=.env scripts/deploy-names.mjs show 0xc3b7a8b73ed7022a594f236e60d33f5cc61b1863`

Run that last command before and after the session. `minted` should have gone up
by exactly the number of successful claims you made. If it moved by more, a
button fired twice — which is the defect the guard flag exists to prevent and
worth a bug on its own.

---

## Desktop, with an extension wallet

### 1 · The page before anything is pressed

- [ ] **Both lanes are visible without scrolling past one to find the other**, and *Make me receivable* comes first.
- [ ] The second section says what it costs — Sepolia ether — **before** you touch anything.
- [ ] The input has no example text in it. An example reads as a suggestion, and a suggestion in a field that spends your one allowance is a trap.
- [ ] `.nextkey.eth` is visible beside the field. Nobody should have to guess the ending or type it themselves.

### 2 · A name that cannot work, with no wallet connected

Type `not a name` (with the spaces) and press the button.

- [ ] It is refused **without MetaMask opening at all**.
- [ ] The message says which characters are allowed.
- [ ] The button is still pressable and the field still editable — a refusal must not lock you out of correcting it.

Now clear the field and press again.

- [ ] It asks for a name rather than guessing one.

### 3 · The lent lane, with `nk-lent`

- [ ] MetaMask asks for a **signature**, not a transaction. The dialog must not mention gas or a fee.
- [ ] Read the message it shows you. It should say in plain words that it moves nothing and costs nothing.
- [ ] Afterwards the section names the pool name you were given, and the button is disabled.
- [ ] Press it again anyway — nothing should happen.

Now **reload the page and press it again with the same account.**

- [ ] It says you already have a name and names the same one. Nothing is written and no second name is spent. *This is the check that caught `hero150`/`hero02` — one wallet holding two names — so do not skip it.*

### 4 · The claim, with `nk-claim-1`

Choose a label nobody will have taken. Press the button.

- [ ] First MetaMask asks for a **signature** (the identity key).
- [ ] Then it asks for **one transaction** — one, not two. The name and the key are written together.
- [ ] The transaction is addressed to `0xc3b7…1863`, not to the registry and not to the resolver.
- [ ] While it is pending the page says so rather than looking dead.

After it confirms:

- [ ] The panel says the name is yours and shows the name, your address as owner, and the published key.
- [ ] The transaction link opens Etherscan **in a new tab**, and the page you were on is still there behind it.
- [ ] The section above now also says you are receivable — at the new name, not at a pool name.
- [ ] Both buttons are disabled and the label field is locked. There is nothing left to press twice.

Then check it from the outside:

- [ ] `https://nextkey.li/explorer.html` shows the write.
- [ ] The recipient field in step 2 accepts your new name and finds a key on it.

### 5 · The second claim, same account

Reload, type a different label, press.

- [ ] It says this wallet already has a name, and names it.
- [ ] **No wallet dialog opens** — the contract is asked before you are asked to sign.

### 6 · A name somebody already holds

Use `nk-claim-2` and type the label `nk-claim-1` just took.

- [ ] It is refused, and the message explains that nothing can take a name from whoever holds it — including us.
- [ ] No transaction was sent. Nothing was paid for the answer.
- [ ] Correct the label to a free one and it goes through. `nk-claim-2` is now spent — do this step on the account you meant to spend.

### 7 · No gas, with `nk-broke`

- [ ] The signature still works.
- [ ] The transaction fails or MetaMask refuses to send it, and the page says something a person can act on rather than printing a stack trace.
- [ ] The button is pressable again afterwards.

---

## Mobile

Do this in a **wallet's own browser** (MetaMask → Browser, or Rainbow), not in
Safari or Chrome — mobile browsers carry no wallet.

Repeat sections 1, 3 and 4 with `nk-claim-2`, and watch for the things that only
go wrong on a small screen:

- [ ] The two sections do not overlap and nothing runs off the right edge. Turn the phone sideways too.
- [ ] The label field is wide enough to read what you typed, and `.nextkey.eth` has not wrapped onto its own line.
- [ ] **After each press, the message appears where you can see it** without scrolling up or down to find it. This is the one that was wrong before: the page jumped and the answer was off screen, so it looked like the button had done nothing — and the obvious response is to press it again.
- [ ] Coming back from the wallet's confirmation screen lands you on the page in the state you left it, not at the top.
- [ ] The long addresses and the key wrap instead of forcing the page sideways.

Then, in Safari or Chrome **without** a wallet:

- [ ] Pressing either button offers links to reopen the page inside a wallet.
- [ ] Those links carry `demo.html` and the language you were reading in.

---

## Languages

Open `demo.html?lang=de`, and one right-to-left language: `demo.html?lang=fa`.

- [ ] Both sections are fully translated — headings, paragraph, button, the cost note. Nothing shows an English sentence.
- [ ] Press with a bad label: the refusal is in that language too.
- [ ] In `fa` the layout mirrors, and `.nextkey.eth`, the addresses and the key stay in Latin script and read left to right.

The strings to watch are the twenty added on 10 September. They fall back to
English silently when a translation is missing, which is correct behaviour and
also the reason a missing one is invisible — the *Make me receivable* section ran
in English in all nine languages for a day before anyone noticed.

---

## When something fails

Capture these four things before trying anything else. Every debugging session
this week was shortened by having them and lengthened by not having them.

1. **A screenshot of the page**, including the panel with the message in it.
2. **The browser console** — the whole thing, not the last line.
3. **The transaction hash**, if one was sent, or the wallet's error if it refused.
4. **What you typed and which account you were on.**

And do not repeat a failed claim on the same account before reporting it. If it
half-succeeded — the name registered, the record missing — pressing again turns
one clear bug into two states nobody can tell apart afterwards.
