/**
 * Server-only storage for shared hubs and everything posted inside them.
 *
 * IMPORTANT: never import this from a `'use client'` file — it pulls in the
 * AWS SDK. The pure, client-safe half of this feature lives in `lib/hubs.ts`.
 *
 * Two tables:
 *   `yellow-hubs`      PK `hubId`               — the hub and its roster
 *   `yellow-hub-items` PK `hubId` + SK `itemId` — posts and tasks
 *
 * The composite key is the whole design: one `Query` by `hubId` returns the
 * entire workspace, already ordered, and a post can never collide with a task
 * because the sort key carries its own `post#`/`task#` prefix.
 *
 * Membership changes are conditional writes, never read-modify-write. Two
 * people adding two different members inside one round trip both succeed;
 * `list_append` merges them. A read-modify-write would have one silently
 * erase the other.
 *
 * Every function returns; none throw. An unreachable table degrades to
 * "nothing there", which every caller already renders.
 */

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb, HUBS_TABLE_NAME, HUB_ITEMS_TABLE_NAME } from './aws';
import {
  isHubItem,
  summarize,
  type HubItem,
  type HubSignal,
  type SharedHub,
  type TaskStatus,
} from './hubs';

/** Hard ceiling on any single DynamoDB call — a hung read must not hang a page. */
const DDB_TIMEOUT_MS = 3_000;

/**
 * Every attribute is aliased. `name`, `status` and `text` are DynamoDB reserved
 * words, and the cost of missing one is a runtime `ValidationException` on a
 * path with no test coverage.
 */
const N = {
  '#hubId': 'hubId',
  '#itemId': 'itemId',
  '#name': 'name',
  '#emoji': 'emoji',
  '#oneLiner': 'oneLiner',
  '#ownerId': 'ownerId',
  '#memberIds': 'memberIds',
  '#updatedAt': 'updatedAt',
  '#status': 'status',
  '#assigneeId': 'assigneeId',
  '#dueAt': 'dueAt',
  '#title': 'title',
  '#text': 'text',
  '#kind': 'kind',
  '#createdAt': 'createdAt',
} as const;

function withTimeout(): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDB_TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/* -------------------------------------------------------------------------- */
/* row -> shape                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Normalises a stored row. Duplicates in `memberIds` are dropped here rather
 * than guarded against on write: two people adding the same person at once is
 * a real (if rare) race, and a duplicate is only ever cosmetic — de-duping on
 * read makes the whole class of it harmless.
 */
function asHub(item: unknown): SharedHub | null {
  if (typeof item !== 'object' || item === null) return null;
  const h = item as Record<string, unknown>;
  if (typeof h.hubId !== 'string' || !h.hubId) return null;
  if (typeof h.ownerId !== 'string' || !h.ownerId) return null;

  const raw = Array.isArray(h.memberIds) ? h.memberIds : [];
  const memberIds: string[] = [];
  for (const id of raw) {
    if (typeof id === 'string' && id && !memberIds.includes(id)) memberIds.push(id);
  }
  // The owner is always a member. A row that somehow lost them would otherwise
  // become a hub nobody can administer.
  if (!memberIds.includes(h.ownerId)) memberIds.unshift(h.ownerId);

  return {
    hubId: h.hubId,
    name: typeof h.name === 'string' ? h.name : '',
    emoji: typeof h.emoji === 'string' ? h.emoji : '🚀',
    oneLiner: typeof h.oneLiner === 'string' ? h.oneLiner : '',
    ownerId: h.ownerId,
    memberIds,
    createdAt: typeof h.createdAt === 'number' ? h.createdAt : 0,
    updatedAt: typeof h.updatedAt === 'number' ? h.updatedAt : 0,
  };
}

/** Strips `undefined` so DynamoDB never sees an attribute with no value. */
function asItem(raw: unknown): HubItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(r)) {
    if (value !== undefined && value !== null) cleaned[key] = value;
  }
  return isHubItem(cleaned) ? cleaned : null;
}

export function isMember(hub: SharedHub, userId: string): boolean {
  return hub.memberIds.includes(userId);
}

export function isOwner(hub: SharedHub, userId: string): boolean {
  return hub.ownerId === userId;
}

