/**
 * The live people directory, backed by DynamoDB.
 *
 * Storage shape: **one row per registered person** in the dedicated
 * `yellow-users` table (PK `userId`, no sort key), holding
 * `{ userId, profile, updatedAt }`. Its only query is "everyone except me",
 * which is a single `Scan` of small rows — cheap because the table holds
 * nothing else. The per-user app-state blobs stay in `yellow-app` untouched,
 * so a growing state blob never slows the directory down.
 *
 * One row per person (rather than one row holding an array) also means each
 * signup is an independent idempotent `Put`: two people registering at the
 * same moment can't clobber each other the way a read-modify-write on a
 * shared array would.
 *
 * Fail-soft contract: `GET` always answers 200. If DynamoDB is slow,
 * unreachable or misconfigured it returns the local fallback with
 * `source: "fallback"`, so no page ever sees a failure.
 */

import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '@/lib/aws';
import {
  DEMO_PEOPLE_ENABLED,
  FALLBACK_PEOPLE,
  USERS_TABLE_NAME,
  isDirectoryPerson,
  type DirectoryPerson,
} from '@/lib/people';
import { SEED_PERSONAS } from '@/lib/seed';

/** Hard ceiling on the DynamoDB call — a hung read must not hang a page. */
const DDB_TIMEOUT_MS = 3_000;

function json(body: unknown): Response {
  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/* -------------------------------------------------------------------------- */
/* GET /api/people?excludeId=<id>                                             */
/* -------------------------------------------------------------------------- */

export async function GET(req: Request): Promise<Response> {
  let excludeId: string | null = null;
  try {
    excludeId = new URL(req.url).searchParams.get('excludeId')?.trim() || null;
  } catch {
    /* a malformed URL simply means "exclude nobody" */
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDB_TIMEOUT_MS);

  try {
    const result = await ddb.send(
      new ScanCommand({ TableName: USERS_TABLE_NAME }),
      { abortSignal: controller.signal },
    );

    const people: DirectoryPerson[] = [];
    const seen = new Set<string>();

    for (const item of result.Items ?? []) {
      const key = typeof item?.userId === 'string' ? item.userId : '';

      // Rows planted by `scripts/seed-personas.mjs --demo` answer to the same
      // switch as the bundled personas: invisible unless the flag is on.
      if (item?.demo === true && !DEMO_PEOPLE_ENABLED) continue;

      // A single corrupt row is skipped, never fatal — one bad signup must
      // not empty the whole orbit.
      const profile: unknown = item.profile;
      if (!isDirectoryPerson(profile)) continue;

      if (excludeId && (profile.id === excludeId || key === excludeId)) continue;
      if (seen.has(profile.id)) continue;

      seen.add(profile.id);
      people.push(profile);
    }

    // Opt-in escape hatch, off by default.
    if (DEMO_PEOPLE_ENABLED) {
      for (const persona of SEED_PERSONAS) {
        if (persona.id === excludeId || seen.has(persona.id)) continue;
        seen.add(persona.id);
        people.push(persona);
      }
    }

    return json({ people, source: 'dynamodb', count: people.length });
  } catch {
    // Slow, offline, denied, table missing — the client must never see a 500.
    return json({
      people: FALLBACK_PEOPLE.filter((p) => p.id !== excludeId),
      source: 'fallback',
      count: FALLBACK_PEOPLE.length,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* POST /api/people — publish this browser's profile into the directory       */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DDB_TIMEOUT_MS);

  try {
    const body: unknown = await req.json();
    const raw = body as { id?: unknown; profile?: unknown } | null;
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';

    if (!id || !isDirectoryPerson(raw?.profile)) {
      return json({ ok: false, reason: 'invalid' });
    }

    // The directory id is authoritative: it is what other browsers will use
    // as the route param for /connect and /chat. Injected by the caller, so
    // swapping the browser UUID for a Cognito `sub` needs no change here.
    const profile: DirectoryPerson = { ...raw.profile, id };

    // An UpdateCommand, not a Put. A Put replaces the entire item, and this
    // row also carries `voiceIntro` (written by /api/intro) and the `demo`
    // flag — so publishing a profile edit would silently delete the voice
    // intro the person recorded. `setProfile` publishes on every save, which
    // made that a matter of when, not if.
    await ddb.send(
      new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: { userId: id },
        UpdateExpression: 'SET #profile = :profile, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#profile': 'profile',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: { ':profile': profile, ':now': Date.now() },
      }),
      { abortSignal: controller.signal },
    );

    return json({ ok: true, id });
  } catch {
    // Discovery is best-effort; onboarding already succeeded locally.
    return json({ ok: false, reason: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
