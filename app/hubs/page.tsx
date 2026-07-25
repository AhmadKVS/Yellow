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
  MemberStack,
  SANS,
} from './_ui';

const SHEET_MS = 420;

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
            width: 40,
            height: 40,
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

      {/* Header */}
      <header className="flex shrink-0 items-end justify-between gap-3 pb-4 pt-6">
        <div>
          <Eyebrow>Shared workspaces</Eyebrow>
          <h1
            style={{
              fontFamily: SANS,
              fontSize: 28,
              fontWeight: 660,
              letterSpacing: '-0.032em',
              lineHeight: 1.1,
              color: '#FFF8E7',
              margin: '6px 0 0',
            }}
          >
            Hubs
          </h1>
        </div>

        {hubs.length > 0 ? (
          <button
            type="button"
            className="y-hb-pill"
            onClick={openSheet}
            style={{ fontFamily: SANS }}
          >
            <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>
              +
            </span>
            New hub
          </button>
        ) : null}
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col pb-8">
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
                {[46, 62, 46].map((s, i) => (
                  <span
                    key={i}
                    style={{
                      width: s,
                      height: s,
                      borderRadius: 18,
                      border: `1.5px dashed rgba(255,214,10,${i === 1 ? 0.42 : 0.18})`,
                      background:
                        i === 1
                          ? 'radial-gradient(circle at 40% 30%, rgba(255,214,10,.14), transparent 70%)'
                          : 'transparent',
                      boxShadow:
                        i === 1 ? '0 0 34px -6px rgba(255,214,10,.35)' : 'none',
                    }}
                  />
                ))}
              </span>

              <h2
                style={{
                  fontFamily: SANS,
                  fontSize: 25,
                  fontWeight: 600,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.22,
                  color: '#FFF8E7',
                  margin: '30px 0 0',
                  maxWidth: 300,
                }}
              >
                A hub is a shared room for one project.
              </h2>

              <p
                style={{
                  fontFamily: SANS,
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  letterSpacing: '-0.006em',
                  color: 'rgba(255,248,231,.52)',
                  margin: '12px 0 0',
                  maxWidth: 300,
                }}
              >
                Pull in the two or three people this one actually needs, then
                post updates, ask questions and track who&rsquo;s doing what.
                Everyone in the hub sees the same room.
              </p>

              {offline ? (
                <p style={{ margin: '14px 0 0' }}>
                  <Eyebrow>Hubs are offline right now — try again shortly</Eyebrow>
                </p>
              ) : null}

              <div style={{ width: '100%', maxWidth: 300, marginTop: 30 }}>
                <button
                  type="button"
                  className="y-hb-cta"
                  onClick={openSheet}
                  style={{ fontFamily: SANS }}
                >
                  Create your first hub
                </button>
                <p style={{ margin: '14px 0 0' }}>
                  <Eyebrow>The right people for the right work</Eyebrow>
                </p>
              </div>
            </div>
          )
        ) : (
          /* ---------------- Hub list ---------------- */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {guest.length > 0 ? (
              <section>
                <p style={{ margin: '0 0 9px' }}>
                  <Eyebrow tone="gold">You were pulled in</Eyebrow>
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {guest.map((hub) => (
                    <HubCard
                      key={hub.hubId}
                      hub={hub}
                      personIndex={personIndex}
                      mine={mine}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {owned.length > 0 ? (
              <section>
                {guest.length > 0 ? (
                  <p style={{ margin: '0 0 9px' }}>
                    <Eyebrow>Yours</Eyebrow>
                  </p>
                ) : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {owned.map((hub) => (
                    <HubCard
                      key={hub.hubId}
                      hub={hub}
                      personIndex={personIndex}
                      mine={mine}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <p
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                lineHeight: 1.5,
                textAlign: 'center',
                color: 'rgba(255,248,231,.3)',
                margin: 0,
              }}
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
            className="absolute inset-0"
            style={{
              background: 'rgba(5,4,2,.66)',
              backdropFilter: 'blur(4px) saturate(.85)',
              WebkitBackdropFilter: 'blur(4px) saturate(.85)',
              opacity: sheetShown ? 1 : 0,
              transition: `opacity ${SHEET_MS}ms cubic-bezier(.22,1,.36,1)`,
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
              padding: '14px 22px max(26px, env(safe-area-inset-bottom))',
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              borderTop: '1px solid rgba(255,214,10,.18)',
              backgroundImage: [
                'radial-gradient(120% 62% at 50% 0%, rgba(255,195,0,.10) 0%, rgba(255,195,0,0) 62%)',
                'linear-gradient(180deg, #17140C 0%, #100E09 40%, #0B0A08 100%)',
              ].join(','),
              boxShadow: '0 -30px 90px -26px rgba(255,178,0,.22)',
              transform: sheetShown ? 'translateY(0)' : 'translateY(102%)',
              transition: `transform ${SHEET_MS}ms cubic-bezier(.22,1,.36,1)`,
              willChange: 'transform',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 38,
                height: 4,
                borderRadius: 99,
                background: 'rgba(255,248,231,.2)',
                margin: '0 auto 20px',
              }}
            />

            <Eyebrow>New hub</Eyebrow>
            <h2
              style={{
                fontFamily: SANS,
                fontSize: 22,
                fontWeight: 660,
                letterSpacing: '-0.028em',
                color: '#FFF8E7',
                margin: '7px 0 22px',
              }}
            >
              What are you building?
            </h2>

            <label htmlFor="hub-name" style={{ display: 'block' }}>
              <Eyebrow>Name</Eyebrow>
            </label>
            <input
              id="hub-name"
              ref={nameRef}
              className="y-hb-input"
              style={{ fontFamily: SANS, marginTop: 8 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="AI tutor for trades"
              maxLength={48}
              autoComplete="off"
            />

            <div style={{ marginTop: 20 }}>
              <Eyebrow>Icon</Eyebrow>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: 8,
                  marginTop: 8,
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

            <div style={{ marginTop: 20 }}>
              <label htmlFor="hub-line" style={{ display: 'block' }}>
                <Eyebrow>One-liner</Eyebrow>
              </label>
              <input
                id="hub-line"
                className="y-hb-input"
                style={{ fontFamily: SANS, marginTop: 8 }}
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
                style={{
                  fontFamily: SANS,
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: 'rgba(255,138,102,.92)',
                  margin: '16px 0 0',
                }}
              >
                {error}
              </p>
            ) : null}

            <div style={{ marginTop: 26, display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={closeSheet}
                className="y-hb-pill y-hb-quiet"
                style={{
                  fontFamily: SANS,
                  height: 54,
                  padding: '0 20px',
                  borderRadius: 16,
                }}
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
/* Hub card                                                             */
/* ------------------------------------------------------------------ */
function HubCard({
  hub,
  personIndex,
  mine,
}: {
  hub: HubSummary;
  personIndex: PersonIndex;
  mine: ReadonlySet<string>;
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
      className={`y-hb-card${owned ? '' : ' y-hb-card-guest'}`}
    >
      <div className="y-hb-head">
        <span className="y-hb-tile">
          <span
            aria-hidden
            style={{ fontFamily: EMOJI_FONT, fontSize: 22, lineHeight: 1 }}
          >
            {hub.emoji || '🚀'}
          </span>
        </span>

        <span style={{ flex: 1, minWidth: 0 }}>
          {/* The new, meaningful state: someone put you in their project. */}
          {!owned ? (
            <span style={{ display: 'block', marginBottom: 4 }}>
              <Eyebrow tone="gold">
                {ownerFirstName
                  ? `${ownerFirstName} added you`
                  : 'You were added to this'}
              </Eyebrow>
            </span>
          ) : null}

          <span
            style={{
              display: 'block',
              fontFamily: SANS,
              fontSize: 16,
              fontWeight: 650,
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
              color: '#FFF8E7',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hub.name}
          </span>

          {hub.oneLiner ? (
            <span
              style={{
                display: 'block',
                fontFamily: SANS,
                fontSize: 13,
                lineHeight: 1.4,
                color: 'rgba(255,248,231,.46)',
                marginTop: 3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {hub.oneLiner}
            </span>
          ) : null}

          {/* Who is in it */}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              marginTop: 9,
            }}
          >
            <MemberStack members={members} />
            <Eyebrow tone={others ? 'gold' : 'dim'}>
              {others === 0 ? 'Just you so far' : `You + ${others}`}
            </Eyebrow>
          </span>

          {/* What they cover between them — the reason the hub exists */}
          {members.length > 0 ? (
            <span style={{ display: 'block', marginTop: 10 }}>
              <CoverageRow members={members} total={hub.memberIds.length} />
            </span>
          ) : null}

          {/* Live signal — is anything actually happening in here? */}
          {hasSignal && signal ? (
            <span
              style={{
                display: 'block',
                marginTop: 9,
                fontFamily: SANS,
                fontSize: 12,
                lineHeight: 1.4,
                color: 'rgba(255,248,231,.44)',
              }}
            >
              {signal.openTasks > 0 ? (
                <span>
                  {signal.openTasks} open task{signal.openTasks === 1 ? '' : 's'}
                </span>
              ) : null}
              {signal.overdueTasks > 0 ? (
                <>
                  <span className="y-hb-dot">·</span>
                  <span className="y-hb-warn">{signal.overdueTasks} overdue</span>
                </>
              ) : null}
              {signal.lastActivityAt ? (
                <>
                  {signal.openTasks > 0 ? <span className="y-hb-dot">·</span> : null}
                  <span>last update {relativeTime(signal.lastActivityAt)} ago</span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>

        <span
          aria-hidden
          style={{
            flexShrink: 0,
            alignSelf: 'center',
            color: 'rgba(255,248,231,.32)',
          }}
        >
          <svg width="8" height="13" viewBox="0 0 8 13">
            <path
              d="M1.5 1L6.5 6.5L1.5 12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
      </div>
    </Link>
  );
}
