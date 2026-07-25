/**
 * Shared project hubs — the client-safe half.
 *
 * A hub is the one thing in Yellow that belongs to *several* accounts at once.
 * It used to live inside each user's private state blob, which meant creating a
 * hub and "adding" someone wrote nothing to that person's row: they refreshed
 * and saw nothing. Hubs now have their own table (`yellow-hubs`, PK `hubId`)
 * and their contents another (`yellow-hub-items`, PK `hubId` + SK `itemId`), so
 * every member reads the same row.
 *
 * Pure functions plus `fetch` — no AWS SDK, no `next/headers` — so a
 * `'use client'` page can import this. Server-side reads and writes live in
 * `lib/hubsServer.ts`, mirroring the `lib/pair.ts` / `lib/pairServer.ts` split.
 *
 * Every function here returns; none of them throw. A hub screen that can't
 * reach DynamoDB renders empty, not broken.
 */

import { resolveIdentity } from '@/lib/people';

/* -------------------------------------------------------------------------- */
/* shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** The stored hub row. `memberIds` always includes `ownerId`. */
export interface SharedHub {
  hubId: string;
  name: string;
  emoji: string;
  oneLiner: string;
  /** Cognito sub of the creator. */
  ownerId: string;
  /** Cognito subs, INCLUDING the owner. */
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type PostKind = 'update' | 'question';
export type TaskStatus = 'todo' | 'doing' | 'done';

export interface HubPost {
  itemId: string;
  hubId: string;
  kind: 'post';
  authorId: string;
  text: string;
  postKind: PostKind;
  createdAt: number;
}

export interface HubTask {
  itemId: string;
  hubId: string;
  kind: 'task';
  title: string;
  assigneeId?: string;
  dueAt?: number;
  status: TaskStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type HubItem = HubPost | HubTask;

/**
 * The at-a-glance line on the hubs list: "3 open · last update 2h ago".
 * Computed server-side so the list costs one request instead of one per hub,
 * and strictly optional — a failed enrichment must never cost you the hub.
 */
export interface HubSignal {
  posts: number;
  openTasks: number;
  overdueTasks: number;
  lastActivityAt: number | null;
}

export interface HubSummary extends SharedHub {
  signal?: HubSignal;
}

export type HubsSource = 'dynamodb' | 'unavailable';

export interface HubsResult {
  hubs: HubSummary[];
  source: HubsSource;
}

export interface HubItemsResult {
  items: HubItem[];
  ok: boolean;
}

/* -------------------------------------------------------------------------- */
/* item ids — sortable, and self-describing                                   */
/* -------------------------------------------------------------------------- */

/**
 * DynamoDB sorts the range key lexicographically, so the timestamp has to be
 * fixed-width or "9…" would sort above "10…". 13 digits covers every
 * `Date.now()` until the year 2286.
 */
const TIME_WIDTH = 13;

export const POST_PREFIX = 'post#';
export const TASK_PREFIX = 'task#';

function pad(at: number): string {
  return String(Math.max(0, Math.floor(at))).padStart(TIME_WIDTH, '0');
}

function rand(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    }
  } catch {
    /* fall through to the cheap suffix */
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `post#<padded ms>#<rand>` / `task#<padded ms>#<rand>`.
 *
 * The prefix is doing real work: one `Query` by `hubId` returns posts and tasks
 * together, each block already in creation order, with no second index and no
 * filter expression.
 */
export function newItemId(kind: 'post' | 'task', at: number = Date.now()): string {
  return `${kind === 'post' ? POST_PREFIX : TASK_PREFIX}${pad(at)}#${rand()}`;
}

export function newHubId(): string {
  return `hub_${rand()}${rand().slice(0, 6)}`;
}

/* -------------------------------------------------------------------------- */
/* validation — one bad row must never empty a hub                            */
/* -------------------------------------------------------------------------- */

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function isSharedHub(value: unknown): value is SharedHub {
  if (typeof value !== 'object' || value === null) return false;
  const h = value as Record<string, unknown>;
  return (
    typeof h.hubId === 'string' &&
    h.hubId.length > 0 &&
    typeof h.name === 'string' &&
    typeof h.emoji === 'string' &&
    typeof h.oneLiner === 'string' &&
    typeof h.ownerId === 'string' &&
    h.ownerId.length > 0 &&
    isStringArray(h.memberIds) &&
    typeof h.createdAt === 'number' &&
    typeof h.updatedAt === 'number'
  );
}

function isHubSignal(value: unknown): value is HubSignal {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.posts === 'number' &&
    typeof s.openTasks === 'number' &&
    typeof s.overdueTasks === 'number' &&
    (s.lastActivityAt === null || typeof s.lastActivityAt === 'number')
  );
}

function isHubSummary(value: unknown): value is HubSummary {
  if (!isSharedHub(value)) return false;
  const signal = (value as { signal?: unknown }).signal;
  return signal === undefined || isHubSignal(signal);
}

export function isPostKind(value: unknown): value is PostKind {
  return value === 'update' || value === 'question';
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'todo' || value === 'doing' || value === 'done';
}

export function isHubPost(value: unknown): value is HubPost {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.kind === 'post' &&
    typeof p.itemId === 'string' &&
    typeof p.hubId === 'string' &&
    typeof p.authorId === 'string' &&
    typeof p.text === 'string' &&
    isPostKind(p.postKind) &&
    typeof p.createdAt === 'number'
  );
}