/* -------------------------------------------------------------------------- */
/* hubs — reads                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every hub this person is a member of.
 *
 * A `Scan` with a `contains(memberIds, :me)` filter, not a `Query`: membership
 * is a list attribute and the table has no GSI on it. That is the same tradeoff
 * `/api/people` and `/api/pairs` already make and it is entirely fine at demo
 * scale. **At volume the real answer is a GSI** — either a `memberId`-keyed
 * membership table (one row per person per hub) or an inverted index — so the
 * lookup stops reading every hub in the system to answer "which are mine".
 *
 * `ok` is separate from the list because an unreachable table also produces an
 * empty array, and the client must be able to tell those apart.
 */
export async function listHubsFor(
  me: string,
): Promise<{ ok: boolean; hubs: SharedHub[] }> {
  const id = (me ?? '').trim();
  if (!id) return { ok: false, hubs: [] };

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: HUBS_TABLE_NAME,
        FilterExpression: 'contains(#memberIds, :me)',
        ExpressionAttributeNames: { '#memberIds': N['#memberIds'] },
        ExpressionAttributeValues: { ':me': id },
      }),
      { abortSignal: signal },
    );

    const hubs: SharedHub[] = [];
    for (const item of result.Items ?? []) {
      const hub = asHub(item);
      // One corrupt row must never empty somebody's whole hub list.
      if (hub && isMember(hub, id)) hubs.push(hub);
    }
    hubs.sort((a, b) => b.updatedAt - a.updatedAt);
    return { ok: true, hubs };
  } catch {
    return { ok: false, hubs: [] };
  } finally {
    done();
  }
}

/** `null` for "no such hub", "unreachable", or "malformed" — all alike. */
export async function readHub(hubId: string): Promise<SharedHub | null> {
  const id = (hubId ?? '').trim();
  if (!id) return null;

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new GetCommand({ TableName: HUBS_TABLE_NAME, Key: { hubId: id } }),
      { abortSignal: signal },
    );
    return asHub(result.Item);
  } catch {
    return null;
  } finally {
    done();
  }
}

/* -------------------------------------------------------------------------- */
/* hubs — writes                                                              */
/* -------------------------------------------------------------------------- */

/** Creates the row. `attribute_not_exists` makes a re-issued id a no-op fail. */
export async function putHub(hub: SharedHub): Promise<SharedHub | null> {
  const { signal, done } = withTimeout();
  try {
    await ddb.send(
      new PutCommand({
        TableName: HUBS_TABLE_NAME,
        Item: hub,
        ConditionExpression: 'attribute_not_exists(#hubId)',
        ExpressionAttributeNames: { '#hubId': N['#hubId'] },
      }),
      { abortSignal: signal },
    );
    return hub;
  } catch {
    return null;
  } finally {
    done();
  }
}

/**
 * Appends a member. Conditional on the hub existing and the person not already
 * being in it, so a double-click is a harmless no-op rather than a duplicate.
 * Returns the fresh row either way.
 */
export async function addMember(
  hubId: string,
  memberId: string,
): Promise<SharedHub | null> {
  const id = (hubId ?? '').trim();
  const member = (memberId ?? '').trim();
  if (!id || !member) return null;

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: HUBS_TABLE_NAME,
        Key: { hubId: id },
        ConditionExpression:
          'attribute_exists(#hubId) AND NOT contains(#memberIds, :member)',
        UpdateExpression:
          'SET #memberIds = list_append(if_not_exists(#memberIds, :empty), :one), #updatedAt = :now',
        ExpressionAttributeNames: {
          '#hubId': N['#hubId'],
          '#memberIds': N['#memberIds'],
          '#updatedAt': N['#updatedAt'],
        },
        ExpressionAttributeValues: {
          ':member': member,
          ':one': [member],
          ':empty': [] as string[],
          ':now': Date.now(),
        },
        ReturnValues: 'ALL_NEW',
      }),
      { abortSignal: signal },
    );
    return asHub(result.Attributes);
  } catch {
    // Already a member, or the write failed. The row is the truth either way.
    return readHub(id);
  } finally {
    done();
  }
}

/**
 * Removes one member by list index, conditional on that slot still holding the
 * person we mean. Without the condition a concurrent add/remove could shift the
 * list between the read and the write and evict the wrong person.
 */
