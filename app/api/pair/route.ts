/**
 * GET /api/pair?with=<id> -> { pair: PairView | null }
 *
 * The one read both the connect screen and the chat thread poll. Returns the
 * shared row resolved for *this* caller: their own intro flag, the other
 * person's, and the thread with each message already marked `me` or `them`.
 *
 * A caller who isn't a member of the pair gets `{ pair: null }` — that check is
 * structural rather than an `if`, because `toPairView` returns `null` for a
 * non-member and there is no other way to build the response.
 */

import { readPair } from '@/lib/pairServer';
import { toPairView } from '@/lib/pair';
import { resolveCaller, unauthorized } from '@/lib/session';

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: Request): Promise<Response> {
  let them = '';
  let claimed: string | null = null;
  try {
    const params = new URL(req.url).searchParams;
    them = params.get('with')?.trim() ?? '';
    claimed = params.get('userId')?.trim() || null;
  } catch {
    /* a malformed URL is simply a pair we can't identify */
  }

  const me = await resolveCaller(claimed);
  if (!me) return unauthorized();
  if (!them) return json({ pair: null });

  const record = await readPair(me, them);
  if (!record) return json({ pair: null });

  return json({ pair: toPairView(record, me) });
}