export function isHubTask(value: unknown): value is HubTask {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    t.kind === 'task' &&
    typeof t.itemId === 'string' &&
    typeof t.hubId === 'string' &&
    typeof t.title === 'string' &&
    isTaskStatus(t.status) &&
    typeof t.createdBy === 'string' &&
    typeof t.createdAt === 'number' &&
    typeof t.updatedAt === 'number' &&
    (t.assigneeId === undefined || typeof t.assigneeId === 'string') &&
    (t.dueAt === undefined || typeof t.dueAt === 'number')
  );
}

export function isHubItem(value: unknown): value is HubItem {
  return isHubPost(value) || isHubTask(value);
}

/* -------------------------------------------------------------------------- */
/* pure helpers the screens share                                             */
/* -------------------------------------------------------------------------- */

export function posts(items: readonly HubItem[]): HubPost[] {
  return items.filter(isHubPost).sort((a, b) => b.createdAt - a.createdAt);
}

/** Open work first, then by due date, then newest. Done sinks to the bottom. */
export function tasks(items: readonly HubItem[]): HubTask[] {
  const weight: Record<TaskStatus, number> = { doing: 0, todo: 1, done: 2 };
  return items.filter(isHubTask).sort((a, b) => {
    if (weight[a.status] !== weight[b.status]) return weight[a.status] - weight[b.status];
    const dueA = a.dueAt ?? Number.POSITIVE_INFINITY;
    const dueB = b.dueAt ?? Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    return b.createdAt - a.createdAt;
  });
}

export function summarize(items: readonly HubItem[]): HubSignal {
  const now = Date.now();
  let postCount = 0;
  let openTasks = 0;
  let overdueTasks = 0;
  let lastActivityAt: number | null = null;

  for (const item of items) {
    const at = item.kind === 'task' ? Math.max(item.createdAt, item.updatedAt) : item.createdAt;
    if (lastActivityAt === null || at > lastActivityAt) lastActivityAt = at;

    if (item.kind === 'post') {
      postCount += 1;
      continue;
    }
    if (item.status !== 'done') {
      openTasks += 1;
      if (typeof item.dueAt === 'number' && item.dueAt < now) overdueTasks += 1;
    }
  }

  return { posts: postCount, openTasks, overdueTasks, lastActivityAt };
}

