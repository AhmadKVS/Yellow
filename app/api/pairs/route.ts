/**
 * GET /api/pairs -> { pairs: PairSummary[] }
 *
 * Every connection this person is part of, summarised. This is what the
 * notification poller reads on an interval, so it deliberately does *not*
 * carry message bodies — only a count, the last line, and who sent it.
 *
 * Always answers 200. An unreachable table means an empty inbox for one poll,
 * never an error the UI has to render.
 */

import { listPairsFor } from '@/lib/pairServer';
import { toPairSummary, type PairSummary } from '@/lib/pair';
import { resolveCaller, unauthorized } from '@/lib/session';

export async function GET(req: Request): Promise<Response> {
  let claimed: string | null = null;
  try {
    claimed = new URL(req.url).searchParams.get('userId')?.trim() || null;
  } catch {
    /* nothing claimed */
  }

  const me = await resolveCaller(claimed);
  if (!me) return unauthorized();

  const { ok, records } = await listPairsFor(me);

  const pairs: PairSummary[] = [];
  for (const record of records) {
    const summary = toPairSummary(record, me);
    if (summary) pairs.push(summary);
  }

  pairs.sort((x, y) => (y.lastMessageAt ?? y.updatedAt) - (x.lastMessageAt ?? x.updatedAt));

  // `ok` is load-bearing, not decoration. The client reconciles its local
  // connections against this list, so it must be able to tell "you have no
  // connections" from "the table was unreachable" — the second one is not
  // permission to forget every connection the user has.
  return Response.json(
    { ok, pairs, count: pairs.length },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
