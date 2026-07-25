/**
 * Server-only storage for the shared pair row.
 *
 * IMPORTANT: never import this from a `'use client'` file — it pulls in the
 * AWS SDK. The pure, client-safe half of this feature lives in `lib/pair.ts`.
 *
 * Pair rows live in the **existing** `yellow-app` table alongside the per-user
 * state blobs, distinguished only by their key shape (`pair#<a>#<b>` versus a
 * bare user id). That avoids a second table, a second IAM statement, and a
 * `scripts/provision.mjs` run — and the two key spaces cannot collide, because
 * a user id can never contain `#`.
 *
 * Every write here is an `UpdateCommand`. A `PutCommand` would replace the
 * whole item, so two people acting at once would silently erase each other's
 * intro flag or an entire thread.
 */

import {
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from './aws';
import {
  PAIR_PREFIX,
  pairKey,
  slotFor,
  type PairMessage,
  type PairRecord,
} from './pair';

/** Hard ceiling on any single DynamoDB call — a hung read must not hang a page. */
const DDB_TIMEOUT_MS = 3_000;

/**
 * Every attribute is aliased. `a` and `b` are short enough to collide with a
 * DynamoDB reserved word as the language grows, and the cost of being wrong is
 * a runtime `ValidationException` on a path with no test coverage.
 */
const NAMES = {
  '#a': 'a',
  '#b': 'b',
  '#introA': 'introA',
  '#introB': 'introB',
  '#connectedAt': 'connectedAt',
  '#messages': 'messages',
  '#updatedAt': 'updatedAt',
  '#userId': 'userId',
} as const;

function withTimeout(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDB_TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function asRecord(item: unknown): PairRecord | null {
  if (typeof item !== 'object' || item === null) return null;
  const r = item as Record<string, unknown>;
  if (typeof r.userId !== 'string' || typeof r.a !== 'string' || typeof r.b !== 'string') {
    return null;
  }
  return {
    userId: r.userId,
    a: r.a,
    b: r.b,
    introA: typeof r.introA === 'object' && r.introA !== null ? (r.introA as { sentAt: number }) : undefined,
    introB: typeof r.introB === 'object' && r.introB !== null ? (r.introB as { sentAt: number }) : undefined,
    connectedAt: typeof r.connectedAt === 'number' ? r.connectedAt : undefined,
    messages: Array.isArray(r.messages) ? (r.messages as PairMessage[]) : [],
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/** `null` for "no row yet", "unreachable", or "malformed" — all handled alike. */
export async function readPair(me: string, them: string): Promise<PairRecord | null> {
  const key = pairKey(me, them);
  if (!key) return null;

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { userId: key } }),
      { abortSignal: signal },
    );
    return asRecord(result.Item);
  } catch {
    return null;
  } finally {
    done();
  }
}

/**
 * Every pair this person belongs to.
 *
 * A `Scan` with a filter rather than a `Query`, because the table has no GSI on
 * membership. Both key spaces live in one small table at demo scale, so this is
 * the same tradeoff `/api/people` already makes. A GSI is the answer at volume.
 *
 * Returns `ok` separately from the list, because "you have no connections" and
 * "the table was unreachable" are both an empty array and the client must not
 * confuse them: it reconciles local connection state against this result, and
 * treating a transient failure as an empty inbox would delete every real
 * connection the user has.
 */
export async function listPairsFor(
  me: string,
): Promise<{ ok: boolean; records: PairRecord[] }> {
  const id = (me ?? '').trim();
  if (!id) return { ok: false, records: [] };

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(#userId, :prefix) AND (#a = :me OR #b = :me)',
        ExpressionAttributeNames: {
          '#userId': NAMES['#userId'],
          '#a': NAMES['#a'],
          '#b': NAMES['#b'],
        },
        ExpressionAttributeValues: { ':prefix': PAIR_PREFIX, ':me': id },
      }),
      { abortSignal: signal },
    );

    const records: PairRecord[] = [];
    for (const item of result.Items ?? []) {
      const record = asRecord(item);
      // One corrupt row must never empty somebody's whole inbox.
      if (record) records.push(record);
    }
    return { ok: true, records };
  } catch {
    return { ok: false, records: [] };
  } finally {
    done();
  }
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Creates the row if it doesn't exist, leaves it completely alone if it does.
 * `if_not_exists` on every attribute is what makes a concurrent call from the
 * other member harmless.
 */
