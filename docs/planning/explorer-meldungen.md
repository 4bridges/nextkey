# Explorer — alle Meldungen, zum Überschreiben

Das Englische ist das Original: was hier steht, ist der Text im Quelltext, und die
neun Übersetzungen werden daraus nachgezogen. Schreib deine Fassung einfach in die
Zeile **neu:** — leer lassen heisst „bleibt wie es ist“. Deutsch oder Englisch, wie
es dir leichter fällt; ich setze beides um und ziehe die neun Sprachen nach.

Der Schlüssel in Klammern ist meine Adresse dafür, den brauchst du nicht anzufassen.


## 1 · Das Live-Fenster — Zustand und Hinweise

**`x.feed.reading`**

alt: Reading everything NextKey has written…

neu: 

---

**`x.feed.living`**

alt: Live

neu: 

---

**`x.feed.paused`**

alt: Paused

neu: 

---

**`x.feed.resume`**

alt: Resume

neu: 

---

**`x.feed.pause`**

alt: Pause

neu: 

---

**`x.feed.none`**

alt: Nothing yet in the stretch this page could search.

neu: 

---

**`x.feed.nonehere`**

alt: Nothing of this kind in the stretch this page could search.

neu: 

---

**`x.feed.nonenote`**

alt: If NextKey has written somewhere else on this deployment, this is where to say so: look a name up above, then press Refresh, and the resolver that name actually uses is watched too.

neu: 

---

**`x.feed.refusednote`**

alt: So this is not a quiet chain — it is a request that came back empty-handed. A public endpoint will refuse a range that matches too much, and the fix is to press Refresh, which starts again from the current head.

neu: 

---

**`x.feed.norangenote`**

alt: That is a limit of the public endpoint, not a statement about NextKey. Nothing here is broken and nothing is missing — this one node will not serve log queries at the moment. Press Refresh in a minute.

neu: 

---

**`x.feed.where`**

alt: On

neu: 

---

**`x.feed.readnow`**

alt: read off the name just now

neu: 

---

**`x.feed.readnote`**

alt: The entries without a transaction were read off their names rather than found as events: a record can exist on this deployment without a write event a public node will serve, and a list that only asked for events would leave those out and look complete.

neu: 

---

**`x.feed.showing`**

alt: showing the newest

neu: 

---

**`x.feed.of`**

alt: of

neu: 

---

**`x.feed.partial`**

alt: A grant’s record name is derived, so the node cannot select these — they were picked out of the range above by hand. This is therefore what is in that range, not what exists.

neu: 

---

**`x.feed.exact`**

alt: This filter is asked of the node directly, so it reaches back as far as the search went and misses nothing inside it.

neu: 

---

**`x.f.readonly`**

alt: This name has no creation event a public node will serve, so there is no record id and no exact question to ask about its writes. What stands above is what the name carries now, read one record at a time.

neu: 

---


## 2 · Die Ereignis-Zeilen (was jemand getan hat)

**`x.m.pubkey`**

alt: created a NextKey ID

neu: 

---

**`x.m.eph`**

alt: set up where grants on this name are addressed

neu: 

---

**`x.m.sealed`**

alt: wrapped that key to the owner, so a recipient can be added later without a signature

neu: 

---

**`x.m.secret`**

alt: sealed a text

neu: 

---

**`x.m.secretgone`**

alt: removed the ciphertext

neu: 

---

**`x.m.granted`**

alt: gave access

neu: 

---

**`x.m.revoked`**

alt: took a grant back — the wrapped key is gone, the ciphertext is not

neu: 

---

**`x.m.ack`**

alt: a recipient acknowledged reading it

neu: 

---

**`x.m.post`**

alt: published a post, in the clear

neu: 

---

**`x.m.postgone`**

alt: took its post down

neu: 

---

**`x.m.v1granted`**

alt: granted access under v1 — this address is a hash of the recipient’s public key, so it names them

neu: 

---

**`x.m.v1revoked`**

alt: took back a v1 grant

neu: 

---

**`x.m.other`**

alt: wrote a record

neu: 

---

**`t.id.label`**

alt: NextKey ID

neu: 

---


## 3 · Die Suche im Fenster (Name, Adresse, NextKey ID)

**`x.feed.needname`**

alt: Type a name to see only its writes.

neu: 

---

**`x.feed.finding`**

alt: Finding that name’s record…

neu: 

---

**`x.f.byid`**

alt: A NextKey ID does not run backwards, so this compares it against the key every name here publishes…

neu: 

---

**`x.f.noid`**

alt: No name this page knows publishes that NextKey ID.

neu: 

---

**`x.f.noidnote`**

