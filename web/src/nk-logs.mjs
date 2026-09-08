/**
 * Reading the resolver's events — the part the explorer and the blog share.
 *
 * Both pages ask the same chain the same two questions: what was written, and
 * to which record. Until now only the explorer knew how, and the blog was about
 * to grow a second copy of the topic hashes. Two copies of a constant that must
 * agree is a bug with a delay on it: the day one is corrected and the other is
 * not, one page goes quietly blank and nothing says why.
 *
 * The hashes were read off the deployment rather than guessed —
 * scripts/probe-events.mjs is what produced them — because a wrong topic
 * matches nothing, and matching nothing looks exactly like a chain where
 * nothing happened.
 *
 *   0x66fd1d4e…  a record being created. topic1 is the record id, topic2 the
 *                namehash of the name. That pair is the only bridge between an
 *                event and a name, and it only runs one way: a namehash can be
 *                computed from a name, never the reverse.
 *
 *   0x14cf4389…  TextUpdated(uint256 recordId, string indexed key,
 *                            string key, string value)
 *                The key is in the data as well as indexed, so it can be shown
 *                in full — which is why a line can name the record it happened
 *                on instead of printing a hash.
 */
import { decodeEventLog, numberToHex } from 'viem'

export const TOPIC_RECORD =
  '0x66fd1d4edf16fc35ee08adaecfdf6fd5f75283da903b50f642558d6e0ba630ff'
export const TEXT_UPDATED_TOPIC =
  '0x14cf4389d9a790cb32a054e033d7e3d3b78119dee4fea3c0983aac1db3f54015'

export const TEXT_UPDATED = {
  type: 'event',
  name: 'TextUpdated',
  inputs: [
    { name: 'recordId', type: 'uint256', indexed: true },
    { name: 'indexedKey', type: 'string', indexed: true },
    { name: 'key', type: 'string' },
    { name: 'value', type: 'string' },
  ],
}

/**
 * eth_getLogs, asked directly, because the topics are the whole point.
 *
 * viem's getLogs builds its topic filter from an `event` and its `args` and
 * ignores a raw `topics` option — silently, which is how this project spent a
 * while believing it was filtering at the node while the node returned every
 * log on the resolver. Harmless for a list that gets filtered again in the
 * browser; not harmless for a record id, which was being read out of whatever
 * log happened to come back first.
 *
 * What comes back is raw JSON-RPC, so the two fields every caller uses are
 * converted here and nowhere else.
 */
export const logReader = (reader) => async ({ address, topics, fromBlock, toBlock }) => {
  const logs = await reader.request({
    method: 'eth_getLogs',
    params: [{
      address: Array.isArray(address) ? address : [address],
      topics,
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(toBlock),
    }],
  })
  return (logs ?? []).map((l) => ({
    ...l,
    blockNumber: BigInt(l.blockNumber),
    logIndex: Number(l.logIndex ?? 0),
  }))
}

/** One TextUpdated log as { key, value }, or null for a shape we do not know. */
export const asWrite = (log) => {
  try {
    const { args } = decodeEventLog({ abi: [TEXT_UPDATED], data: log.data, topics: log.topics })
    return {
      key: args.key,
      value: args.value,
      record: log.topics[1],
      block: log.blockNumber,
      tx: log.transactionHash,
      index: log.logIndex ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * How far back a public endpoint will let a browser look.
 *
 * Discovered rather than assumed, largest first, and the refusal is returned
 * rather than thrown away: "the node would not answer" and "there is nothing
 * there" are different statements, and a page that cannot tell them apart will
 * eventually tell somebody the wrong one.
 */
export const WIDTHS = [50_000n, 10_000n, 2_000n, 800n]

export const probeWidth = async (logs, { address, topics, head }) => {
  let last = null
  for (const w of WIDTHS) {
    try {
      await logs({ address, topics, fromBlock: head > w ? head - w : 0n, toBlock: head })
      return { width: w, error: null }
    } catch (e) { last = e }
  }
  return { width: null, error: last }
}
