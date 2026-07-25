'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import Bubble from '@/components/Bubble';
import { useAppState } from '@/lib/store';
import type { Hub, Profile, SeedPersona } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Type stacks                                                          */
/* ------------------------------------------------------------------ */
const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';
const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

const SHEET_MS = 420;

/**
 * PhoneFrame owns the scroll container and the column's horizontal padding,
 * so pages size themselves against the viewport rather than a flex parent.
 */
const FILL_VIEWPORT = 'calc(100dvh - 96px)';

/** Project-shaped, not face-shaped — a hub is a thing you build, not a person. */
const HUB_EMOJI = [
  '🚀',
  '🧪',
  '🌱',
  '🛠️',
  '🧠',
  '📚',
  '🎧',
  '🏗️',
  '🔭',
  '🍜',
  '⚡',
  '🌍',
];

/** Resolves member ids to live people. Empty until the directory answers. */
type PersonIndex = ReadonlyMap<string, SeedPersona>;

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — React hoists + dedupes by href                   */
/* ------------------------------------------------------------------ */
function HubStyles() {
  return (
    <style href="yellow-hubs" precedence="high">{`
.y-hb-card{
  border-radius:20px; overflow:hidden;
  border:1px solid rgba(255,214,10,.1);
  background:linear-gradient(180deg, rgba(255,248,231,.045) 0%, rgba(255,248,231,.014) 100%);
  transition:border-color 260ms linear, background 260ms linear;
}
.y-hb-card:hover{ border-color:rgba(255,214,10,.22) }
.y-hb-card-open{ border-color:rgba(255,214,10,.3); background:linear-gradient(180deg, rgba(255,214,10,.06) 0%, rgba(255,248,231,.018) 100%) }

.y-hb-head{
  display:flex; align-items:center; gap:13px; width:100%;
  padding:14px; text-align:left; cursor:pointer;
  background:transparent; border:0; color:inherit;
}
.y-hb-head:focus-visible{ outline:2px solid #FFD60A; outline-offset:-2px; border-radius:20px }

.y-hb-tile{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:46px; height:46px; border-radius:14px;
  background:linear-gradient(160deg, rgba(255,214,10,.16) 0%, rgba(255,214,10,.035) 100%);
  border:1px solid rgba(255,214,10,.18);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
}

.y-hb-cta{
  display:flex; align-items:center; justify-content:center; gap:8px;
  width:100%; height:54px; border-radius:16px; border:0; cursor:pointer;
  font-size:16px; font-weight:680; letter-spacing:-.012em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 12px 32px -12px rgba(255,195,0,.62), inset 0 1px 0 rgba(255,255,255,.62);
  transition:transform 280ms cubic-bezier(.22,1,.36,1), box-shadow 280ms cubic-bezier(.22,1,.36,1),
             filter 200ms linear, opacity 200ms linear;
}
.y-hb-cta:hover:not(:disabled){ transform:translateY(-1.5px); filter:brightness(1.05);
  box-shadow:0 18px 40px -12px rgba(255,195,0,.75), inset 0 1px 0 rgba(255,255,255,.7); }
.y-hb-cta:active:not(:disabled){ transform:translateY(1px) scale(.993); transition-duration:110ms }
.y-hb-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px }
.y-hb-cta:disabled{
  cursor:default; opacity:.34; background:rgba(255,248,231,.1);
  color:rgba(255,248,231,.5); box-shadow:none;
}

.y-hb-pill{
  display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 13px;
  border-radius:9999px; cursor:pointer; white-space:nowrap;
  font-size:13px; font-weight:620; letter-spacing:-.008em;
  color:#FFD60A; background:rgba(255,214,10,.07);
  border:1px solid rgba(255,214,10,.28);
  transition:background 200ms linear, border-color 200ms linear, color 200ms linear;
}
.y-hb-pill:hover{ background:rgba(255,214,10,.14); border-color:rgba(255,214,10,.5) }
.y-hb-pill:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }

.y-hb-add{
  display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 12px 0 5px;
  border-radius:9999px; cursor:pointer; white-space:nowrap;
  font-size:13px; font-weight:600; letter-spacing:-.008em;
  color:rgba(255,248,231,.86); background:rgba(255,248,231,.04);
  border:1px solid rgba(255,248,231,.12);
  transition:background 200ms linear, border-color 200ms linear, transform 200ms cubic-bezier(.22,1,.36,1);
}
.y-hb-add:hover{ background:rgba(255,214,10,.09); border-color:rgba(255,214,10,.4) }
.y-hb-add:active{ transform:scale(.96); transition-duration:110ms }
.y-hb-add:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }

.y-hb-x{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:28px; height:28px; border-radius:9999px; cursor:pointer;
  color:rgba(255,248,231,.4); background:transparent;
  border:1px solid rgba(255,248,231,.1);
  transition:color 200ms linear, border-color 200ms linear, background 200ms linear;
}
.y-hb-x:hover{ color:#FFF8E7; border-color:rgba(255,120,90,.5); background:rgba(255,120,90,.1) }
.y-hb-x:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }

.y-hb-input{
  width:100%; height:48px; padding:0 15px; border-radius:14px;
  border:1px solid rgba(255,214,10,.15); background:rgba(255,248,231,.04);
  color:#FFF8E7; font-size:15px; letter-spacing:-.008em; outline:none;
  transition:border-color 220ms linear, background 220ms linear;
}
.y-hb-input::placeholder{ color:rgba(255,248,231,.28) }
.y-hb-input:focus{ border-color:rgba(255,214,10,.5); background:rgba(255,248,231,.07) }

.y-hb-emoji{
  display:inline-flex; align-items:center; justify-content:center;
  width:100%; aspect-ratio:1; border-radius:13px; cursor:pointer;
  font-size:21px; line-height:1;
  background:rgba(255,248,231,.035); border:1px solid rgba(255,248,231,.08);
  transition:background 180ms linear, border-color 180ms linear, transform 180ms cubic-bezier(.22,1,.36,1);
}
.y-hb-emoji:hover{ background:rgba(255,214,10,.09); border-color:rgba(255,214,10,.3) }
.y-hb-emoji:active{ transform:scale(.93); transition-duration:100ms }
.y-hb-emoji:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-hb-emoji-on{
  background:linear-gradient(180deg, rgba(255,228,92,.9) 0%, rgba(255,195,0,.85) 100%);
  border-color:rgba(255,214,10,.9);
  box-shadow:0 4px 16px -6px rgba(255,195,0,.7), inset 0 1px 0 rgba(255,255,255,.5);
}

.y-hb-sheet::-webkit-scrollbar{ width:0; height:0 }

@keyframes y-hb-rise{
  from{ opacity:0; transform:translateY(9px) }
  to{ opacity:1; transform:none }
}
.y-hb-rise{ animation:y-hb-rise 380ms cubic-bezier(.22,1,.36,1) both }

@media (prefers-reduced-motion: reduce){
  .y-hb-rise{ animation-duration:1ms }
  .y-hb-cta, .y-hb-add, .y-hb-emoji{ transition-duration:1ms }
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */
/* Small parts                                                          */
/* ------------------------------------------------------------------ */
function Eyebrow({
  children,
  tone = 'dim',
}: {
  children: React.ReactNode;
  tone?: 'dim' | 'gold';
}) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: tone === 'gold' ? 'rgba(255,214,10,.72)' : 'rgba(255,248,231,.38)',
      }}
    >
      {children}
    </span>
  );
}

/** Overlapping avatars. The roster is the point of a hub, so it leads. */
function MemberStack({
  members,
  me,
  size = 26,
}: {
  members: SeedPersona[];
  me: Profile | null;
  size?: number;
}) {
  const shown = members.slice(0, 5);
  const overflow = members.length - shown.length;

  if (!me && shown.length === 0) return null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {me ? (
        <span
          style={{
            display: 'inline-flex',
            borderRadius: 9999,
            boxShadow: '0 0 0 2px #0B0A08, 0 0 0 3.5px rgba(255,214,10,.55)',
          }}
        >
          <Bubble
            profile={me}
            size={size}
            prominence={0.85}
            interactive={false}
            showLabel={false}
          />
        </span>
      ) : null}

      {shown.map((p, i) => (
        <span
          key={p.id}
          style={{
            display: 'inline-flex',
            borderRadius: 9999,
            marginLeft: me || i > 0 ? -8 : 0,
            boxShadow: '0 0 0 2px #0B0A08',
          }}
        >
          <Bubble
            profile={p}
            size={size}
            prominence={0.5}
            interactive={false}
            showLabel={false}
          />
        </span>
      ))}

      {overflow > 0 ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            marginLeft: -8,
            borderRadius: 9999,
            boxShadow: '0 0 0 2px #0B0A08',
            background: 'rgba(255,248,231,.1)',
            fontFamily: MONO,
            fontSize: 9.5,
            color: 'rgba(255,248,231,.66)',
          }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */
export default function HubsPage() {
  const { state, people, peopleSource, createHub, addHubMember, removeHubMember } =
    useAppState();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [sheetShown, setSheetShown] = useState(false);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(HUB_EMOJI[0]);
  const [oneLiner, setOneLiner] = useState('');

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const hubs = state.hubs ?? [];
  const me = state.me ?? null;

  const personIndex: PersonIndex = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );

  /* Only people you've actually unlocked can join a hub. */
  const connectedPeople = useMemo(() => {
    const entries = Object.entries(state.connections ?? {});
    return entries
      .filter(([, c]) => c?.stage === 'connected')
      .map(([personId]) => personIndex.get(personId))
      .filter((p): p is SeedPersona => Boolean(p));
  }, [state.connections, personIndex]);

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
    setSheetMounted(true);
  };

  const nameValid = name.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameValid) return;
    const payload = {
      name: name.trim(),
      emoji,
      oneLiner: oneLiner.trim(),
    };
    const hubId = createHub(payload);
    closeSheet();
    /* Drop straight into the new hub so adding people is the obvious next step. */
    if (hubId) setExpandedId(hubId);
  };

  /* ---------------------------------------------------------------- */
  /* Held until the directory answers too, so member avatars never pop
     in after the roster has already rendered without them.             */
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

  return (
    <div className="flex w-full flex-col" style={{ minHeight: FILL_VIEWPORT }}>
      <HubStyles />

      {/* Header */}
      <header className="flex shrink-0 items-end justify-between gap-3 pb-4 pt-6">
        <div>
          <Eyebrow>Project rosters</Eyebrow>
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
                maxWidth: 290,
              }}
            >
              A hub is a room for one project.
            </h2>

            <p
              style={{
                fontFamily: SANS,
                fontSize: 14.5,
                lineHeight: 1.55,
                letterSpacing: '-0.006em',
                color: 'rgba(255,248,231,.52)',
                margin: '12px 0 0',
                maxWidth: 290,
              }}
            >
              You don&rsquo;t need everyone on everything. Pull in the two or
              three people this one actually needs, and leave the rest out.
            </p>

            <div style={{ width: '100%', maxWidth: 290, marginTop: 30 }}>
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
        ) : (
          /* ---------------- Hub list ---------------- */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {hubs.map((hub) => (
              <HubCard
                key={hub.id}
                hub={hub}
                me={me}
                open={expandedId === hub.id}
                personIndex={personIndex}
                connectedPeople={connectedPeople}
                roomEmpty={people.length === 0}
                onToggle={() =>
                  setExpandedId((cur) => (cur === hub.id ? null : hub.id))
                }
                onAdd={(personId) => addHubMember(hub.id, personId)}
                onRemove={(personId) => removeHubMember(hub.id, personId)}
              />
            ))}

            <p
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                lineHeight: 1.5,
                textAlign: 'center',
                color: 'rgba(255,248,231,.3)',
                margin: '10px 0 0',
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

            <div style={{ marginTop: 26, display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={closeSheet}
                className="y-hb-pill"
                style={{
                  fontFamily: SANS,
                  height: 54,
                  padding: '0 20px',
                  borderRadius: 16,
                  color: 'rgba(255,248,231,.66)',
                  background: 'transparent',
                  borderColor: 'rgba(255,248,231,.14)',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="y-hb-cta"
                disabled={!nameValid}
                style={{ fontFamily: SANS }}
              >
                Create hub
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
  me,
  open,
  personIndex,
  connectedPeople,
  roomEmpty,
  onToggle,
  onAdd,
  onRemove,
}: {
  hub: Hub;
  me: Profile | null;
  open: boolean;
  personIndex: PersonIndex;
  connectedPeople: SeedPersona[];
  /** Nobody else has signed up yet — a different problem to "not connected". */
  roomEmpty: boolean;
  onToggle: () => void;
  onAdd: (personId: string) => void;
  onRemove: (personId: string) => void;
}) {
  /* Resolve to live people — an id with nobody behind it simply doesn't
     render, so the count and the avatars can never disagree. */
  const members = useMemo(
    () =>
      (hub.memberIds ?? [])
        .map((pid) => personIndex.get(pid))
        .filter((p): p is SeedPersona => Boolean(p)),
    [hub.memberIds, personIndex]
  );

  const memberSet = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const addable = connectedPeople.filter((p) => !memberSet.has(p.id));

  const countLabel = me
    ? members.length === 0
      ? 'Just you so far'
      : `You + ${members.length}`
    : members.length === 0
      ? 'Nobody yet'
      : `${members.length} in the room`;

  return (
    <section className={`y-hb-card${open ? ' y-hb-card-open' : ''}`}>
      <button
        type="button"
        className="y-hb-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="y-hb-tile">
          <span
            aria-hidden
            style={{ fontFamily: EMOJI_FONT, fontSize: 22, lineHeight: 1 }}
          >
            {hub.emoji || '🚀'}
          </span>
        </span>

        <span style={{ flex: 1, minWidth: 0 }}>
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

          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              marginTop: 9,
            }}
          >
            <MemberStack members={members} me={me} />
            <Eyebrow tone={members.length ? 'gold' : 'dim'}>
              {countLabel}
            </Eyebrow>
          </span>
        </span>

        <span
          aria-hidden
          style={{
            flexShrink: 0,
            color: 'rgba(255,248,231,.4)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 300ms cubic-bezier(.22,1,.36,1)',
          }}
        >
          <svg width="13" height="8" viewBox="0 0 13 8">
            <path
              d="M1 1l5.5 5.5L12 1"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          className="y-hb-rise"
          style={{
            padding: '2px 14px 16px',
            borderTop: '1px solid rgba(255,214,10,.1)',
            marginTop: 2,
          }}
        >
          {/* Roster */}
          <div style={{ marginTop: 14 }}>
            <Eyebrow>In this hub</Eyebrow>
            {members.length === 0 ? (
              <p
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: 'rgba(255,248,231,.44)',
                  margin: '9px 0 0',
                }}
              >
                Nobody here yet. Add the people this project actually needs.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  margin: '10px 0 0',
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {members.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '5px 0',
                    }}
                  >
                    <Bubble
                      profile={p}
                      size={32}
                      prominence={0.55}
                      interactive={false}
                      showLabel={false}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontFamily: SANS,
                          fontSize: 14,
                          fontWeight: 600,
                          letterSpacing: '-0.012em',
                          color: 'rgba(255,248,231,.92)',
                        }}
                      >
                        {p.name}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontFamily: SANS,
                          fontSize: 12,
                          lineHeight: 1.35,
                          color: 'rgba(255,248,231,.38)',
                          marginTop: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.tagline}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="y-hb-x"
                      aria-label={`Remove ${p.name} from ${hub.name}`}
                      onClick={() => onRemove(p.id)}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                        <path
                          d="M1 1l8 8M9 1L1 9"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Picker — connected people only */}
          <div style={{ marginTop: 20 }}>
            <Eyebrow>Add people</Eyebrow>

            {roomEmpty ? (
              <p
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: 'rgba(255,248,231,.44)',
                  margin: '9px 0 0',
                }}
              >
                Nobody else has joined Yellow yet. The room is yours for now —
                as people sign up and you trade intros, they&rsquo;ll be addable
                here.
              </p>
            ) : connectedPeople.length === 0 ? (
              <p
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: 'rgba(255,248,231,.44)',
                  margin: '9px 0 0',
                }}
              >
                You can only add people you&rsquo;ve unlocked.{' '}
                <Link
                  href="/home"
                  style={{
                    color: '#FFD60A',
                    textDecoration: 'none',
                    fontWeight: 600,
                    borderBottom: '1px solid rgba(255,214,10,.35)',
                  }}
                >
                  Go make a connection
                </Link>{' '}
                and they&rsquo;ll show up here.
              </p>
            ) : addable.length === 0 ? (
              <p
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: 'rgba(255,248,231,.44)',
                  margin: '9px 0 0',
                }}
              >
                Everyone you&rsquo;re connected to is already in.{' '}
                <Link
                  href="/home"
                  style={{
                    color: '#FFD60A',
                    textDecoration: 'none',
                    fontWeight: 600,
                    borderBottom: '1px solid rgba(255,214,10,.35)',
                  }}
                >
                  Meet someone new
                </Link>
                .
              </p>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {addable.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="y-hb-add"
                    onClick={() => onAdd(p.id)}
                    style={{ fontFamily: SANS }}
                    aria-label={`Add ${p.name} to ${hub.name}`}
                  >
                    <Bubble
                      profile={p}
                      size={26}
                      prominence={0.45}
                      interactive={false}
                      showLabel={false}
                    />
                    {p.name}
                    <span
                      aria-hidden
                      style={{
                        fontSize: 14,
                        lineHeight: 1,
                        color: '#FFD60A',
                        marginLeft: 1,
                      }}
                    >
                      +
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
