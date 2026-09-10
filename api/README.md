# The NextKey API

A read-only window onto the chain, for people and agents with no RPC endpoint
of their own.

```
GET  /demo/v1/health
GET  /demo/v1/name/anna.nextkey.eth
GET  /demo/v1/id/anna.nextkey.eth
GET  /demo/v1/openapi.json
```

The network is a path prefix, exactly as on `nextkey.li`: `/demo/v1` reads the
hackathon deployment on Sepolia, `/v1` is reserved for mainnet and answers 501
with the address that does work — not 404, which would read as a spelling
mistake.

## What it is not

It holds no key, signs nothing, writes nothing, and is never shown a plaintext.
Everything it returns is already public on chain and readable without it: the
pages read the chain directly from the visitor's browser, and
`scripts/nextkey.mjs` does too. Take this away and nothing stops working. It is
a convenience for callers who cannot reach a node, not a component the product
depends on — and that is deliberate, because a system whose confidentiality
rests on a server we run would be a different product.

## What it costs, said plainly

NextKey ran no server at all until this existed. A caller who uses this
endpoint is telling *us* which name they are looking up, on top of telling the
node. So there is nowhere for that to be written down: no request log, no
analytics, no KV, no D1, no R2 — see `wrangler.toml`, where the absence is the
configuration. No API keys either, so there is nothing to correlate lookups
with even in principle.

The residue we do not control: Cloudflare's own edge logs. That is in the
privacy notice rather than left out of it.

## Two kinds of "no"

"This name publishes no key" and "the node did not answer" are different
statements and never share a status code. The first is `404 no_published_key`
and is a fact about the chain. The second is `502 upstream_unavailable`, says
in its own message that it tells you nothing about the name, and is never
cached. This repository has already shipped that confusion once — a scanner
that reported "no events found" when all forty-five of its requests had been
refused — and it is in `docs/decisions.md` twice.

A third exists because the chain permits it: `422 key_not_x25519`, for a name
whose `nextkey.pubkey` holds something that is not a 32-byte key. Anyone may
write any string to their own record, and inventing a NextKey ID for one would
put a confident, checkable-looking identifier under a value that identifies
nobody.

## Deploying

```
npm run api:dev         # builds, then runs against the real Sepolia on localhost
npm run api:deploy      # builds, then publishes
```

Both pass `-c api/wrangler.toml`, because the config is not in the repository
root. Run `wrangler` from the root without it and it reports a missing entry
point — which sends you looking for a problem in the worker rather than in the
path. `main` inside the file is resolved relative to the file, not to where you
ran the command.

Try it against the live chain once it is up:

```
http://localhost:8787/demo/v1/health
http://localhost:8787/demo/v1/id/anna.nextkey.eth
```

`502 upstream_unavailable` there means the node did not answer and says so in
its own message. It is not a statement about the name.

`wrangler.toml` has `no_bundle = true`: esbuild produces the deployed bytes
with the same pinned version the site's bundles use. Two bundlers producing the
artefact is one bundler too many.

The first deploy publishes to `nextkey-api.<your-subdomain>.workers.dev`. Point
the Sandbox page at whichever address it is:

```
web/src/sandbox.js  →  const API_DEFAULT = '…'
```

and `?api=` on that page overrides it, so a deployment can be checked before it
is written into anything.

Once `api.nextkey.li` exists as a DNS record, uncomment the `[[routes]]` block.
