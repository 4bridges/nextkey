/**
 * ENSv2 hackathon deployment on Sepolia — ETHOnline 2026.
 *
 * Source:  https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta
 * Retrieved: 2026-09-04
 *
 * These are NOT the production ENS addresses. ENS runs a dedicated deployment
 * for this hackathon, and the docs are explicit that projects must build
 * against these. The deployment is in active development and state may be
 * reset periodically — the app warns that the most recent redeployment was
 * 2026-07-30. If resolution suddenly stops working, re-check this page before
 * debugging your own code.
 */
export const ENSV2_SEPOLIA = {
  upgradableUniversalResolverProxy: '0xd26f2040d083af1cd2962ba303f4bea0c4faf142',
  universalResolverV2:              '0xfea8d4b7fcce0b8765c793d6695eac384aaa458f',
  batchRegistrar:                   '0xc8efa80d9f645b26bacd1bae8638492df3bae8ca',
  contractNamer:                    '0x21a2b577709727119f1901314e0ba0150eafa15e',
  ensV1Resolver:                    '0x1f11e5b8bca2ccfe13bd8431853db159c4e9849c',
  dnsTldResolver:                   '0x10107255fda20ab6c37a0efca1e9465f25066a00',
  dnsTxtResolver:                   '0x0ebc944ac29f91cc24ee507a2d46aa4901bbc748',
  dnsAliasResolver:                 '0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6',
  dnssecGatewayProvider:            '0xfedb5c2fea17cef8547d534c3125f7601d3e30bd',
  defaultReverseRegistrarAdapter:   '0x0a8d7ed4061548fb3cb192d0cbe9e1a57b3b1ae9',
}

/**
 * The address viem ships for Sepolia. If resolution ever returns null for a
 * name you know exists, compare against this: hitting it means the override
 * below did not take effect and you are querying the production deployment.
 */
export const VIEM_DEFAULT_SEPOLIA_UNIVERSAL_RESOLVER =
  '0xc8Af999e38273D658BE1b921b88A9Ddf005769cC'

/** Text record keys NextKey uses. Kept here so the app and the spikes agree. */
export const NEXTKEY_RECORDS = {
  /** X25519 public key of the account, so others can encrypt for it by name. */
  publicKey: 'nextkey.pubkey',
  /** Where this account wants to be notified. */
  notify: 'nextkey.notify',
}
