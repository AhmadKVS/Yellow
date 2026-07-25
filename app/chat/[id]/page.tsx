'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Bubble from '@/components/Bubble';
import { useAppState } from '@/lib/store';
import type { Message } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Type stacks — pinned so the thread never falls back to a system face */
/* ------------------------------------------------------------------ */
const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

/** How long the other person "thinks" before their canned line lands. */
const REPLY_DELAY_MS = 1200;

/** Used once a persona's authored replies are exhausted. Cycled, never random. */
const GENERIC_REPLIES = [
  "ha — okay, say more. I'm actually curious.",
  "noted. let me sit with that and come back to you properly.",
  'this is the good kind of conversation. keep going.',
];

/* ------------------------------------------------------------------ */
/* Ids — a module counter guarantees uniqueness even inside one tick    */
/* ------------------------------------------------------------------ */
let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `m_${Date.now().toString(36)}_${idSeq.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function textMessage(
  personId: string,
  from: Message['from'],
  text: string
): Message {
  return { id: nextId(), personId, from, kind: 'text', text, at: Date.now() };
}

/* ------------------------------------------------------------------ */
/* Voice notes — a deterministic waveform, seeded per message           */
/* ------------------------------------------------------------------ */

/** Stable 32-bit hash, so a message with no waveSeed still gets one shape. */
function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic bar heights (0.28 – 1). A plain LCG on the seed: same seed
 * always paints the same waveform, so bars never reshuffle on re-render.
 */
function waveBars(seed: number, count: number): number[] {
  let s = (seed >>> 0) || 1;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push(0.28 + ((s >>> 9) % 1000) / 1000 * 0.72);
  }
  return out;
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatClock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — React hoists + dedupes by href                   */
/* ------------------------------------------------------------------ */
function ChatStyles() {
  return (
    <style href="yellow-chat" precedence="high">{`
.y-ch-icon{
  display:inline-flex; align-items:center; justify-content:center;
  width:34px; height:34px; border-radius:9999px; cursor:pointer; flex-shrink:0;
  color:rgba(255,248,231,.62); background:transparent;
  border:1px solid rgba(255,248,231,.1);
  transition:color 200ms linear, border-color 200ms linear, background 200ms linear;
}
.y-ch-icon:hover{ color:#FFF8E7; border-color:rgba(255,214,10,.42); background:rgba(255,214,10,.06); }
.y-ch-icon:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px; }

@keyframes y-ch-in{
  from{ opacity:0; transform:translateY(7px) scale(.985) }
  to{ opacity:1; transform:none }
}
.y-ch-bub{
  max-width:79%; padding:9px 13px 8px; position:relative;
  font-size:14.5px; line-height:1.44; letter-spacing:-.008em;
  word-break:break-word; white-space:pre-wrap;
  animation:y-ch-in 340ms cubic-bezier(.22,1,.36,1) both;
}
.y-ch-me{
  color:#1A1200; align-self:flex-end;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 6px 20px -10px rgba(255,195,0,.7), inset 0 1px 0 rgba(255,255,255,.5);
}
.y-ch-them{
  color:rgba(255,248,231,.94); align-self:flex-start;
  background:rgba(255,248,231,.055);
  border:1px solid rgba(255,214,10,.11);
}

/* Typing indicator */
@keyframes y-ch-dot{
  0%,60%,100%{ transform:translateY(0); opacity:.4 }
  30%{ transform:translateY(-4px); opacity:1 }
}
.y-ch-dot{
  width:5px; height:5px; border-radius:9999px; background:#FFD60A;
  animation:y-ch-dot 1.25s ease-in-out infinite;
}

/* Composer */
.y-ch-input{
  flex:1; min-width:0; height:44px; padding:0 15px;
  border-radius:9999px; border:1px solid rgba(255,214,10,.15);
  background:rgba(255,248,231,.045); color:#FFF8E7;
  font-size:14.5px; letter-spacing:-.008em; outline:none;
  transition:border-color 220ms linear, background 220ms linear;
}
.y-ch-input::placeholder{ color:rgba(255,248,231,.3) }
.y-ch-input:focus{ border-color:rgba(255,214,10,.5); background:rgba(255,248,231,.07) }

