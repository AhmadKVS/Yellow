/**
 * The shared connection between two people.
 *
 * Everything else in Yellow is per-user state keyed by one Cognito `sub`. A
 * pair is the one thing that genuinely belongs to *both* accounts, so it gets
 * its own row and its own identity: a deterministic key built from the two
 * member ids, sorted, so either side computes the same string without needing
 * to know who wrote the row first.
 *
 * Pure and client-safe — no AWS SDK, no `next/headers` — so a `'use client'`
 * page can import it. Server-side reads and writes live in `lib/pairServer.ts`.
 */

import type { Message } from './types';

/* -------------------------------------------------------------------------- */
/* shapes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A message as it exists on the shared row. Deliberately *not* `Message`:
 * `from: 'me' | 'them'` is meaningless on a record two people read, so the
 * wire shape carries `senderId` and each viewer resolves it themselves via
 * `toViewerMessage`. This is what keeps `lib/types.ts` frozen.
 */
export interface PairMessage {
  id: string;
  senderId: string;
  kind: 'text' | 'voice';
  text?: string;
  durationSec?: number;
  waveSeed?: number;
  s3Key?: string;
  at: number;
}

/** The stored row. `connectedAt` is set only when both intros are in. */
export interface PairRecord {
  userId: string;
  a: string;
  b: string;
  introA?: { sentAt: number };
  introB?: { sentAt: number };
  connectedAt?: number;
  messages?: PairMessage[];
  updatedAt: number;
}

/** One pair, resolved for one viewer. What `GET /api/pair` returns. */
export interface PairView {
  personId: string;
  myIntroSent: boolean;
  theirIntroSent: boolean;
  connectedAt: number | null;
  messages: Message[];
  updatedAt: number;
}

/**
 * The cheap shape — everything the notification poller and the chats list
 * need, without shipping every message in every thread on an 8s interval.
 */
export interface PairSummary {
  personId: string;
  myIntroSent: boolean;
  theirIntroSent: boolean;
  connectedAt: number | null;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  lastSenderIsMe: boolean;
  messageCount: number;
  updatedAt: number;
}

export const PAIR_PREFIX = 'pair#';

/* -------------------------------------------------------------------------- */
/* keys                                                                       */
/* -------------------------------------------------------------------------- */

/** `#` is the key's own separator, so an id containing one would be ambiguous. */
function usableId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && !id.includes('#') ? id : '';
}

/**
 * The row key for two people. Sorted, so `pairKey(a, b) === pairKey(b, a)` and
 * neither side has to discover an id the other minted.
 *
 * Returns `null` rather than throwing — every caller sits on a fail-soft path
 * and a missing id must degrade, not crash a render.
 */
export function pairKey(one: string, two: string): string | null {
  const a = usableId(one);
  const b = usableId(two);
  if (!a || !b || a === b) return null;
  return a < b ? `${PAIR_PREFIX}${a}#${b}` : `${PAIR_PREFIX}${b}#${a}`;
}

/** Splits a key back into its two members. `null` if it isn't a pair key. */
export function pairMembers(key: string): [string, string] | null {
  if (typeof key !== 'string' || !key.startsWith(PAIR_PREFIX)) return null;
  const parts = key.slice(PAIR_PREFIX.length).split('#');
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!a || !b) return null;
  return [a, b];
}

/** The member who isn't `me`. `null` when `me` isn't in this pair at all. */
export function otherMember(key: string, me: string): string | null {
  const members = pairMembers(key);
  if (!members) return null;
  const id = usableId(me);
  if (members[0] === id) return members[1];
  if (members[1] === id) return members[0];
  return null;
}

/**
 * Which slot a member occupies. The row stores `introA`/`introB` against the
 * *sorted* positions, so writers need this to know which attribute to set.
 */
export function slotFor(record: Pick<PairRecord, 'a' | 'b'>, id: string): 'a' | 'b' | null {
  if (record.a === id) return 'a';
  if (record.b === id) return 'b';
  return null;
}

/* -------------------------------------------------------------------------- */
/* viewer mapping                                                             */
/* -------------------------------------------------------------------------- */

/** Turns a shared message into the per-viewer `Message` every screen speaks. */
export function toViewerMessage(
  message: PairMessage,
  viewerId: string,
  personId: string,
): Message {
  return {
    id: message.id,
    personId,
    from: message.senderId === viewerId ? 'me' : 'them',
    kind: message.kind,
    text: message.text,
    durationSec: message.durationSec,
    waveSeed: message.waveSeed,
    s3Key: message.s3Key,
    at: message.at,
  };
}

/** One line for the chats list. Voice notes have no text worth showing. */
export function messagePreview(message: PairMessage): string {
  if (message.kind === 'voice') return 'Voice note';
  const text = (message.text ?? '').trim();
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

/* -------------------------------------------------------------------------- */
/* record -> viewer shapes                                                    */
/* -------------------------------------------------------------------------- */

function sortedMessages(record: PairRecord): PairMessage[] {
  const messages = Array.isArray(record.messages) ? record.messages : [];
  return [...messages].sort((x, y) => x.at - y.at);
}

/** `null` when the viewer isn't a member — the callers treat that as 404. */
export function toPairView(record: PairRecord, viewerId: string): PairView | null {
  const personId = otherMember(record.userId, viewerId);
  if (!personId) return null;

  const mine = slotFor(record, viewerId) === 'a' ? record.introA : record.introB;
  const theirs = slotFor(record, viewerId) === 'a' ? record.introB : record.introA;

  return {
    personId,
    myIntroSent: Boolean(mine?.sentAt),
    theirIntroSent: Boolean(theirs?.sentAt),
    connectedAt: record.connectedAt ?? null,
    messages: sortedMessages(record).map((m) => toViewerMessage(m, viewerId, personId)),
    updatedAt: record.updatedAt ?? 0,
  };
}

export function toPairSummary(record: PairRecord, viewerId: string): PairSummary | null {
  const view = toPairView(record, viewerId);
  if (!view) return null;

  const messages = sortedMessages(record);
  const last = messages[messages.length - 1];

  return {
    personId: view.personId,
    myIntroSent: view.myIntroSent,
    theirIntroSent: view.theirIntroSent,
    connectedAt: view.connectedAt,
    lastMessageAt: last?.at ?? null,
    lastMessagePreview: last ? messagePreview(last) : null,
    lastSenderIsMe: last ? last.senderId === viewerId : false,
    messageCount: messages.length,
    updatedAt: view.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

export function isPairMessage(value: unknown): value is PairMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    typeof m.senderId === 'string' &&
    m.senderId.length > 0 &&
    (m.kind === 'text' || m.kind === 'voice') &&
    typeof m.at === 'number'
  );
}
