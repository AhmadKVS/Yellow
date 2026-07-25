/**
 * Red/green check for `lib/pair.ts`.
 *
 * The repo has no test framework and adding one is out of scope, but the pair
 * key math is the one place where a silent mistake would be invisible in the
 * UI and catastrophic in the data: two people computing different keys means
 * two half-threads that never meet. Node strips the TypeScript natively.
 *
 * Run: node scripts/check-pair.mjs
 */

import assert from 'node:assert/strict';
import {
  pairKey,
  pairMembers,
  otherMember,
  slotFor,
  messagePreview,
  toPairView,
  toPairSummary,
  isPairMessage,
} from '../lib/pair.ts';

/* Order-independence is the entire point of the key. */
assert.equal(pairKey('bbb', 'aaa'), pairKey('aaa', 'bbb'));
assert.equal(pairKey('aaa', 'bbb'), 'pair#aaa#bbb');
assert.equal(pairKey('  aaa  ', 'bbb'), 'pair#aaa#bbb');

/* Fail-soft: never throw on a missing or malformed id. */
assert.equal(pairKey('', 'bbb'), null);
assert.equal(pairKey('aaa', ''), null);
assert.equal(pairKey('aaa', 'aaa'), null);
assert.equal(pairKey('a#b', 'ccc'), null, '# is the separator, so it cannot appear in an id');

assert.deepEqual(pairMembers('pair#aaa#bbb'), ['aaa', 'bbb']);
assert.equal(pairMembers('aaa#bbb'), null);
assert.equal(pairMembers('pair#aaa'), null);

assert.equal(otherMember('pair#aaa#bbb', 'aaa'), 'bbb');
assert.equal(otherMember('pair#aaa#bbb', 'bbb'), 'aaa');
assert.equal(otherMember('pair#aaa#bbb', 'zzz'), null);

assert.equal(slotFor({ a: 'aaa', b: 'bbb' }, 'aaa'), 'a');
assert.equal(slotFor({ a: 'aaa', b: 'bbb' }, 'bbb'), 'b');
assert.equal(slotFor({ a: 'aaa', b: 'bbb' }, 'zzz'), null);

const record = {
  userId: 'pair#aaa#bbb',
  a: 'aaa',
  b: 'bbb',
  introA: { sentAt: 1 },
  updatedAt: 2,
  messages: [
    { id: 'm2', senderId: 'aaa', kind: 'text', text: 'second', at: 20 },
    { id: 'm1', senderId: 'bbb', kind: 'text', text: 'first', at: 10 },
  ],
};

/* A non-member gets nothing. This is the authorization boundary. */
assert.equal(toPairView(record, 'zzz'), null);
assert.equal(toPairSummary(record, 'zzz'), null);

/* Intro flags resolve per viewer, not per storage position. */
const asA = toPairView(record, 'aaa');
assert.equal(asA.personId, 'bbb');
assert.equal(asA.myIntroSent, true);
assert.equal(asA.theirIntroSent, false);
assert.equal(asA.connectedAt, null);

const asB = toPairView(record, 'bbb');
assert.equal(asB.personId, 'aaa');
assert.equal(asB.myIntroSent, false);
assert.equal(asB.theirIntroSent, true);

/* Messages come back oldest-first and carry the viewer's own perspective. */
assert.deepEqual(
  asA.messages.map((m) => [m.id, m.from]),
  [
    ['m1', 'them'],
    ['m2', 'me'],
  ],
);
assert.deepEqual(
  asB.messages.map((m) => [m.id, m.from]),
  [
    ['m1', 'me'],
    ['m2', 'them'],
  ],
);
assert.equal(asA.messages[0].personId, 'bbb', 'personId is always the OTHER member');

const summary = toPairSummary(record, 'aaa');
assert.equal(summary.messageCount, 2);
assert.equal(summary.lastMessageAt, 20);
assert.equal(summary.lastMessagePreview, 'second');
assert.equal(summary.lastSenderIsMe, true);
assert.equal(toPairSummary(record, 'bbb').lastSenderIsMe, false);

/* An empty pair summarises cleanly rather than throwing on `messages[-1]`. */
const empty = toPairSummary(
  { userId: 'pair#aaa#bbb', a: 'aaa', b: 'bbb', updatedAt: 0 },
  'aaa',
);
assert.equal(empty.messageCount, 0);
assert.equal(empty.lastMessageAt, null);
assert.equal(empty.lastMessagePreview, null);
assert.equal(empty.lastSenderIsMe, false);

assert.equal(messagePreview({ id: 'x', senderId: 'a', kind: 'voice', at: 1 }), 'Voice note');
assert.equal(
  messagePreview({ id: 'x', senderId: 'a', kind: 'text', text: 'z'.repeat(200), at: 1 }).length,
  120,
);

assert.equal(isPairMessage({ id: 'x', senderId: 'a', kind: 'text', at: 1 }), true);
assert.equal(isPairMessage({ id: 'x', senderId: 'a', kind: 'audio', at: 1 }), false);
assert.equal(isPairMessage({ id: 'x', kind: 'text', at: 1 }), false);
assert.equal(isPairMessage(null), false);

console.log('pair helpers OK');