.y-ch-send{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:44px; height:44px; border-radius:9999px; border:0; cursor:pointer;
  color:#1A1200; background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 8px 22px -10px rgba(255,195,0,.75), inset 0 1px 0 rgba(255,255,255,.6);
  transition:transform 240ms cubic-bezier(.22,1,.36,1), opacity 200ms linear, filter 200ms linear;
}
.y-ch-send:hover:not(:disabled){ filter:brightness(1.06); transform:translateY(-1px) }
.y-ch-send:active:not(:disabled){ transform:scale(.94); transition-duration:110ms }
.y-ch-send:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px }
.y-ch-send:disabled{
  cursor:default; opacity:.32; background:rgba(255,248,231,.1);
  color:rgba(255,248,231,.5); box-shadow:none;
}

/* Primary CTA — shared with the locked state */
.y-ch-cta{
  display:flex; align-items:center; justify-content:center;
  width:100%; height:54px; border-radius:16px; border:0; cursor:pointer;
  font-size:16px; font-weight:680; letter-spacing:-.012em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 12px 32px -12px rgba(255,195,0,.62), inset 0 1px 0 rgba(255,255,255,.62);
  transition:transform 280ms cubic-bezier(.22,1,.36,1), box-shadow 280ms cubic-bezier(.22,1,.36,1), filter 200ms linear;
}
.y-ch-cta:hover{ transform:translateY(-1.5px); filter:brightness(1.05);
  box-shadow:0 18px 40px -12px rgba(255,195,0,.75), inset 0 1px 0 rgba(255,255,255,.7); }
.y-ch-cta:active{ transform:translateY(1px) scale(.993); transition-duration:110ms }
.y-ch-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px }

.y-ch-ghost{
  display:inline-flex; align-items:center; justify-content:center;
  height:44px; padding:0 18px; border-radius:14px; cursor:pointer;
  font-size:14px; font-weight:600; letter-spacing:-.008em;
  color:rgba(255,248,231,.72); background:transparent;
  border:1px solid rgba(255,248,231,.14);
  transition:color 200ms linear, border-color 200ms linear, background 200ms linear;
}
.y-ch-ghost:hover{ color:#FFF8E7; border-color:rgba(255,214,10,.4); background:rgba(255,214,10,.05) }
.y-ch-ghost:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }

@media (prefers-reduced-motion: reduce){
  .y-ch-bub{ animation-duration:1ms }
  .y-ch-dot{ animation:none; opacity:.75 }
  .y-ch-cta, .y-ch-send{ transition-duration:1ms }
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */
/* The seam — the signature. Two halves; each lights when that person's */
/* intro is in. Both lit = the thread is open.                          */
/* ------------------------------------------------------------------ */
function SeamSegment({ lit, side }: { lit: boolean; side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden
      style={{
        flex: 1,
        height: 2,
        borderRadius: 2,
        background: lit
          ? side === 'left'
            ? 'linear-gradient(90deg, rgba(255,214,10,.2), #FFD60A)'
            : 'linear-gradient(90deg, #FFD60A, rgba(255,214,10,.2))'
          : 'repeating-linear-gradient(90deg, rgba(255,248,231,.24) 0 3px, rgba(255,248,231,0) 3px 8px)',
        boxShadow: lit ? '0 0 12px rgba(255,214,10,.55)' : 'none',
        transition: 'background 400ms linear, box-shadow 400ms linear',
      }}
    />
  );
}

function Seam({ theirs, mine }: { theirs: boolean; mine: boolean }) {
  const closed = theirs && mine;
  return (
    <span
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: 62,
        flexShrink: 0,
      }}
    >
      <SeamSegment lit={theirs} side="left" />
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: 9999,
          flexShrink: 0,
          background: closed ? '#FFD60A' : 'transparent',
          border: closed ? 'none' : '1.5px dashed rgba(255,248,231,.3)',
          boxShadow: closed ? '0 0 16px rgba(255,214,10,.8)' : 'none',
          transition: 'all 400ms linear',
        }}
      />
      <SeamSegment lit={mine} side="right" />
    </span>
  );
}