export async function ensurePair(me: string, them: string): Promise<PairRecord | null> {
  const key = pairKey(me, them);
  if (!key) return null;

  const [a, b] = key.slice(PAIR_PREFIX.length).split('#');
  const now = Date.now();

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId: key },
        UpdateExpression:
          'SET #a = if_not_exists(#a, :a), #b = if_not_exists(#b, :b), #updatedAt = if_not_exists(#updatedAt, :now)',
        ExpressionAttributeNames: {
          '#a': NAMES['#a'],
          '#b': NAMES['#b'],
          '#updatedAt': NAMES['#updatedAt'],
        },
        ExpressionAttributeValues: { ':a': a, ':b': b, ':now': now },
        ReturnValues: 'ALL_NEW',
      }),
      { abortSignal: signal },
    );
    return asRecord(result.Attributes);
  } catch {
    return null;
  } finally {
    done();
  }
}

/**
 * Appends one message. This is the whole reason writes are `UpdateCommand`s:
 *
 *   SET messages = list_append(if_not_exists(messages, :empty), :one)
 *
 * A read-modify-write would drop a message whenever both people send inside a
 * single round trip, which is exactly what happens the moment a conversation
 * gets lively.
 */
export async function appendMessages(
  me: string,
  them: string,
  messages: PairMessage[],
): Promise<PairRecord | null> {
  const key = pairKey(me, them);
  if (!key || messages.length === 0) return null;

  await ensurePair(me, them);

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId: key },
        UpdateExpression:
          'SET #messages = list_append(if_not_exists(#messages, :empty), :new), #updatedAt = :now',
        ExpressionAttributeNames: {
          '#messages': NAMES['#messages'],
          '#updatedAt': NAMES['#updatedAt'],
        },
        ExpressionAttributeValues: {
          ':empty': [] as PairMessage[],
          ':new': messages,
          ':now': Date.now(),
        },
        ReturnValues: 'ALL_NEW',
      }),
      { abortSignal: signal },
    );
    return asRecord(result.Attributes);
  } catch {
    return null;
  } finally {
    done();
  }
}

/**
 * Marks one side's intro as sent, and — only when both sides are in — stamps
 * `connectedAt` and seeds the thread with both intros.
 *
 * `seed` is a callback rather than a value so the caller only pays for reading
 * two intro rows on the single request that actually unlocks the pair.
 *
 * The stamp carries `attribute_not_exists(connectedAt)`. Without it, two
 * simultaneous sends would both observe "both intros present" and both seed the
 * thread, double-posting all six notes.
 */
export async function markIntroSent(
  me: string,
  them: string,
  seed: () => Promise<PairMessage[]>,
): Promise<{ record: PairRecord | null; justConnected: boolean }> {
  const key = pairKey(me, them);
  if (!key) return { record: null, justConnected: false };

  const base = await ensurePair(me, them);
  if (!base) return { record: null, justConnected: false };

  const slot = slotFor(base, me);
  if (!slot) return { record: null, justConnected: false };

  const attribute = slot === 'a' ? '#introA' : '#introB';
  const now = Date.now();

  let record: PairRecord | null = null;
  const first = withTimeout();
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId: key },
        // if_not_exists keeps the original timestamp when someone re-sends.
        UpdateExpression: `SET ${attribute} = if_not_exists(${attribute}, :sent), #updatedAt = :now`,
        ExpressionAttributeNames: {
          [attribute]: attribute === '#introA' ? NAMES['#introA'] : NAMES['#introB'],
          '#updatedAt': NAMES['#updatedAt'],
        },
        ExpressionAttributeValues: { ':sent': { sentAt: now }, ':now': now },
        ReturnValues: 'ALL_NEW',
      }),
      { abortSignal: first.signal },
    );
    record = asRecord(result.Attributes);
  } catch {
    return { record: null, justConnected: false };
  } finally {
    first.done();
  }

  if (!record) return { record: null, justConnected: false };

  const bothIn = Boolean(record.introA?.sentAt) && Boolean(record.introB?.sentAt);
  if (!bothIn || record.connectedAt) {
    return { record, justConnected: false };
  }

  const seeded = await seed().catch(() => [] as PairMessage[]);

  const second = withTimeout();
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId: key },
        ConditionExpression: 'attribute_not_exists(#connectedAt)',
        UpdateExpression:
          'SET #connectedAt = :now, #messages = list_append(if_not_exists(#messages, :empty), :seed), #updatedAt = :now',
        ExpressionAttributeNames: {
          '#connectedAt': NAMES['#connectedAt'],
          '#messages': NAMES['#messages'],
          '#updatedAt': NAMES['#updatedAt'],
        },
        ExpressionAttributeValues: {
          ':now': Date.now(),
          ':empty': [] as PairMessage[],
          ':seed': seeded,
        },
        ReturnValues: 'ALL_NEW',
      }),
      { abortSignal: second.signal },
    );
    return { record: asRecord(result.Attributes) ?? record, justConnected: true };
  } catch {
    // Lost the race, or the write failed. Either way the truth is on the row.
    const fresh = await readPair(me, them);
    return { record: fresh ?? record, justConnected: false };
  } finally {
    second.done();
  }
}