alt: An ID is a hash over a published key, so it cannot be turned back into one. What this page can do is recognise it — derive the ID of every name it can spell and compare — and the names it can spell are the ones written into its source. An ID on a name from anywhere else is not wrong, it is simply not recognisable from here.

neu: 

---

**`x.f.reversing`**

alt: Asking ENS, then the registrar, which name that address holds…

neu: 

---

**`x.f.noreverse`**

alt: Neither ENS nor the NextKey registrar knows a name for that address.

neu: 

---

**`x.f.noreversenote`**

alt: A name points at an address, and an address points back only when its holder has set a primary name. A lent name has neither: no reverse record and no address record either — measured, not assumed — because it carries one thing only, the key your signature derives. So an address cannot find it and your wallet can, in one signature.

neu: 

---

**`x.f.toid`**

alt: Find your name with your wallet, on the ID tab

neu: 

---


## 4 · Die Historie eines Namens (Log-Abfragen)

**`x.log.reading`**

alt: Reading the resolver’s events…

neu: 

---

**`x.log.norange`**

alt: The node refused every block range this page asked for.

neu: 

---

**`x.log.norangenote`**

alt: That is a limit of the public endpoint, not of the name. The records above came back fine; only the history needs log queries, and this one will not serve them right now.

neu: 

---

**`x.log.refused`**

alt: The node stopped answering partway through.

neu: 

---

**`x.log.refusednote`**

alt: This says nothing about the name. The records above are read directly and are unaffected.

neu: 

---

**`x.log.notinrange`**

alt: No record-creation event in the stretch this page could search.

neu: 

---

**`x.log.notinrangenote`**

alt: The name resolves, so it was created — just further back than a public endpoint will let a browser walk. The records above are read directly and are unaffected.

neu: 

---

**`x.log.scanned`**

alt: Searched back

neu: 

---

**`x.log.blocksfrom`**

alt: blocks from the current head, in steps of

neu: 

---

**`x.log.window`**

alt: Searched

neu: 

---

**`x.log.blocks`**

alt: blocks on

neu: 

---

**`x.log.more`**

alt: showing the twenty most recent of

neu: 

---

**`x.log.empty`**

alt: The name exists on that resolver, but nothing has been written to it.

neu: 

---

**`x.log.how`**

alt: How this is read

neu: 

---

**`x.log.hownote`**

alt: Two log filters and no server: one finds the record id by the name’s namehash, the other reads every text write against that id. The key sits unindexed in the event, so it can be shown in full — which is the only reason a line like “granted access to somebody” can name the record it happened on.

neu: 

---

**`x.log.fail`**

alt: Could not read the events.

neu: 

---

**`x.log.block`**

alt: block

neu: 

---

**`x.log.tx`**

alt: transaction

neu: 

---


## 5 · Ein Name nachgeschlagen (?name=… ) — die Rolle

**`x.reading`**

alt: Reading it from Sepolia…

neu: 

---

**`x.role.recipient`**

alt: This is a recipient. It publishes a key, so anybody can seal a secret to it — no account, no permission, no prior contact.

neu: 

---

**`x.role.recipientnote`**

alt: A grant to this name does not live here. It lives on the name that holds the secret, at an address derived from this key and that name’s ephemeral one. So there is nothing to count on this page, and nothing missing either.

neu: 

---

**`x.role.vault`**

alt: This name is holding a secret. Whoever it was granted to can open it; nobody else can, and the chain does not say who they are.

neu: 

---

**`x.role.vaultnote`**

alt: The grants sit on this name, under derived addresses. That is what the history below shows: each grant appearing, and each one taken back.

neu: 

---

**`x.role.both`**

alt: This name does both: it holds a secret, and it publishes a key so secrets can be sealed to it.

neu: 

---

**`x.role.bothnote`**

alt: Which is ordinary — the two roles are unrelated, and a name that keeps something can also be somebody others write to.

neu: 

---

**`x.role.author`**

alt: This name carries a public post and nothing else NextKey uses.

neu: 

---

**`x.role.empty`**

alt: This name carries none of NextKey’s records. It exists, and as far as this page can tell it has never been used here.

neu: 

---

**`x.role.emptynote`**

alt: That is not a failure: most names on this deployment have nothing to do with us.

neu: 

---

**`x.unreachable`**

alt: Could not reach the chain just now.

neu: 

---

**`x.unreachablenote`**

alt: This says nothing about the name — the request to the Sepolia node did not come back. Try again in a moment.

neu: 

---

**`x.noresolver`**

alt: That name has no resolver on this deployment.

neu: 

---

**`x.noresolvernote`**

alt: Either it is not registered here, or nothing has been attached to it yet. A name you hold on production ENS will not do — this is the hackathon deployment, and it is a separate world.

neu: 

---

**`x.fail`**