/** Stand-in for you before onboarding writes a real profile. */
function GhostAvatar({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1.5px dashed rgba(255,248,231,.22)',
        background: 'rgba(255,248,231,.03)',
        fontFamily: MONO,
        fontSize: size * 0.32,
        color: 'rgba(255,248,231,.35)',
      }}
    >
      you
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Voice note body — rendered inline (no shared component dependency)   */
/* ------------------------------------------------------------------ */
function VoiceBody({ message, mine }: { message: Message; mine: boolean }) {
  const duration = message.durationSec ?? 0;
  const barCount = Math.min(30, Math.max(12, Math.round(duration * 2.2) || 18));
  const bars = useMemo(
    () => waveBars(message.waveSeed ?? seedFromString(message.id), barCount),
    [message.waveSeed, message.id, barCount]
  );

  const ink = mine ? 'rgba(26,18,0,' : 'rgba(255,214,10,';

  return (
    <span style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 9999,
            flexShrink: 0,
            background: `${ink}.15)`,
          }}
        >
          <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden>
            <path
              d="M1 1.2v7.6L8 5z"
              fill={mine ? '#1A1200' : '#FFD60A'}
            />
          </svg>
        </span>

        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            height: 22,
            flex: 1,
            minWidth: 0,
          }}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                minWidth: 2,
                maxWidth: 3,
                height: `${Math.round(h * 100)}%`,
                borderRadius: 2,
                background: `${ink}${mine ? 0.42 : 0.6})`,
              }}
            />
          ))}
        </span>

        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            letterSpacing: '0.02em',
            flexShrink: 0,
            color: mine ? 'rgba(26,18,0,.6)' : 'rgba(255,248,231,.5)',
          }}
        >
          {formatDuration(duration)}
        </span>
      </span>

      {message.text ? (
        <span
          style={{
            display: 'block',
            marginTop: 7,
            fontSize: 12.5,
            lineHeight: 1.42,
            color: mine ? 'rgba(26,18,0,.66)' : 'rgba(255,248,231,.52)',
          }}
        >
          {message.text}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Shells                                                               */
/* ------------------------------------------------------------------ */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'rgba(255,248,231,.38)',
      }}
    >
      {children}
    </span>
  );
}

/**
 * PhoneFrame owns the scroll container and the column's horizontal padding,
 * so pages size themselves against the viewport rather than a flex parent.
 */
const FILL_VIEWPORT = 'calc(100dvh - 96px)';

