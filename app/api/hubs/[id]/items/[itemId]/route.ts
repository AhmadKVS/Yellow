/**
 * PATCH  /api/hubs/[id]/items/[itemId] -> advance a task, or edit your own post
 * DELETE /api/hubs/[id]/items/[itemId] -> author, task creator, or hub owner
 *
 * Permissions are deliberately shallow. **Tasks belong to the hub**: anyone in
 * it can move one along, reassign it or set a deadline, because a shared task
 * board where only the creator can tick something off isn't a shared board.
 * **Posts belong to their author**: nobody else gets to rewrite what you said.
 *
 * Next 16: `ctx.params` is a Promise and must be awaited.
 */

import { getSession } from '@/lib/cognito';
import { unauthorized } from '@/lib/session';
import { isTaskStatus } from '@/lib/hubs';
import {
  deleteHubItemRow,
  isMember,
  isOwner,
  patchHubItem,
  readHub,
  readHubItem,
  type ItemPatch,
} from '@/lib/hubsServer';

const TEXT_MAX = 1_000;
const TITLE_MAX = 120;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Resolves the hub, the item, and whether this caller may be here at all. */
async function load(
  ctx: RouteContext<'/api/hubs/[id]/items/[itemId]'>,
  me: string,
): Promise<
  | { ok: false; response: Response }
  | {
      ok: true;
      hubId: string;
      item: NonNullable<Awaited<ReturnType<typeof readHubItem>>>;
      hubOwner: boolean;
    }
> {
  const { id, itemId } = await ctx.params;
  const hubId = (id ?? '').trim();
  const key = (itemId ?? '').trim();
  if (!hubId || !key) {
    return { ok: false, response: json({ ok: false, reason: 'invalid' }, 400) };
  }

  const hub = await readHub(hubId);
  if (!hub) {
    return { ok: false, response: json({ ok: false, reason: 'not_found' }, 404) };
  }
  if (!isMember(hub, me)) {
    return { ok: false, response: json({ ok: false, reason: 'forbidden' }, 403) };
  }

  const item = await readHubItem(hubId, key);
  if (!item) {
    return { ok: false, response: json({ ok: false, reason: 'not_found' }, 404) };
  }

  return { ok: true, hubId, item, hubOwner: isOwner(hub, me) };
}

/* -------------------------------------------------------------------------- */
/* PATCH                                                                      */
/* -------------------------------------------------------------------------- */

export async function PATCH(
  req: Request,
  ctx: RouteContext<'/api/hubs/[id]/items/[itemId]'>,
): Promise<Response> {
  const session = await getSession();
  if (!session?.sub) return unauthorized();
  const me = session.sub;

  const loaded = await load(ctx, me);
  if (!loaded.ok) return loaded.response;
  const { hubId, item } = loaded;

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    /* an empty patch is caught below */
  }

  const patch: ItemPatch = {};

  if (item.kind === 'task') {
    if (body.status !== undefined) {
      if (!isTaskStatus(body.status)) {
        return json({ ok: false, reason: 'invalid_status' }, 400);
      }
      patch.status = body.status;
    }
    if (body.assigneeId !== undefined) {
      if (body.assigneeId === null || body.assigneeId === '') {
        patch.assigneeId = null;
      } else if (typeof body.assigneeId === 'string') {
        // Re-read the roster: assigning someone who has since left would
        // render as a permanently blank name.
        const hub = await readHub(hubId);
        const claimed = body.assigneeId.trim();
        if (!hub || !isMember(hub, claimed)) {
          return json({ ok: false, reason: 'assignee_not_member' }, 400);
        }
        patch.assigneeId = claimed;
      } else {
        return json({ ok: false, reason: 'invalid' }, 400);
      }
    }
    if (body.dueAt !== undefined) {
      if (body.dueAt === null) {
        patch.dueAt = null;
      } else if (typeof body.dueAt === 'number' && Number.isFinite(body.dueAt)) {
        patch.dueAt = Math.floor(body.dueAt);
      } else {
        return json({ ok: false, reason: 'invalid' }, 400);
      }
    }
    if (typeof body.title === 'string') {
      const title = body.title.trim().slice(0, TITLE_MAX);
      if (!title) return json({ ok: false, reason: 'title_required' }, 400);
      patch.title = title;
    }
  } else {
    // A post is the author's own words.
    if (item.authorId !== me) return json({ ok: false, reason: 'author_only' }, 403);
    if (typeof body.text !== 'string') return json({ ok: false, reason: 'invalid' }, 400);
    const value = body.text.trim().slice(0, TEXT_MAX);
    if (!value) return json({ ok: false, reason: 'text_required' }, 400);
    patch.text = value;
  }

  if (Object.keys(patch).length === 0) {
    return json({ ok: false, reason: 'nothing_to_update' }, 400);
  }

  const updated = await patchHubItem(hubId, item.itemId, patch);
  if (!updated) return json({ ok: false, reason: 'unavailable' }, 503);

  return json({ ok: true, item: updated });
}

/* -------------------------------------------------------------------------- */
/* DELETE                                                                     */
/* -------------------------------------------------------------------------- */

export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/hubs/[id]/items/[itemId]'>,
): Promise<Response> {
  const session = await getSession();
  if (!session?.sub) return unauthorized();
  const me = session.sub;

  const loaded = await load(ctx, me);
  if (!loaded.ok) return loaded.response;
  const { hubId, item, hubOwner } = loaded;

  const mine = item.kind === 'post' ? item.authorId === me : item.createdBy === me;
  if (!mine && !hubOwner) return json({ ok: false, reason: 'forbidden' }, 403);

  const deleted = await deleteHubItemRow(hubId, item.itemId);
  if (!deleted) return json({ ok: false, reason: 'unavailable' }, 503);

  return json({ ok: true, itemId: item.itemId });
}