alt: Could not read that from the chain.

neu: 

---

**`x.resolver`**

alt: its resolver

neu: 

---

**`x.thepost`**

alt: the post

neu: 

---

**`b.explorer`**

alt: See it in the ENS explorer

neu: 

---


## 6 · Ein Name nachgeschlagen — die einzelnen Records

**`x.nkid`**

alt: The published key, in the form a person can read out and compare. Derived from it and nothing else — no record holds this, and every name that publishes a key has one.

neu: 

---

**`x.pubkey.yes`**

alt: The key everything sealed to this name is wrapped to. Publishing it is the whole of the opt-in.

neu: 

---

**`x.pubkey.no`**

alt: Nothing can be sealed to this name yet — there is no key to wrap to.

neu: 

---

**`x.eph.yes`**

alt: Written once and never replaced. Every grant on this name is addressed from this one public key and a recipient’s — which is why the addresses cannot be guessed from anything public.

neu: 

---

**`x.eph.v1`**

alt: This name holds a secret under v1, so its grants sit at nextkey.grant.<hash of the recipient’s key> — an address anybody can compute. That is the flaw v2 was built to fix, and you can try it below.

neu: 

---

**`x.sealed.yes`**

alt: The ephemeral key, wrapped to the owner, so a recipient can be added later without a signature. Useless to anybody else.

neu: 

---

**`x.sealed.no`**

alt: No wrapped copy. Adding a recipient later means re-deriving that key from a signature — deterministic, but it needs the wallet.

neu: 

---

**`x.secret.yes`**

alt: The ciphertext, public by design. Reading it teaches nothing: it is AES-256-GCM under a key that is not on the chain. Nor does its length — the secret is padded to a fixed block before sealing, so a passphrase and a short message come out the same size. A very long secret still lands in a higher block, so the length is coarse rather than absent.

neu: 

---

**`x.secret.no`**

alt: No ciphertext here — the name carries the addressing but not the payload.

neu: 

---

**`x.post.yes`**

alt: A public post, in the clear — the one record here meant to be read.

neu: 

---

**`x.post.no`**

alt: Nothing published on this name.

neu: 

---

**`x.grants`**

alt: grants

neu: 

---

**`x.grants.elsewhere`**

alt: not on this name

neu: 

---

**`x.grants.unknown`**

alt: not countable from here

neu: 

---

**`x.grants.elsewherenote`**

alt: Grants to this name are records on whichever names hold the secrets. Look one of those up to see them — and note that even there, nothing says they are this name’s.

neu: 

---

**`x.grants.note`**

alt: Grant records are named after a derived tag, so this page cannot ask for them by name. An indexer over the resolver’s events could count them; nothing could say whose they are.

neu: 

---

**`x.present`**

alt: present

neu: 

---

**`x.absent`**

alt: absent

neu: 

---

**`x.chars`**

alt: characters

neu: 

---


## 7 · „Kann ein Beobachter sehen, wer Zugriff hat?“

**`x.check.needname`**

alt: Name somebody to look for.

neu: 

---

**`x.check.reading`**

alt: Reading their published key…

neu: 

---

**`x.check.nokey`**

alt: That name publishes no key, so there is nothing an observer could compute from it.

neu: 

---

**`x.check.v2`**

alt: Nothing to look at.

neu: 

---

**`x.check.v2p`**

alt: This name is v2. A grant to that person would live at an address derived from the shared secret between this name’s ephemeral key and their private key — and the private half is theirs. With every public value on this page in hand, an observer cannot compute the address, cannot test a guess, and cannot tell whether this name grants to them at all.

neu: 

---

**`x.check.what`**

alt: What was tried

neu: 

---

**`x.check.v2note`**

alt: The published key was read and the v1 address was deliberately not computed, because on a v2 name it would point nowhere. There is no query that closes this gap: the missing input is a private key, not a lookup.

neu: 

---

**`x.check.found`**

alt: Found it — and that is the problem.

neu: 

---

**`x.check.empty`**

alt: That address is empty on this name.

neu: 

---

**`x.check.computed`**

alt: the address an observer computes

neu: 

---

**`x.check.andthere`**

alt: and what is there

neu: 

---

**`x.check.nothing`**

alt: nothing

neu: 

---

**`x.check.foundnote`**

alt: This is a v1 name, and its grant address is a hash of the recipient’s published key — a public value. So anybody who knows that key can prove this person has access, without any private key at all. The ciphertext was never the leak; the record name was. That is the whole reason v2 exists.

neu: 

---

**`x.check.emptynote`**

alt: This is a v1 name and the address was computable, but nothing is there: this person was never granted access, or it was withdrawn. Note that an observer learns which of the two it is — nothing.

neu: 

---