/** Bleeds a sticky bar out to the reading column's edges. */
const BLEED = '-mx-5 px-5 md:-mx-8 md:px-8';

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex w-full flex-col items-center justify-center text-center"
      style={{ minHeight: FILL_VIEWPORT }}
    >
      <ChatStyles />
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */
export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { state, people, peopleSource, addMessage } = useAppState();

  const [draft, setDraft] = useState('');
  const [pendingReply, setPendingReply] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persona = useMemo(
    () => people.find((p) => p.id === id),
    [people, id]
  );

  const connection = state.connections?.[id];
  const connected = connection?.stage === 'connected';

  /* Thread: this person only, oldest first. */
  const thread = useMemo(() => {
    const all = state.messages ?? [];
    return all.filter((m) => m.personId === id).sort((a, b) => a.at - b.at);
  }, [state.messages, id]);

  /* Latest thread + persona, readable from inside the reply timeout. */
  const threadRef = useRef(thread);
  const personaRef = useRef(persona);
  const addMessageRef = useRef(addMessage);
  useEffect(() => {
    threadRef.current = thread;
    personaRef.current = persona;
    addMessageRef.current = addMessage;
  });

  /* A fast navigation must never fire a stray reply. */
  useEffect(() => {
    return () => {
      if (replyTimer.current) {
        clearTimeout(replyTimer.current);
        replyTimer.current = null;
      }
    };
  }, []);

  /* Newest message always in view. Scrolls whichever ancestor actually
     scrolls, so it survives changes to the surrounding frame. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.length, pendingReply, connected]);

  /* Rows carry their own grouping/divider flags so the JSX stays flat. */
  const rows = useMemo(() => {
    const GROUP_GAP_MS = 5 * 60 * 1000;
    return thread.map((m, i) => {
      const prev = thread[i - 1];
      const next = thread[i + 1];
      const newDay =
        !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
      const startsGroup =
        newDay || !prev || prev.from !== m.from || m.at - prev.at > GROUP_GAP_MS;
      const endsGroup =
        !next ||
        next.from !== m.from ||
        next.at - m.at > GROUP_GAP_MS ||
        new Date(next.at).toDateString() !== new Date(m.at).toDateString();
      return { m, newDay, startsGroup, endsGroup };
    });
  }, [thread]);

  /* ---------------------------------------------------------------- */
  /* Loading — held until the store rehydrates, so the thread never     */
  /* flashes empty on first paint. Also held while the people directory */
  /* is still in flight, so an unresolved id never flashes "not found". */
  /* ---------------------------------------------------------------- */
  if (!state.hydrated || (!persona && peopleSource === 'loading')) {
    return (
      <CenteredShell>
        <span
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: 9999,
            background:
              'radial-gradient(circle at 34% 26%, #FFE45C 0%, #FFC300 76%)',
            boxShadow: '0 0 28px rgba(255,214,10,.4)',
            opacity: 0.55,
          }}
          className="animate-pulse"
        />
        <p style={{ marginTop: 18 }}>
          <Eyebrow>Opening the thread</Eyebrow>
        </p>
      </CenteredShell>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Unknown person                                                     */
  /* ---------------------------------------------------------------- */
  if (!persona) {
    return (
      <CenteredShell>
        <span aria-hidden style={{ fontSize: 34, lineHeight: 1 }}>
          🫧
        </span>
        <h1
          style={{
            fontFamily: SANS,
            fontSize: 22,
            fontWeight: 660,
            letterSpacing: '-0.026em',
            color: '#FFF8E7',
            margin: '16px 0 0',
          }}
        >
          That bubble popped
        </h1>
        <p
          style={{
            fontFamily: SANS,
            fontSize: 14,
            lineHeight: 1.5,
            color: 'rgba(255,248,231,.5)',
            margin: '8px 0 0',
            maxWidth: 280,
          }}
        >
          There&rsquo;s nobody here under{' '}
          <span style={{ fontFamily: MONO, color: 'rgba(255,248,231,.75)' }}>
            {id}
          </span>
          . They may have left, or the link is off.
        </p>
        <Link
          href="/home"
          className="y-ch-ghost"
          style={{ fontFamily: SANS, marginTop: 22, textDecoration: 'none' }}
        >
          Back to your bubbles
        </Link>
      </CenteredShell>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Locked — the core mechanic. Warm, and honest about whose turn it   */
  /* is: the seam reads the actual intro flags.                         */
  /* ---------------------------------------------------------------- */
  if (!connected) {
    const theirs = connection?.theirIntroSent ?? false;
    const mineSent = connection?.myIntroSent ?? false;
    const firstName = persona.name.split(' ')[0];

    const copy = mineSent
      ? {
          eyebrow: 'Waiting on them',
          title: `Your intro is with ${firstName}.`,
          body: `${firstName} has it. The moment a voice note comes back, this thread opens for both of you.`,
          cta: `See ${firstName}’s profile`,
        }
      : theirs
        ? {
            eyebrow: 'Your turn',
            title: `${firstName} went first.`,
            body: `There’s a voice intro here waiting for you. Send one back and you can talk properly.`,
            cta: 'Record your intro',
          }
        : {
            eyebrow: 'Not open yet',
            title: 'Two voices open this.',
            body: `Send ${firstName} a voice intro. When one comes back, messaging unlocks — that’s the whole gate.`,
            cta: 'Record your intro',
          };

    return (
      <div
        className="flex w-full flex-col"
        style={{ minHeight: FILL_VIEWPORT }}
      >
        <ChatStyles />

        {/* Back affordance stays available even while locked */}
        <header className="flex shrink-0 items-center gap-3 pb-2 pt-4">
          <button
            type="button"
            className="y-ch-icon"
            aria-label="Go back"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 1) {
                router.back();
              } else {
                router.push('/home');
              }
            }}
          >
            <svg width="9" height="15" viewBox="0 0 9 15" aria-hidden>
              <path
                d="M7.5 1L1.5 7.5L7.5 14"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
          <Eyebrow>{persona.name}</Eyebrow>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center pb-10 text-center">
          {/* The seam */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Bubble
              profile={persona}
              size={72}
              prominence={0.9}
              interactive={false}
              showLabel={false}
            />
            <Seam theirs={theirs} mine={mineSent} />
            {state.me ? (
              <Bubble
                profile={state.me}
                size={56}
                prominence={0.45}
                interactive={false}
                showLabel={false}
              />
            ) : (
              <GhostAvatar size={56} />
            )}
          </div>

          <p style={{ margin: '30px 0 0' }}>
            <Eyebrow>{copy.eyebrow}</Eyebrow>
          </p>

          <h1
            style={{
              fontFamily: SANS,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              lineHeight: 1.22,
              color: '#FFF8E7',
              margin: '12px 0 0',
              maxWidth: 300,
            }}
          >
            {copy.title}
          </h1>

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
            {copy.body}
          </p>

          <div style={{ width: '100%', maxWidth: 300, marginTop: 30 }}>
            <Link
              href={`/connect/${persona.id}`}
              className="y-ch-cta"
              style={{ fontFamily: SANS, textDecoration: 'none' }}
            >
              {copy.cta}
            </Link>
            <p style={{ margin: '14px 0 0' }}>
              <Eyebrow>Mutual intros only</Eyebrow>
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Unlocked thread                                                    */
  /* ---------------------------------------------------------------- */
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    addMessage(textMessage(id, 'me', text));
    setDraft('');

    /* One reply in flight at a time — a burst of sends collapses into one. */
    if (replyTimer.current) clearTimeout(replyTimer.current);
    setPendingReply(true);
    replyTimer.current = setTimeout(() => {
      replyTimer.current = null;
      /* Index by how many of their text messages already landed, so each
         canned line is used exactly once and in order. */
      const used = threadRef.current.filter(
        (m) => m.from === 'them' && m.kind === 'text'
      ).length;
      const canned = personaRef.current?.cannedReplies ?? [];
      const reply =
        used < canned.length
          ? canned[used]
          : GENERIC_REPLIES[(used - canned.length) % GENERIC_REPLIES.length];
      addMessageRef.current(textMessage(id, 'them', reply));
      setPendingReply(false);
    }, REPLY_DELAY_MS);
  };

  const canSend = draft.trim().length > 0;

  return (
    <div className="flex w-full flex-col" style={{ minHeight: FILL_VIEWPORT }}>
      <ChatStyles />

      {/* Header */}
      <header
        className={`sticky top-0 z-20 flex shrink-0 items-center gap-3 py-3 ${BLEED}`}
        style={{
          borderBottom: '1px solid rgba(255,214,10,.1)',
          background:
            'linear-gradient(180deg, rgba(23,20,12,.9) 0%, rgba(11,10,8,.72) 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <button
          type="button"
          className="y-ch-icon"
          aria-label="Go back"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back();
            } else {
              router.push('/home');
            }
          }}
        >
          <svg width="9" height="15" viewBox="0 0 9 15" aria-hidden>
            <path
              d="M7.5 1L1.5 7.5L7.5 14"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>

        <Bubble
          profile={persona}
          size={38}
          prominence={0.75}
          interactive={false}
          showLabel={false}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontFamily: SANS,
              fontSize: 15.5,
              fontWeight: 650,
              letterSpacing: '-0.018em',
              lineHeight: 1.2,
              color: '#FFF8E7',
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {persona.name}
          </h1>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 2,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: 9999,
                background: '#FFD60A',
                boxShadow: '0 0 8px rgba(255,214,10,.85)',
              }}
            />
            <span
              style={{
                fontFamily: MONO,
                fontSize: 9.5,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(255,214,10,.72)',
              }}
            >
              Connected
            </span>
          </span>
        </div>

        <Link
          href={`/connect/${persona.id}`}
          className="y-ch-icon"
          aria-label={`Open ${persona.name}'s profile`}
          style={{ textDecoration: 'none' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <circle
              cx="7"
              cy="7"
              r="6.1"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
            />
            <path
              d="M7 6.2v4M7 3.9v.1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </Link>
      </header>

      {/* Thread */}
      <div className="flex flex-1 flex-col pb-2 pt-5">
        {/* The unlock marker — reinforces what it took to get here */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 20,
          }}
        >
          <span
            aria-hidden
            style={{
              flex: 1,
              height: 1,
              background:
                'linear-gradient(90deg, rgba(255,214,10,.02), rgba(255,214,10,.22))',
            }}
          />
          <Eyebrow>Unlocked &middot; both intros in</Eyebrow>
          <span
            aria-hidden
            style={{
              flex: 1,
              height: 1,
              background:
                'linear-gradient(90deg, rgba(255,214,10,.22), rgba(255,214,10,.02))',
            }}
          />
        </div>

        {rows.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              maxWidth: 250,
              paddingBottom: 30,
            }}
          >
            <p
              style={{
                fontFamily: SANS,
                fontSize: 16,
                fontWeight: 560,
                letterSpacing: '-0.018em',
                color: 'rgba(255,248,231,.82)',
                margin: 0,
              }}
            >
              Nothing here yet.
            </p>
            <p
              style={{
                fontFamily: SANS,
                fontSize: 13.5,
                lineHeight: 1.5,
                color: 'rgba(255,248,231,.42)',
                margin: '6px 0 0',
              }}
            >
              You both showed up. Say the first thing.
            </p>
          </div>
        ) : (
          rows.map(({ m, newDay, startsGroup, endsGroup }) => {
            const mine = m.from === 'me';
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {newDay ? (
                  <div
                    style={{
                      alignSelf: 'center',
                      margin: '10px 0 14px',
                    }}
                  >
                    <Eyebrow>{dayLabel(m.at)}</Eyebrow>
                  </div>
                ) : null}

                <div
                  className={`y-ch-bub ${mine ? 'y-ch-me' : 'y-ch-them'}`}
                  style={{
                    fontFamily: SANS,
                    marginTop: startsGroup ? 0 : 3,
                    borderRadius: mine
                      ? `18px 18px ${endsGroup ? '6px' : '18px'} 18px`
                      : `18px 18px 18px ${endsGroup ? '6px' : '18px'}`,
                    /* Voice notes need a wider, steadier box than text */
                    minWidth: m.kind === 'voice' ? 216 : undefined,
                  }}
                >
                  {m.kind === 'voice' ? (
                    <VoiceBody message={m} mine={mine} />
                  ) : (
                    m.text
                  )}
                </div>

                {endsGroup ? (
                  <span
                    style={{
                      alignSelf: mine ? 'flex-end' : 'flex-start',
                      margin: '5px 3px 12px',
                      fontFamily: MONO,
                      fontSize: 9.5,
                      letterSpacing: '0.1em',
                      color: 'rgba(255,248,231,.26)',
                    }}
                  >
                    {formatClock(m.at)}
                  </span>
                ) : null}
              </div>
            );
          })
        )}

        {/* Typing */}
        {pendingReply ? (
          <div
            aria-live="polite"
            aria-label={`${persona.name} is typing`}
            className="y-ch-bub y-ch-them"
            style={{
              borderRadius: '18px 18px 18px 6px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '12px 15px',
              marginTop: 3,
            }}
          >
            <span className="y-ch-dot" />
            <span className="y-ch-dot" style={{ animationDelay: '.16s' }} />
            <span className="y-ch-dot" style={{ animationDelay: '.32s' }} />
          </div>
        ) : null}

        {/* Scroll anchor — offset so the sticky composer never covers it. */}
        <div ref={endRef} aria-hidden style={{ scrollMarginBottom: 96 }} />
      </div>

      {/* Composer */}
      <form
        onSubmit={send}
        className={`sticky bottom-0 z-20 flex shrink-0 items-center gap-2 pt-3 ${BLEED}`}
        style={{
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          borderTop: '1px solid rgba(255,214,10,.1)',
          background:
            'linear-gradient(180deg, rgba(11,10,8,.6) 0%, rgba(16,14,9,.95) 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <input
          className="y-ch-input"
          style={{ fontFamily: SANS }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${persona.name.split(' ')[0]}`}
          aria-label={`Message ${persona.name}`}
          autoComplete="off"
        />
        <button
          type="submit"
          className="y-ch-send"
          disabled={!canSend}
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M8 14V2.6M8 2.6L3 7.6M8 2.6l5 5"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>
      </form>
    </div>
  );
}
