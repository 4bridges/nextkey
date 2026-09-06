# Developer Experience Feedback — Ledger tooling

Collected while building **NextKey** at ETHGlobal ETHOnline 2026. Solo developer,
Node.js ESM project on Windows, Nano X with the Ethereum app.

Ledger's submission criteria ask for tooling feedback, so this is written as we
hit each thing rather than reconstructed afterwards — the same habit we kept for
ENS and Chainlink.

---

## 1. The ESM build cannot be imported by Node

`@ledgerhq/hw-transport-node-hid` and `@ledgerhq/hw-app-eth` ship a `lib-es/`
build that `package.json` exposes under the `import` condition. Its relative
imports are written without file extensions:

```js
// @ledgerhq/errors/lib-es/index.js
import { createCustomErrorClass, … } from "./helpers";
// @ledgerhq/hw-transport-node-hid/lib-es/TransportNodeHid.js
import { listenDevices } from "./listenDevices";
```

Node's ESM resolver requires extensions on relative specifiers, so any ESM
project that writes

```js
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid'
```

fails at import with:

```
Cannot find module '…/@ledgerhq/errors/lib-es/helpers'
imported from …/@ledgerhq/errors/lib-es/index.js
```

**Why this costs more time than it should.** The message names a missing *file*.
Nothing in it suggests the module format is the problem, so the natural first
guesses are a failed install or a broken native build — both plausible here,
since `node-hid` is compiled. We spent our first attempt looking at the wrong
layer entirely.

**The workaround** is to reach for the CommonJS build deliberately:

```js
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const TransportNodeHid = require('@ledgerhq/hw-transport-node-hid').default
```

**The fix** is one flag: emitting the ESM build with extensions (`"./helpers.js"`)
would make the packages import cleanly. Until then, a line in the docs saying
"ESM consumers must use `createRequire`" would save every ESM project the same
hour.

---

## 2. `node-hid`'s install script is blocked by hardened npm defaults

npm configurations that gate install scripts — increasingly the default in
security-conscious setups — silently skip the step that fetches `node-hid`'s
prebuilt binary:

```
npm warn allow-scripts 3 packages have install scripts not yet covered by allowScripts:
npm warn allow-scripts   node-hid@2.1.2 (install: prebuild-install --runtime napi || node-gyp rebuild)
```

The install *succeeds*, and the failure surfaces later as a missing binding. Not
Ledger's bug, but Ledger's users hit it, and a sentence in the getting-started
page — approve the script, or `npm rebuild node-hid` — would cover it.

---

## 3. EIP-1024 encodings are hex, and nothing says so

`getEIP1024PublicEncryptionKey` returns `{ publicKey }` as a **hex** string, and
`getEIP1024SharedSecret` both takes the remote public key and returns the secret
as hex. The JSDoc example passes a hex argument, so the input can be inferred;
the return encoding is stated nowhere we could find.

We assumed base64 — the convention MetaMask's `eth_getEncryptionPublicKey` uses
for the same EIP — and got a **48-byte value with no error**, because 64 hex
characters are valid base64. The failure surfaced two calls later inside a curve
library:

```
RangeError: "uCoordinate" expected Uint8Array of length 32, got length=48
```

A wrong-length key that decodes cleanly is the expensive kind of mistake: had we
been slightly less lucky, it would have produced a working-looking grant that no
recipient could open.

Two cheap fixes: name the encoding in the method documentation, and have the
library reject a remote public key that is not 32 bytes rather than passing it
to the device.

---

## 4. `0x6985` says "denied by the user" when nothing was shown to the user

`getEIP1024SharedSecret(path, remoteKeyHex, boolDisplay)` fails with

```
Ledger device: Condition of use not satisfied (denied by the user?) (0x6985)
```

when `boolDisplay` is `false`. The device is not reporting a rejection — it
refuses to perform key agreement *at all* without a confirmation prompt. No
prompt was ever displayed, so there was nothing to deny.

The parenthetical is a reasonable guess for `0x6985` in general and a misleading
one here. It sent us looking at the device screen for a prompt that had not been
requested, and then at the app version, before the real cause turned up.

Two suggestions. Reject `boolDisplay: false` for this method in the library,
since the device cannot honour it — a client-side error naming the parameter
would be unambiguous. And say in the documentation that key agreement always
requires user approval.

**The behaviour itself is right, and worth saying clearly.** That a Ledger will
not compute a decryption secret unless a person is holding it and presses a
button is precisely the guarantee that makes a device-backed recipient stronger
than a key file. Only the error message is wrong.

## What worked well

**EIP-1024 on the device is the reason this project can use a Ledger at all.**
`getEIP1024PublicEncryptionKey` and `getEIP1024SharedSecret` expose an X25519
public key and perform the ECDH *on the device*. We had expected to have to
derive an encryption key from a deterministic signature — a known trick with a
caveat we would then have had to write down and defend.

Instead the device does real key agreement, so a Ledger holder is simply a
NextKey recipient: they publish their X25519 public key in an ENS text record,
senders wrap to it exactly as they would for a software key, and the private
half never exists off the device. **Not one line of the sending path had to
change.** That is the mark of a primitive at the right level of abstraction, and
it deserves to be more prominent than it is — we found it by listing the methods
on `Eth.prototype`, not from the documentation.

And the mandatory confirmation described in finding 4 turns a cryptographic
property into a human one: a secret shared with a Ledger holder cannot be opened
by malware on their laptop — only by them, deliberately, with the device in
hand.

And the mandatory confirmation on key agreement (finding 4) turns a
cryptographic property into a human one: a secret shared with a Ledger holder
cannot be opened by malware on their laptop, only by them, deliberately, with
the device in hand.

<!-- Further entries as we build. -->