export async function removeMember(
  hubId: string,
  memberId: string,
): Promise<SharedHub | null> {
  const id = (hubId ?? '').trim();
  const member = (memberId ?? '').trim();
  if (!id || !member) return null;

  const current = await readHub(id);
  if (!current) return null;

  const index = current.memberIds.indexOf(member);
  if (index < 0) return current;

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: HUBS_TABLE_NAME,
        Key: { hubId: id },
        ConditionExpression: `#memberIds[${index}] = :member`,
        UpdateExpression: `REMOVE #memberIds[${index}] SET #updatedAt = :now`,
        ExpressionAttributeNames: {
          '#memberIds': N['#memberIds'],
          '#updatedAt': N['#updatedAt'],
        },
        ExpressionAttributeValues: { ':member': member, ':now': Date.now() },
        ReturnValues: 'ALL_NEW',
      }),
      { abortSignal: signal },
    );
    return asHub(result.Attributes);
  } catch {
    return readHub(id);
  } finally {
    done();
  }
}

export async function deleteHubRow(hubId: string): Promise<boolean> {
  const id = (hubId ?? '').trim();
  if (!id) return false;

  const { signal, done } = withTimeout();
  try {
    await ddb.send(
      new DeleteCommand({ TableName: HUBS_TABLE_NAME, Key: { hubId: id } }),
      { abortSignal: signal },
    );
    return true;
  } catch {
    return false;
  } finally {
    done();
  }
}

/* -------------------------------------------------------------------------- */
/* hub items                                                                  */
/* -------------------------------------------------------------------------- */

/** Everything in one hub. A single `Query` — this is why the key is composite. */
export async function listHubItems(
  hubId: string,
): Promise<{ ok: boolean; items: HubItem[] }> {
  const id = (hubId ?? '').trim();
  if (!id) return { ok: false, items: [] };

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: HUB_ITEMS_TABLE_NAME,
        KeyConditionExpression: '#hubId = :hub',
        ExpressionAttributeNames: { '#hubId': N['#hubId'] },
        ExpressionAttributeValues: { ':hub': id },
      }),
      { abortSignal: signal },
    );

    const items: HubItem[] = [];
    for (const raw of result.Items ?? []) {
      const item = asItem(raw);
      // One malformed post must never blank the whole workspace.
      if (item) items.push(item);
    }
    return { ok: true, items };
  } catch {
    return { ok: false, items: [] };
  } finally {
    done();
  }
}

/**
 * The at-a-glance numbers for the hubs list, without shipping every post body.
 * Projected down to the six attributes `summarize` reads.
 *
 * Best-effort by design: `null` simply means the list renders without a signal
 * line, never that the hub goes missing.
 */
export async function readHubSignal(hubId: string): Promise<HubSignal | null> {
  const id = (hubId ?? '').trim();
  if (!id) return null;

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: HUB_ITEMS_TABLE_NAME,
        KeyConditionExpression: '#hubId = :hub',
        ProjectionExpression:
          '#hubId, #itemId, #kind, #status, #dueAt, #createdAt, #updatedAt',
        ExpressionAttributeNames: {
          '#hubId': N['#hubId'],
          '#itemId': N['#itemId'],
          '#kind': N['#kind'],
          '#status': N['#status'],
          '#dueAt': N['#dueAt'],
          '#createdAt': N['#createdAt'],
          '#updatedAt': N['#updatedAt'],
        },
        ExpressionAttributeValues: { ':hub': id },
      }),
      { abortSignal: signal },
    );

    // The projection drops `text`/`title`/`authorId`, so these rows can't pass
    // `isHubItem`. Count them straight off the projected attributes instead.
    const items: HubItem[] = [];
    for (const raw of result.Items ?? []) {
      const r = raw as Record<string, unknown>;
      const itemId = typeof r.itemId === 'string' ? r.itemId : '';
      const createdAt = typeof r.createdAt === 'number' ? r.createdAt : 0;
      if (!itemId) continue;

      if (r.kind === 'task') {
        items.push({
          itemId,
          hubId: id,
          kind: 'task',
          title: '',
          status: (r.status as TaskStatus | undefined) ?? 'todo',
          ...(typeof r.dueAt === 'number' ? { dueAt: r.dueAt } : {}),
          createdBy: '',
          createdAt,
          updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : createdAt,
        });
      } else {
        items.push({
          itemId,
          hubId: id,
          kind: 'post',
          authorId: '',
          text: '',
          postKind: 'update',
          createdAt,
        });
      }
    }

    return summarize(items);
  } catch {
    return null;
  } finally {
    done();
  }
}

