'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '@/lib/store';
import { relativeTime, type HubSummary } from '@/lib/hubs';
import type { Profile } from '@/lib/types';
import {
  CoverageRow,
  EMOJI_FONT,
  Eyebrow,
  FILL_VIEWPORT,
  HUB_EMOJI,
  HubStyles,
  IconChevronRight,
  IconPlus,
  MemberStack,
  MONO,
  SANS,
} from './_ui';

const SHEET_MS = 420;

/** Apple's sheet curve. Used for every enter on this screen. */
const CURVE = 'cubic-bezier(.32,.72,0,1)';

/** Resolves member ids to live people. Empty until the directory answers. */
type PersonIndex = ReadonlyMap<string, Profile>;

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */
export default function HubsPage() {
  const router = useRouter();
  const { state, people, peopleSource, hubs, hubsSource, myId, createHub } =
    useAppState();

  const [sheetMounted, setSheetMounted] = useState(false);
  const [sheetShown, setSheetShown] = useState(false);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(HUB_EMOJI[0]);
  const [oneLiner, setOneLiner] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const me = state.me ?? null;
  /** Every id this session answers to — a hub we own must read as ours. */
  const mine = useMemo(
    () => new Set([myId, me?.id].filter(Boolean) as string[]),
    [myId, me?.id],
  );

  const personIndex: PersonIndex = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of people) map.set(p.id, p);
    // Our own profile is filtered out of the directory result, but we are a
    // member of every hub we can see — so it has to resolve to something.
    if (me) {
      for (const id of mine) map.set(id, me);
    }
    return map;
  }, [people, me, mine]);

  /* Sheet enter — two frames so the transform transition actually runs. */
  useEffect(() => {
    if (!sheetMounted) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSheetShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [sheetMounted]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (sheetShown) nameRef.current?.focus({ preventScroll: true });
  }, [sheetShown]);

  const closeSheet = () => {
    setSheetShown(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setSheetMounted(false);
      setName('');
      setOneLiner('');
      setEmoji(HUB_EMOJI[0]);
      setError(null);
    }, SHEET_MS);
  };

  useEffect(() => {
    if (!sheetMounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetMounted]);

  const openSheet = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setError(null);
    setSheetMounted(true);
  };

  const nameValid = name.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameValid || saving) return;
    setSaving(true);
    setError(null);

    // A hub is a shared row now, so the server — not this browser — decides
    // whether it exists. No optimistic hub that only one person can see.
    const hubId = await createHub({
      name: name.trim(),
      emoji,
      oneLiner: oneLiner.trim(),
    });
    setSaving(false);

    if (!hubId) {
      setError("Couldn't create that hub. Try again in a moment.");
      return;
    }
    closeSheet();
    /* Drop straight into the new hub — the workspace is the point. */
    router.push(`/hubs/${hubId}`);
  };

  /* Split by relationship. Being pulled into someone else's project is the
     new, meaningful state, so it leads. */
  const { owned, guest } = useMemo(() => {
    const ownedHubs: HubSummary[] = [];
    const guestHubs: HubSummary[] = [];
    for (const hub of hubs) {
      if (mine.has(hub.ownerId)) ownedHubs.push(hub);
      else guestHubs.push(hub);
    }
    return { owned: ownedHubs, guest: guestHubs };
  }, [hubs, mine]);

  /* ---------------------------------------------------------------- */
  /* Held until the directory answers too, so member avatars never pop
     in after the roster has already rendered without them. Hubs are
     deliberately NOT part of this gate: an unreachable hubs table must
     never leave the page spinning.                                     */
  if (!state.hydrated || peopleSource === 'loading') {
    return (
      <div
        className="flex w-full flex-col items-center justify-center"
        style={{ minHeight: FILL_VIEWPORT }}
      >
        <HubStyles />
        <span
          aria-hidden
          className="animate-pulse"
          style={{
            width: 36,
            height: 36,
            borderRadius: 9999,
            background:
              'radial-gradient(circle at 34% 26%, #FFE45C 0%, #FFC300 76%)',
            boxShadow: '0 0 28px rgba(255,214,10,.4)',
            opacity: 0.55,
          }}
        />
        <p style={{ marginTop: 18 }}>
          <Eyebrow>Loading your hubs</Eyebrow>
        </p>
      </div>
    );
  }

  const loadingHubs = hubsSource === 'loading';
  const offline = hubsSource === 'unavailable';

  return (
    <div className="flex w-full flex-col" style={{ minHeight: FILL_VIEWPORT }}>
      <HubStyles />

      {/* ---------------- Header ---------------- */}
      <header className="flex shrink-0 items-end justify-between gap-3 pb-5 pt-7">
        <div>
          <Eyebrow>Shared workspaces</Eyebrow>
          <h1 className="y-hb-title" style={{ fontFamily: SANS, marginTop: 7 }}>
            Hubs
          </h1>
        </div>

        {hubs.length > 0 ? (
          <button
            type="button"
            className="y-hb-pill y-hb-pill-sm"
            onClick={openSheet}
            style={{ fontFamily: SANS, marginBottom: 3 }}
          >
            <IconPlus size={14} />
            New hub
          </button>
        ) : null}
      </header>

      {/* ---------------- Body ---------------- */}
      <div className="flex flex-1 flex-col pb-10">
        {hubs.length === 0 ? (
          loadingHubs ? (
            <div className="flex flex-1 items-center justify-center pb-10">
              <Eyebrow>Reading your hubs</Eyebrow>
            </div>
          ) : (
            /* ---------------- Empty state ---------------- */
            <div className="y-hb-rise flex flex-1 flex-col items-center justify-center pb-10 text-center">
              {/* Three ghost rooms — the object language of the app, unfilled */}
              <span
                aria-hidden
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                {[44, 60, 44].map((s, i) => (
                  <span
                    key={i}
                    style={{
                      width: s,
                      height: s,
                      borderRadius: 18,
                      border: `1px dashed rgba(255,214,10,${i === 1 ? 0.38 : 0.16})`,
                      background:
                        i === 1
                          ? 'radial-gradient(circle at 42% 32%, rgba(255,214,10,.15), transparent 70%)'
                          : 'transparent',
                      boxShadow:
                        i === 1 ? '0 0 36px -8px rgba(255,214,10,.42)' : 'none',
                    }}
                  />
                ))}
              </span>

              <h2
                className="y-hb-h2"
                style={{
                  fontFamily: SANS,
                  fontSize: 25,
                  letterSpacing: '-0.028em',
                  lineHeight: 1.22,
                  margin: '30px 0 0',
                  maxWidth: 300,
                }}
              >
                A hub is a shared room for one project.
              </h2>

              <p
                className="y-hb-body"
                style={{ fontFamily: SANS, margin: '12px 0 0', maxWidth: 306 }}
              >
                Pull in the two or three people this one actually needs, then post
                updates, ask questions and track who&rsquo;s doing what. Everyone in
                the hub sees the same room.
              </p>

              {offline ? (
                <p style={{ margin: '16px 0 0' }}>
                  <Eyebrow tone="gold">Hubs are offline — try again shortly</Eyebrow>
                </p>
              ) : null}

              <div style={{ width: '100%', maxWidth: 306, marginTop: 30 }}>
                <button
                  type="button"
                  className="y-hb-cta"
                  onClick={openSheet}
                  style={{ fontFamily: SANS }}
                >
                  Create your first hub
                </button>
                <p style={{ margin: '16px 0 0' }}>
                  <Eyebrow>The right people for the right work</Eyebrow>
                </p>
              </div>
            </div>
          )
        ) : (
          /* ---------------- Hub list ---------------- */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            {guest.length > 0 ? (
              <HubGroup
                label="You were pulled in"
                tone="gold"
                hubs={guest}
                personIndex={personIndex}
                mine={mine}
                offset={0}
              />
            ) : null}

            {owned.length > 0 ? (
              <HubGroup
                label={guest.length > 0 ? 'Yours' : 'Your hubs'}
                hubs={owned}
                personIndex={personIndex}
                mine={mine}
                offset={guest.length}
              />
            ) : null}

            <p
              className="y-hb-foot"
              style={{ fontFamily: SANS, textAlign: 'center', margin: 0 }}
            >
              Only people you&rsquo;ve connected with can join a hub.
            </p>
          </div>
        )}
      </div>

      {/* ---------------- Create sheet ---------------- */}
      {sheetMounted ? (
        <div
          className="fixed inset-0 z-50"
          style={{ pointerEvents: sheetShown ? 'auto' : 'none' }}
        >
          <div
            aria-hidden
            onClick={closeSheet}
            className="y-hb-scrim"
            style={{
              opacity: sheetShown ? 1 : 0,
              transition: `opacity ${SHEET_MS}ms ${CURVE}`,
            }}
          />

          <form
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-label="Create a hub"
            className="y-hb-sheet absolute bottom-0 left-0 right-0 mx-auto w-full max-w-[480px]"
            style={{
              maxHeight: '90dvh',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              padding: '10px 20px max(24px, env(safe-area-inset-bottom))',
              transform: sheetShown ? 'translateY(0)' : 'translateY(102%)',
              transition: `transform ${SHEET_MS}ms ${CURVE}`,
              willChange: 'transform',
            }}
          >
            <div aria-hidden className="y-hb-grabber" style={{ marginBottom: 20 }} />

            <Eyebrow>New hub</Eyebrow>
            <h2
              className="y-hb-h2"
              style={{ fontFamily: SANS, margin: '8px 0 22px' }}
            >
              What are you building?
            </h2>

            <label htmlFor="hub-name" style={{ display: 'block' }}>
              <Eyebrow>Name</Eyebrow>
            </label>
            <input
              id="hub-name"
              ref={nameRef}
              className="y-hb-boxed"
              style={{ fontFamily: SANS, marginTop: 9 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="AI tutor for trades"
              maxLength={48}
              autoComplete="off"
            />

            <div style={{ marginTop: 22 }}>
              <Eyebrow>Icon</Eyebrow>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: 8,
                  marginTop: 9,
                }}
              >
                {HUB_EMOJI.map((opt) => {
                  const on = opt === emoji;
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={`y-hb-emoji${on ? ' y-hb-emoji-on' : ''}`}
                      aria-label={`Icon ${opt}`}
                      aria-pressed={on}
                      onClick={() => setEmoji(opt)}
                      style={{ fontFamily: EMOJI_FONT }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 22 }}>
              <label htmlFor="hub-line" style={{ display: 'block' }}>
                <Eyebrow>One-liner</Eyebrow>
              </label>
              <input
                id="hub-line"
                className="y-hb-boxed"
                style={{ fontFamily: SANS, marginTop: 9 }}
                value={oneLiner}
                onChange={(e) => setOneLiner(e.target.value)}
                placeholder="Ship a working demo by October"
                maxLength={80}
                autoComplete="off"
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="y-hb-sub"
                style={{ fontFamily: SANS, color: '#FFC300', margin: '16px 0 0' }}
              >
                {error}
              </p>
            ) : null}

            <div
              style={{
                marginTop: 26,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={closeSheet}
                className="y-hb-plain"
                style={{ fontFamily: SANS, flexShrink: 0 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="y-hb-cta"
                disabled={!nameValid || saving}
                style={{ fontFamily: SANS }}
              >
                {saving ? 'Creating…' : 'Create hub'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One inset group of hubs                                              */
/* ------------------------------------------------------------------ */
function HubGroup({
  label,
  tone,
  hubs,
  personIndex,
  mine,
  offset,
}: {
  label: string;
  tone?: 'dim' | 'gold';
  hubs: HubSummary[];
  personIndex: PersonIndex;
  mine: ReadonlySet<string>;
  /** Keeps the entrance stagger continuous across two groups. */
  offset: number;
}) {
  return (
    <section>
      <p style={{ margin: '0 0 10px', paddingLeft: 2 }}>
        <Eyebrow tone={tone}>{label}</Eyebrow>
      </p>
      <div className="y-hb-group">
        {hubs.map((hub, i) => (
          <HubRow
            key={hub.hubId}
            hub={hub}
            personIndex={personIndex}
            mine={mine}
            index={offset + i}
          />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One hub row                                                          */
/* ------------------------------------------------------------------ */
function HubRow({
  hub,
  personIndex,
  mine,
  index,
}: {
  hub: HubSummary;
  personIndex: PersonIndex;
  mine: ReadonlySet<string>;
  index: number;
}) {
  const owned = mine.has(hub.ownerId);

  /* Resolve to live people — an id with nobody behind it simply doesn't
     render, so the count and the avatars can never disagree. */
  const members = useMemo(
    () =>
      (hub.memberIds ?? [])
        .map((id) => personIndex.get(id))
        .filter((p): p is Profile => Boolean(p)),
    [hub.memberIds, personIndex],
  );

  /* The roster, not the avatars, is the source of truth for the count: a
     member whose directory row hasn't loaded yet is still a person. */
  const others = Math.max(0, (hub.memberIds?.length ?? 1) - 1);

  const owner = personIndex.get(hub.ownerId);
  const ownerFirstName = owner ? owner.name.trim().split(/\s+/)[0] : null;

  const signal = hub.signal;
  const hasSignal = Boolean(
    signal && (signal.openTasks > 0 || signal.lastActivityAt),
  );

  return (
    <Link
      href={`/hubs/${hub.hubId}`}
      className="y-hb-row y-hb-in"
      style={
        {
          '--sep': '70px',
          alignItems: 'flex-start',
          fontFamily: SANS,
          /* Stagger the first six rows only — past that it reads as lag. */
          animationDelay: index < 6 ? `${index * 45}ms` : '0ms',
        } as React.CSSProperties
      }
    >
      <span className="y-hb-tile">
        <span
          aria-hidden
          style={{ fontFamily: EMOJI_FONT, fontSize: 21, lineHeight: 1 }}
        >
          {hub.emoji || '🚀'}
        </span>
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="y-hb-headline y-hb-clip" style={{ flex: 1, minWidth: 0 }}>
            {hub.name}
          </span>

          {/* The new, meaningful state: someone put you in their project.
              A chip, not a banner — it labels the row, it isn't the row. */}
          {!owned ? (
            <span
              className="y-hb-chip y-hb-chip-tint"
              style={{ flexShrink: 0, maxWidth: 140, overflow: 'hidden' }}
            >
              <span className="y-hb-clip">
                {ownerFirstName ? `Invited by ${ownerFirstName}` : 'Invited'}
              </span>
            </span>
          ) : null}
        </span>

        {hub.oneLiner ? (
          <span
            className="y-hb-sub y-hb-clip"
            style={{
              display: 'block',
              marginTop: 3,
              color: 'rgba(255,248,231,.5)',
            }}
          >
            {hub.oneLiner}
          </span>
        ) : null}

        {/* Who is in it, and what they cover between them */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 10,
          }}
        >
          <MemberStack members={members} size={24} />
          <span className="y-hb-mono" style={{ fontFamily: MONO }}>
            {others === 0 ? 'Just you so far' : `You + ${others}`}
          </span>
        </span>

        {members.length > 0 ? (
          <span style={{ display: 'block', marginTop: 9 }}>
            <CoverageRow
              members={members}
              limit={3}
              total={hub.memberIds.length}
              summary={false}
            />
          </span>
        ) : null}

        {/* Live signal — is anything actually happening in here? */}
        {hasSignal && signal ? (
          <span
            className="y-hb-mono"
            style={{ display: 'block', marginTop: 9, fontFamily: MONO }}
          >
            {signal.openTasks > 0 ? (
              <span>
                {signal.openTasks} open task{signal.openTasks === 1 ? '' : 's'}
              </span>
            ) : null}
            {signal.overdueTasks > 0 ? (
              <>
                {signal.openTasks > 0 ? <span className="y-hb-dot">·</span> : null}
                <span className="y-hb-warn">{signal.overdueTasks} overdue</span>
              </>
            ) : null}
            {signal.lastActivityAt ? (
              <>
                {signal.openTasks > 0 || signal.overdueTasks > 0 ? (
                  <span className="y-hb-dot">·</span>
                ) : null}
                <span>last update {relativeTime(signal.lastActivityAt)} ago</span>
              </>
            ) : null}
          </span>
        ) : null}
      </span>

      <span className="y-hb-chev" style={{ alignSelf: 'center' }}>
        <IconChevronRight />
      </span>
    </Link>
  );
}
