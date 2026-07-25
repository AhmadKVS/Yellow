/**
 * GET  /api/hubs -> every hub the caller is a member of
 * POST /api/hubs -> create one, with the caller as owner and first member
 *
 * Identity comes from the session cookie and nowhere else. `/api/state` still
 * trusts a `userId` query param (a known gap on the roadmap); repeating that
 * here would mean anyone could read anyone's hubs by guessing a `sub`, so this
 * route never looks at the body or the query for who is calling.
 *
 * Fail-soft: GET always answers 200. `ok: false` means "we couldn't ask", which
 * the client renders as a degraded empty state rather than an error.
 */

import { getSession } from '@/lib/cognito';
import { unauthorized } from '@/lib/session';
import { newHubId, type HubSignal, type SharedHub } from '@/lib/hubs';
import { listHubsFor, putHub, readHubSignal } from '@/lib/hubsServer';

const NAME_MAX = 48;
const ONE_LINER_MAX = 80;
const EMOJI_MAX = 8;

/** Ceiling on the per-hub signal enrichment, so a long list can't fan out. */
const SIGNAL_LIMIT = 24;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session?.sub) return unauthorized();

  const { ok, hubs } = await listHubsFor(session.sub);
  if (!ok) {
    // The table is unreachable. 200 with `ok: false` so the page renders its
    // empty state instead of a fetch rejection and a console error storm.
    return json({ ok: false, hubs: [], count: 0, reason: 'unavailable' });
  }

  // Best-effort enrichment: "3 open · last update 2h ago" on the list screen.
  // `allSettled` plus a null-tolerant merge means a hub-items outage costs the
  // signal line and nothing else — you still see every hub you're in.
  const signals = await Promise.allSettled(
    hubs.slice(0, SIGNAL_LIMIT).map((hub) => readHubSignal(hub.hubId)),
  );

  const withSignal = hubs.map((hub, index) => {
    const settled = signals[index];
    const signal: HubSignal | null =
      settled && settled.status === 'fulfilled' ? settled.value : null;
    return signal ? { ...hub, signal } : hub;
  });

  return json({ ok: true, hubs: withSignal, count: withSignal.length });
}

/* -------------------------------------------------------------------------- */
/* POST                                                                       */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session?.sub) return unauthorized();

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    /* a malformed body is just an invalid request, never a 500 */
  }

  const name = text(body.name, NAME_MAX);
  if (!name) return json({ ok: false, reason: 'name_required' }, 400);

  const now = Date.now();
  const hub: SharedHub = {
    hubId: newHubId(),
    name,
    emoji: text(body.emoji, EMOJI_MAX) || '🚀',
    oneLiner: text(body.oneLiner, ONE_LINER_MAX),
    ownerId: session.sub,
    // The owner is a member from the first write. Everything downstream — the
    // membership scan, the items permission check — reads `memberIds` alone.
    memberIds: [session.sub],
    createdAt: now,
    updatedAt: now,
  };

  const created = await putHub(hub);
  if (!created) return json({ ok: false, reason: 'unavailable' }, 503);

  return json({ ok: true, hub: created }, 201);
}