export async function readHubItem(
  hubId: string,
  itemId: string,
): Promise<HubItem | null> {
  const hub = (hubId ?? '').trim();
  const item = (itemId ?? '').trim();
  if (!hub || !item) return null;

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: HUB_ITEMS_TABLE_NAME,
        Key: { hubId: hub, itemId: item },
      }),
      { abortSignal: signal },
    );
    return asItem(result.Item);
  } catch {
    return null;
  } finally {
    done();
  }
}

export async function putHubItem(item: HubItem): Promise<HubItem | null> {
  const { signal, done } = withTimeout();
  try {
    await ddb.send(
      new PutCommand({
        TableName: HUB_ITEMS_TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#itemId)',
        ExpressionAttributeNames: { '#itemId': N['#itemId'] },
      }),
      { abortSignal: signal },
    );
    return item;
  } catch {
    return null;
  } finally {
    done();
  }
}

export type ItemPatch = {
  status?: TaskStatus;
  /** `null` clears the assignee. */
  assigneeId?: string | null;
  /** `null` clears the due date. */
  dueAt?: number | null;
  title?: string;
  text?: string;
};

/**
 * Applies a partial update. Builds the expression from whatever was actually
 * supplied so an absent field is left alone and an explicit `null` clears it —
 * "unassign" and "don't touch the assignee" are genuinely different requests.
 */
export async function patchHubItem(
  hubId: string,
  itemId: string,
  patch: ItemPatch,
): Promise<HubItem | null> {
  const hub = (hubId ?? '').trim();
  const item = (itemId ?? '').trim();
  if (!hub || !item) return null;

  const sets: string[] = ['#updatedAt = :now'];
  const removes: string[] = [];
  const names: Record<string, string> = { '#updatedAt': N['#updatedAt'] };
  const values: Record<string, unknown> = { ':now': Date.now() };

  if (patch.status !== undefined) {
    sets.push('#status = :status');
    names['#status'] = N['#status'];
    values[':status'] = patch.status;
  }
  if (patch.title !== undefined) {
    sets.push('#title = :title');
    names['#title'] = N['#title'];
    values[':title'] = patch.title;
  }
  if (patch.text !== undefined) {
    sets.push('#text = :text');
    names['#text'] = N['#text'];
    values[':text'] = patch.text;
  }
  if (patch.assigneeId !== undefined) {
    names['#assigneeId'] = N['#assigneeId'];
    if (patch.assigneeId === null) {
      removes.push('#assigneeId');
    } else {
      sets.push('#assigneeId = :assigneeId');
      values[':assigneeId'] = patch.assigneeId;
    }
  }
  if (patch.dueAt !== undefined) {
    names['#dueAt'] = N['#dueAt'];
    if (patch.dueAt === null) {
      removes.push('#dueAt');
    } else {
      sets.push('#dueAt = :dueAt');
      values[':dueAt'] = patch.dueAt;
    }
  }

  const expression = [
    `SET ${sets.join(', ')}`,
    removes.length ? `REMOVE ${removes.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const { signal, done } = withTimeout();
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: HUB_ITEMS_TABLE_NAME,
        Key: { hubId: hub, itemId: item },
        ConditionExpression: 'attribute_exists(#itemId)',
        UpdateExpression: expression,
        ExpressionAttributeNames: { ...names, '#itemId': N['#itemId'] },
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
      { abortSignal: signal },
    );
    return asItem(result.Attributes);
  } catch {
    return null;
  } finally {
    done();
  }
}

export async function deleteHubItemRow(
  hubId: string,
  itemId: string,
): Promise<boolean> {
  const hub = (hubId ?? '').trim();
  const item = (itemId ?? '').trim();
  if (!hub || !item) return false;

  const { signal, done } = withTimeout();
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: HUB_ITEMS_TABLE_NAME,
        Key: { hubId: hub, itemId: item },
      }),
      { abortSignal: signal },
    );
    return true;
  } catch {
    return false;
  } finally {
    done();
  }
}

/**
 * Best-effort cleanup after a hub is deleted. Orphaned items are invisible
 * (nothing can read them without the hub row) so a partial failure is harmless
 * — which is why this never blocks the delete response on success.
 */
export async function deleteHubItems(hubId: string): Promise<void> {
  const { items } = await listHubItems(hubId);
  await Promise.allSettled(
    items.map((item) => deleteHubItemRow(hubId, item.itemId)),
  );
}
