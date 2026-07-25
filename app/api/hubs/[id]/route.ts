/**
 * PATCH  /api/hubs/[id] -> add or remove a member
 * DELETE /api/hubs/[id] -> owner deletes the hub
 *
 * Next 16: the route context's `params` is a **Promise**. `RouteContext<…>` is
 * a generated global — no import — and `ctx.params` must be awaited.
 *
 * Identity is the session `sub`, never a body field. The body only says *who
 * is being changed*; who is *doing* the changing comes from the cookie.
 */

import { getSession } from '@/lib/cognito';
import { unauthorized } from '@/lib/session';
import {
  addMember,
  deleteHubItems,
  deleteHubRow,
  isMember,
  isOwner,
  readHub,
  removeMember,
} from '@/lib/hubsServer';

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/* -------------------------------------------------------------------------- */
/* PATCH                                                                      */
/* -------------------------------------------------------------------------- */

export async function PATCH(
  req: Request,
  ctx: RouteContext<'/api/hubs/[id]'>,
): Promise<Response> {
  const session = await getSession();
  if (!session?.sub) return unauthorized();
  const me = session.sub;

  const { id } = await ctx.params;
  const hubId = (id ?? '').trim();
  if (!hubId) return json({ ok: false, reason: 'invalid' }, 400);

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    /* handled by the validation below */
  }

  const action = body.action;
  const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : '';
  if ((action !== 'add' && action !== 'remove') || !memberId) {
    return json({ ok: false, reason: 'invalid' }, 400);
  }

  const hub = await readHub(hubId);
  if (!hub) return json({ ok: false, reason: 'not_found' }, 404);
  // Non-members get 403 rather than a hub they were never in.
  if (!isMember(hub, me)) return json({ ok: false, reason: 'forbidden' }, 403);

  if (action === 'add') {
    // Only the owner grows the roster. Anyone-can-add would let a member
    // quietly pull a stranger into someone else's project.
    if (!isOwner(hub, me)) return json({ ok: false, reason: 'owner_only' }, 403);

    const updated = await addMember(hubId, memberId);
    if (!updated) return json({ ok: false, reason: 'unavailable' }, 503);
    return json({ ok: true, hub: updated });
  }

  // remove — the owner may remove anyone; anyone may remove themselves (leave).
  const removingSelf = memberId === me;
  if (!removingSelf && !isOwner(hub, me)) {
    return json({ ok: false, reason: 'owner_only' }, 403);
  }
  // The owner leaving would strand a hub nobody can administer. Deleting it is
  // the honest action, and it has its own verb.
  if (removingSelf && isOwner(hub, me)) {
    return json({ ok: false, reason: 'owner_cannot_leave' }, 409);
  }

  const updated = await removeMember(hubId, memberId);
  if (!updated) return json({ ok: false, reason: 'unavailable' }, 503);
  return json({ ok: true, hub: updated });
}

/* -------------------------------------------------------------------------- */
/* DELETE                                                                     */
/* -------------------------------------------------------------------------- */

export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/hubs/[id]'>,
): Promise<Response> {
  const session = await getSession();
  if (!session?.sub) return unauthorized();

  const { id } = await ctx.params;
  const hubId = (id ?? '').trim();
  if (!hubId) return json({ ok: false, reason: 'invalid' }, 400);

  const hub = await readHub(hubId);
  if (!hub) return json({ ok: false, reason: 'not_found' }, 404);
  if (!isOwner(hub, session.sub)) return json({ ok: false, reason: 'owner_only' }, 403);

  const deleted = await deleteHubRow(hubId);
  if (!deleted) return json({ ok: false, reason: 'unavailable' }, 503);

  // Orphaned items are unreachable once the hub row is gone, so cleanup is
  // best-effort and never allowed to fail the delete the user asked for.
  void deleteHubItems(hubId).catch(() => {});

  return json({ ok: true, hubId });
}
