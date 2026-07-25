/**
 * GET  /api/hubs/[id]/items -> the whole workspace: posts and tasks
 * POST /api/hubs/[id]/items -> add a post or a task
 *
 * Membership is the permission model. Everything here first reads the hub row
 * and checks `memberIds` against the session `sub`, so a hub's contents are
 * exactly as private as its roster.
 *
 * Next 16: `ctx.params` is a Promise and must be awaited.
 */

import { getSession } from '@/lib/cognito';
import { unauthorized } from '@/lib/session';
import { newItemId, isPostKind, type HubItem } from '@/lib/hubs';
import { isMember, listHubItems, putHubItem, readHub } from '@/lib/hubsServer';

const TEXT_MAX = 1_000;
const TITLE_MAX = 120;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/hubs/[id]/items'>,
): Promise<Response> {
  const session = await getSession();
  if (!session?.sub) return unauthorized();

  const { id } = await ctx.params;
  const hubId = (id ?? '').trim();
  if (!hubId) return json({ ok: false, items: [], reason: 'invalid' }, 400);

  const hub = await readHub(hubId);
  if (!hub) return json({ ok: false, items: [], reason: 'not_found' }, 404);
  if (!isMember(hub, session.sub)) {
    return json({ ok: false, items: [], reason: 'forbidden' }, 403);
  }

  const { ok, items } = await listHubItems(hubId);
  // A table outage is an empty workspace for one poll, never an error the page
  // has to render.
  return json({ ok, items, count: items.length });
}

/* -------------------------------------------------------------------------- */
/* POST                                                                       */
/* -------------------------------------------------------------------------- */

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/hubs/[id]/items'>,
): Promise<Response> {
  const session = await getSession();
  if (!session?.sub) return unauthorized();
  const me = session.sub;

  const { id } = await ctx.params;
  const hubId = (id ?? '').trim();
  if (!hubId) return json({ ok: false, reason: 'invalid' }, 400);

  const hub = await readHub(hubId);
  if (!hub) return json({ ok: false, reason: 'not_found' }, 404);
  if (!isMember(hub, me)) return json({ ok: false, reason: 'forbidden' }, 403);

  const body = await readBody(req);
  const now = Date.now();
  let item: HubItem;

  if (body.kind === 'task') {
    const title =
      typeof body.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) : '';
    if (!title) return json({ ok: false, reason: 'title_required' }, 400);

    // An assignee who isn't in the hub would render as a blank row forever.
    const claimed = typeof body.assigneeId === 'string' ? body.assigneeId.trim() : '';
    const assigneeId = claimed && isMember(hub, claimed) ? claimed : '';
    const dueAt =
      typeof body.dueAt === 'number' && Number.isFinite(body.dueAt)
        ? Math.floor(body.dueAt)
        : null;

    item = {
      itemId: newItemId('task', now),
      hubId,
      kind: 'task',
      title,
      ...(assigneeId ? { assigneeId } : {}),
      ...(dueAt !== null ? { dueAt } : {}),
      status: 'todo',
      createdBy: me,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    const value =
      typeof body.text === 'string' ? body.text.trim().slice(0, TEXT_MAX) : '';
    if (!value) return json({ ok: false, reason: 'text_required' }, 400);

    item = {
      itemId: newItemId('post', now),
      hubId,
      kind: 'post',
      authorId: me,
      text: value,
      postKind: isPostKind(body.postKind) ? body.postKind : 'update',
      createdAt: now,
    };
  }

  const created = await putHubItem(item);
  if (!created) return json({ ok: false, reason: 'unavailable' }, 503);

  return json({ ok: true, item: created }, 201);
}
