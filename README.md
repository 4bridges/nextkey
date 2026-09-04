Repository initialized on September 3 with scaffolding only (README stub, .gitignore, MIT license). 
All project work begins at the official kickoff on September 4 — see commit history.

NextKey - Hand over seed phrases and credentials under rules no human can bypass.

Description:
NextKey hands secrets over to the people who should get them 
— under rules nobody can bypass, not even us.

You place a secret: a seed phrase, a credential, a document. 
You define who may open it and under what conditions. 

Access is enforced by ENSv2 — sharing with someone means granting 
a read permission on your own permissioned resolver, addressed by 
their ENS name instead of a hex address. 

Release conditions such as a guardian quorum, a time lock or prolonged 
inactivity are evaluated inside a trusted execution environment, 
so the secret never passes a node anyone can inspect. 

And when someone has lost everything, recovery doesn't depend on a backup file: 
their guardians confirm, and World's Selfie Check proves that a unique, 
living person is asking.

A human takes part at every step. 
No human is in control.

How it's made:
NextKey is built around a simple inversion: access control is not a table in our backend, 
it is state in a public registry that the user owns.

ENSv2 on Sepolia carries that state. Every user's account has its own Permissioned Resolver, 
and we use its per-record permissions as the access layer: one record per shared secret, 
holding the ciphertext pointer and the read permission for the recipient's name. 

Granting access is a resolver write, revoking it is a resolver write, and auditing 
who can see what is a read — no server is authoritative, and if NextKey disappeared 
tomorrow the permissions would still be there. 

The same resolver holds each user's 
notification preferences, which is why our messaging layer can reach a recipient 
without ever asking them to register: we resolve their name, read the channel 
they declared, and deliver there.

Secrets themselves are encrypted client-side before they leave the browser; 
the ciphertext goes to decentralized storage and only the pointer and the 
key material governed by the resolver ever touch the protocol layer.

Release conditions run in a Chainlink CRE Confidential Workflow. 
A guardian quorum, a time lock or an inactivity trigger is evaluated 
inside a TEE, with the secret material fetched and decrypted only 
inside the enclave. 

This is the part we care most about architecturally: 
it is what lets us claim that no operator — including us — can observe 
a secret in transit, rather than merely promising not to look.

Recovery uses World's Selfie Check as a risk signal rather than as a login. 
Guardians vouch for the request, and Selfie Check establishes that a unique, 
live human is behind it, which closes the hole every social-recovery scheme has: 
an attacker who can pressure or replay their way through the guardian step 
still cannot be two different people.

The pieces are deliberately load-bearing rather than decorative. 
Remove ENSv2 and there is no access control. 
Remove the enclave and the release conditions become a promise. 
Remove Selfie Check and recovery becomes the weakest link in 
a product whose entire purpose is not having a weakest link.