/** "now" / "14m" / "3h" / "2d". Shared by both hub screens. */
export function relativeTime(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/** How a deadline reads: overdue, today, soon, or just a date. */
export function dueLabel(dueAt: number): { text: string; tone: 'overdue' | 'soon' | 'calm' } {
  const diff = dueAt - Date.now();
  if (diff < 0) {
    const days = Math.floor(-diff / 86_400_000);
    return { text: days >= 1 ? `${days}d overdue` : 'Overdue', tone: 'overdue' };
  }
  if (diff < 86_400_000) return { text: 'Due today', tone: 'soon' };
  if (diff < 3 * 86_400_000) {
    return { text: `Due in ${Math.ceil(diff / 86_400_000)}d`, tone: 'soon' };
  }
  return {
    text: `Due ${new Date(dueAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })}`,
    tone: 'calm',
  };
}

/* -------------------------------------------------------------------------- */
/* io — every path returns, none throw                                        */
/* -------------------------------------------------------------------------- */

/** Never block a render on the network for longer than this. */
const FETCH_TIMEOUT_MS = 4_000;

async function call<T>(input: string, init: RequestInit | undefined, fallback: T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const outer = init?.signal ?? null;
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
    // A 401/403/500 is a degraded read, not an exception the UI has to catch.
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

function jsonInit(method: string, payload: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  };
}

/**
 * Every hub this person is a member of — created by them or not.
 *
 * `source` is load-bearing in the same way `PeopleResult.source` is: an
 * unreachable table also answers with an empty list, and the caller must be
 * able to tell "you're in no hubs" from "we couldn't ask".
 */
export async function fetchHubs(
  options: { signal?: AbortSignal } = {},
): Promise<HubsResult> {
  const body = await call<{ ok?: unknown; hubs?: unknown }>(
    '/api/hubs',
    options.signal ? { signal: options.signal } : undefined,
    {},
  );

  if (body.ok !== true || !Array.isArray(body.hubs)) {
    return { hubs: [], source: 'unavailable' };
  }

  const hubs: HubSummary[] = [];
  for (const item of body.hubs) {
    // Skip the malformed one, keep the rest. One bad row must not cost you
    // every hub you're in.
    if (isHubSummary(item)) hubs.push(item);
  }
  return { hubs, source: 'dynamodb' };
}

/** `null` on any failure — the caller re-reads from the server either way. */
export async function createHub(input: {
  name: string;
  emoji: string;
  oneLiner: string;
}): Promise<SharedHub | null> {
  const body = await call<{ ok?: unknown; hub?: unknown }>(
    '/api/hubs',
    jsonInit('POST', input),
    {},
  );
  return body.ok === true && isSharedHub(body.hub) ? body.hub : null;
}

async function patchMember(
  hubId: string,
  action: 'add' | 'remove',
  memberId: string,
): Promise<SharedHub | null> {
  const id = (hubId ?? '').trim();
  const member = (memberId ?? '').trim();
  if (!id || !member) return null;

  const body = await call<{ ok?: unknown; hub?: unknown }>(
    `/api/hubs/${encodeURIComponent(id)}`,
    jsonInit('PATCH', { action, memberId: member }),
    {},
  );
  return body.ok === true && isSharedHub(body.hub) ? body.hub : null;
}

export function addHubMember(hubId: string, memberId: string): Promise<SharedHub | null> {
  return patchMember(hubId, 'add', memberId);
}

export function removeHubMember(hubId: string, memberId: string): Promise<SharedHub | null> {
  return patchMember(hubId, 'remove', memberId);
}

/**
 * Leave a hub you were added to. Removing *yourself* is the one member change
 * a non-owner is allowed to make, and the server enforces that — this just
 * resolves who "yourself" is.
 */
export async function leaveHub(hubId: string): Promise<boolean> {
  const me = await resolveIdentity();
  if (!me) return false;
  return (await patchMember(hubId, 'remove', me)) !== null;
}

export async function deleteHub(hubId: string): Promise<boolean> {
  const id = (hubId ?? '').trim();
  if (!id) return false;
  const body = await call<{ ok?: unknown }>(
    `/api/hubs/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    {},
  );
  return body.ok === true;
}

/* ------------------------------- hub items ------------------------------- */

export async function fetchHubItems(
  hubId: string,
  options: { signal?: AbortSignal } = {},
): Promise<HubItemsResult> {
  const id = (hubId ?? '').trim();
  if (!id) return { items: [], ok: false };

  const body = await call<{ ok?: unknown; items?: unknown }>(
    `/api/hubs/${encodeURIComponent(id)}/items`,
    options.signal ? { signal: options.signal } : undefined,
    {},
  );

  if (body.ok !== true || !Array.isArray(body.items)) return { items: [], ok: false };

  const items: HubItem[] = [];
  for (const raw of body.items) {
    if (isHubItem(raw)) items.push(raw);
  }
  return { items, ok: true };
}

async function createItem(hubId: string, payload: unknown): Promise<HubItem | null> {
  const id = (hubId ?? '').trim();
  if (!id) return null;
  const body = await call<{ ok?: unknown; item?: unknown }>(
    `/api/hubs/${encodeURIComponent(id)}/items`,
    jsonInit('POST', payload),
    {},
  );
  return body.ok === true && isHubItem(body.item) ? body.item : null;
}

export function createHubPost(
  hubId: string,
  input: { text: string; postKind: PostKind },
): Promise<HubItem | null> {
  return createItem(hubId, { kind: 'post', ...input });
}

export function createHubTask(
  hubId: string,
  input: { title: string; assigneeId?: string; dueAt?: number },
): Promise<HubItem | null> {
  return createItem(hubId, { kind: 'task', ...input });
}

export async function updateHubItem(
  hubId: string,
  itemId: string,
  patch: {
    status?: TaskStatus;
    assigneeId?: string | null;
    dueAt?: number | null;
    title?: string;
    text?: string;
  },
): Promise<HubItem | null> {
  const id = (hubId ?? '').trim();
  const item = (itemId ?? '').trim();
  if (!id || !item) return null;

  const body = await call<{ ok?: unknown; item?: unknown }>(
    `/api/hubs/${encodeURIComponent(id)}/items/${encodeURIComponent(item)}`,
    jsonInit('PATCH', patch),
    {},
  );
  return body.ok === true && isHubItem(body.item) ? body.item : null;
}

export async function deleteHubItem(hubId: string, itemId: string): Promise<boolean> {
  const id = (hubId ?? '').trim();
  const item = (itemId ?? '').trim();
  if (!id || !item) return false;

  const body = await call<{ ok?: unknown }>(
    `/api/hubs/${encodeURIComponent(id)}/items/${encodeURIComponent(item)}`,
    { method: 'DELETE' },
    {},
  );
  return body.ok === true;
}
