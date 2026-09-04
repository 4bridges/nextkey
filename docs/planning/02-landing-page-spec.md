# Landing page specification — nextkey.li

*Planning artifact, written 3 September 2026, before the kickoff. Content, structure and copy only — no markup, no CSS, no assets. Originally drafted in German; presented here in English.*

## The one job

`nextkey.li` is both the marketing page and the demo link in the ETHGlobal submission. That is a conflict, and it is resolved in favour of the judges: someone opens the page, has perhaps two minutes, and must understand what NextKey does and reach a working demo in that time.

From which follows the hardest rule for the page: **the primary action is visible in the first screen and leads into a prepared demo state**, not an empty form. No scrolling, no sign-up, no wallet connection as the first hurdle. Whoever clicks "Open the demo" immediately sees an example secret already shared with an example name, and can act from there. An empty state demonstrates nothing, and that is where hackathon demos routinely lose points.

Second audience, later: people arriving through search or a language model. Section 6 is built for them.

## Sections

**1 — Hero.** Eyebrow `NextKey`. H1: *Hand over a seed phrase without handing over control.* Subline: *NextKey shares secrets by ENS name, releases them by rules, and restores access with proof of humanness. A human is involved. No human is in control.* Primary action **Open the demo**, secondary **View on GitHub**. Below them, one small line: `Prototype · ENSv2 on Sepolia testnet · Built at ETHGlobal ETHOnline 2026`. That line sits at the top deliberately: for a security product, early honesty is a trust signal rather than a cost. No full-viewport hero — the next section must be visibly beginning at the fold.

**2 — The problem.** Three sentences. Today a seed phrase lives on paper in a drawer, in a password manager somebody else operates, or in a message you regret sending. All three fail the same way: the moment someone else needs it, either nobody can reach it or the wrong person already has. The missing piece was never storage — it was deciding who may open something, and when.

**3 — How it works.** A genuine sequence, therefore numbered; the numbering carries information rather than decoration. Place a secret, encrypted in the browser · share it with a name, not an address · the recipient hears about it through the channel she declared in her own ENS records · if she loses everything, guardians confirm and Selfie Check proves a unique living person is asking · some releases happen without you, proposed by an agent and decided in an enclave against rules you wrote.

**4 — What is different.** Three points, each naming a common solution and what NextKey does instead. *Access is a protocol, not our database* — permissions live in an ENSv2 registry you own; revoke them and they are gone whether or not NextKey still exists. *Recovery asks whether you are a human, not whether you kept a file* — social recovery breaks when an attacker can pressure guardians or replay a request. *The agent proposes, a rule disposes* — automation is useful right up to the moment it can act alone.

**5 — Under the hood.** For technical readers and sponsor judges: three short blocks on ENSv2, World ID Selfie Check and Chainlink CRE, each linking into the code.

**6 — FAQ, the GEO layer.** Questions worded the way people actually ask them, each answer opening with an independently quotable sentence — that is what a language model later extracts. *How do I safely pass on my seed phrase to someone? · What happens to my crypto if I die or lose access? · Is social recovery actually safe? · Can I share a password without both of us using the same password manager? · Does NextKey ever see my secrets? · What is an ENS name and do I need one? · Is this ready to use with real funds?* — the last one answered with an unambiguous no.

**7 — Status and footer.** A clearly separated box, not fine print: *Status: prototype. Built during ETHGlobal ETHOnline 2026, running on the ENSv2 beta on Sepolia testnet. Not audited. Do not put a seed phrase you actually rely on into it.* Footer: GitHub · ETHGlobal project page · MIT license · contact.

## SEO and GEO

`<title>` under 60 characters: *NextKey — hand over secrets by ENS name*. Meta description under 155: *Share a seed phrase or credential with someone by their ENS name. Access ends when you say. Recovery proves a living human, not a backup file.*

Exactly one `<h1>`, one `<h2>` per section, FAQ questions as `<h3>`. JSON-LD `FAQPage` and `SoftwareApplication`, both small and truthful — no invented ratings, no `aggregateRating`. Open Graph and Twitter Card with a real image; until that image exists the field stays empty rather than holding a placeholder. English, `lang="en"`.

What actually carries discoverability is not keyword density but that the page answers a question nobody else answers clearly: how to hand a seed phrase to a person without having to trust them.

## Honesty limits

This page markets a security product. Overstatement here is not merely tasteless, it is an attack vector on users.

**Must not appear:** invented user numbers · "trusted by" logos without basis · testimonials from people who do not exist · security badges or audit seals for audits that never happened · claims of being "unhackable" or "military grade" · a newsletter form nobody reads.

**Must appear:** the testnet note in the first screen · the status box before the footer · the statement that NextKey never sees secrets in the clear, without inflating it into an absolute guarantee.

## Visual direction

In prose, so that nothing is predetermined that is better decided on screen. The product is about custody and handover, not speed or yield — so no gradient heroes, no glow, no crypto neon. The feel of a well-made tool: calm ground, clear typographic hierarchy, generous whitespace, and a single strong accent reserved for the primary action and the release moment. One image would earn its place: the handover itself, from one name to another, with the condition in between. If there is no time for it, the space stays empty rather than holding a stock photo. Both colour schemes are served.

## Technical constraints

Static build, SFTP to Cyon. Cyon runs Apache, so an SPA route needs an `.htaccess` rewrite to `index.html` — otherwise a direct call to `/demo` returns 404. **Test this on Friday, not on Saturday.** All paths relative. Fonts self-hosted or with a robust fallback. The page must remain readable without JavaScript; the demo may require it, the explanation may not.

## Build order

The landing page does **not** come before the core path. Sections 1, 3 and 7 on Friday as a plain static page, so the demo link shows something from the start. The rest in the following week, once it is clear what the product actually does — then the copy matches reality instead of running ahead of it.
