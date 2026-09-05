/**
 * ENSv2 hackathon deployment on Sepolia — ETHOnline 2026.
 *
 * Source:  https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta
 * Retrieved: 2026-09-05 (full table; an earlier partial copy of this file was
 *            missing the registry, registrar and factory addresses)
 *
 * These are NOT the production ENS addresses. ENS runs a dedicated deployment
 * for this hackathon and the docs are explicit that projects must build against
 * these. The deployment is in active development and state may be reset
 * periodically — the app warns that the most recent redeployment was
 * 2026-07-30. If resolution suddenly stops working, re-check that page before
 * debugging your own code.
 */
export const ENSV2_SEPOLIA = {
  // --- Resolution ---------------------------------------------------------
  upgradableUniversalResolverProxy: '0xd26f2040d083af1cd2962ba303f4bea0c4faf142',
  universalResolverV2:              '0xfea8d4b7fcce0b8765c793d6695eac384aaa458f',
  managedUniversalResolverProxy:    '0x1abed09f1f36383f27cf0b3a5e0ea1738e1fd921',

  // --- Registries ---------------------------------------------------------
  rootRegistry: '0xe7f0d5724f8337e3aa9a9910540341ff4273fed9',
  /** The ".eth" registry — "root registry 0x1d78…971e" in the explorer. */
  ethRegistry:  '0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e',

  // --- Registration -------------------------------------------------------
  ethRegistrar:            '0x7d1b7f586a62ac3f54b9a396849757814283270b',
  batchRegistrar:          '0xc8efa80d9f645b26bacd1bae8638492df3bae8ca',
  rootBatchRegistrar:      '0x9b30da91c1a3fb972d5a7d102390598d5ca70376',
  standardRentPriceOracle: '0xfeba6589b5c1b35875c0389ccedf83148b6ee71b',

  // --- Deploying your own registry / resolver -----------------------------
  verifiableFactory:       '0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780',
  permissionedResolverImpl:'0xa9d3814ab151bf6e37a427432795371a8361614e',
  wrapperRegistryImpl:     '0x7c53b9dcef516662e9e8a229448cac30b90673cd',
  /**
   * The docs call this USER_REGISTRY_IMPL and the deployment table does not
   * list it. Recovered empirically from the VerifiableFactory's ProxyDeployed
   * events on 2026-09-05 (scripts/find-registry-impl.mjs): the one
   * implementation being proxied that is *not* the resolver.
   * Example deployment: sepolia.etherscan.io/tx/0x711176dfd824996e4650a35fc0cd043d104fa4d3afbd1ac3ead0d4c190eae631
   */
  userRegistryImpl:        '0x47b442d0cf617c41cabaff5f02f44dd1e5f72546',

  // --- Resolvers ----------------------------------------------------------
  ensV2Resolver:    '0xb1b2d8c4d4886d0d567b6a6b8a4b885229fafae4',
  publicResolverV2: '0xf9de4979ddb290baf5b760d0e788125017bc33f6',
  ensV1Resolver:    '0x1f11e5b8bca2ccfe13bd8431853db159c4e9849c',

  // --- Payment tokens -----------------------------------------------------
  //
  // Read this before wondering why a registration says you have no balance.
  //
  // The deployment uses its OWN mock tokens. Circle's Sepolia USDC — the one
  // every faucet hands out, including ETHGlobal's — is a DIFFERENT contract and
  // is invisible to the registrar. Holding 1,000 of the wrong USDC looks
  // identical to holding none.
  mockUSDC: '0xcbfd80f74375c54e545af34788ff465f96f66f05',
  mockDAI:  '0x93403a98c3a6be906585cd0d68447c0fc600fb38',

  // --- Chain abstraction (the layer the manager app registers through) -----
  hcaOwnerAndSessionValidator: '0xeb099163a41912a94e56b2143feb6eb7979a51f0',

  // --- Other --------------------------------------------------------------
  labelStore:     '0xd7351f76866123a7e49381f38a30a96adba7e855',
  ethRenewerV1:   '0x47bc0ab8f87db01383255e564cce92956ecc7c70',
  contractNamer:  '0x21a2b577709727119f1901314e0ba0150eafa15e',
}

/**
 * The address viem ships for Sepolia. If resolution ever returns null for a
 * name you know exists, compare against this: hitting it means the override
 * did not take effect and you are querying the production deployment.
 */
export const VIEM_DEFAULT_SEPOLIA_UNIVERSAL_RESOLVER =
  '0xc8Af999e38273D658BE1b921b88A9Ddf005769cC'

/** Circle's Sepolia USDC — deliberately listed so it can be told apart. */
export const CIRCLE_SEPOLIA_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'

/** Text record keys NextKey uses. Kept here so the app and the spikes agree. */
export const NEXTKEY_RECORDS = {
  /** X25519 public key of the account, so others can encrypt for it by name. */
  publicKey: 'nextkey.pubkey',
  /** Where this account wants to be notified. */
  notify: 'nextkey.notify',
}
