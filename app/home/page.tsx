'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/store';
import { rankMatches, type RankedMatch } from '@/lib/match';
import type { Profile, SeedPersona } from '@/lib/types';
import Bubble from '@/components/Bubble';
import BubbleField from '@/components/BubbleField';
import ProfileCard from '@/components/ProfileCard';
import MatchNudge from '@/components/MatchNudge';

const NUDGE_DELAY_MS = 2500;

const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

export default function HomePage() {
  const router = useRouter();
  const { state, people, peopleSource, ensureConnection, setStage, dismissNudge } =
    useAppState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nudgeVisible, setNudgeVisible] = useState(false);

  /* Memoised on the people array itself. The store hands back the *same*
     array reference unless the roster actually changed, so a refresh that
     finds nothing new never re-lays-out the field. */
  const matches: RankedMatch[] = useMemo(
    () => (state.me ? rankMatches(state.me, people) : []),
    [state.me, people],
  );

  const topMatch = matches[0] ?? null;
  const topStage = topMatch ? state.connections[topMatch.person.id]?.stage : undefined;
  const topIsStranger = !topStage || topStage === 'stranger' || topStage === 'nudged';

  useEffect(() => {
    if (!state.hydrated || state.me) return;
    router.replace('/onboarding');
  }, [state.hydrated, state.me, router]);

  useEffect(() => {
    if (!state.hydrated || !topMatch || state.nudgeDismissed || !topIsStranger) return;
    const t = setTimeout(() => setNudgeVisible(true), NUDGE_DELAY_MS);
    return () => clearTimeout(t);
  }, [state.hydrated, state.nudgeDismissed, topMatch, topIsStranger]);

  const selected = selectedId
    ? matches.find((m) => m.person.id === selectedId) ?? null
    : null;
  const selectedStage = selectedId ? state.connections[selectedId]?.stage : undefined;
  const selectedConnected = selectedStage === 'connected';

  function openConnection(person: SeedPersona) {
    if (state.connections[person.id]?.stage === 'connected') {
      router.push(`/chat/${person.id}`);
      return;
    }
    ensureConnection(person.id);
    setStage(person.id, 'intro_pending');
    router.push(`/connect/${person.id}`);
  }

  /* Hold the very first paint until the directory has answered, so the room
     never flashes "you're the first one here" on its way to being full.
     `fetchPeople` always resolves, so this can't outlive its own timeout. */
  if (!state.hydrated || !state.me || peopleSource === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span
          className="h-3 w-3 animate-pulse rounded-full bg-[#FFD60A]"
          style={{ boxShadow: '0 0 22px 3px rgba(255,214,10,0.6)' }}
        />
        <span className="sr-only">Loading Yellow</span>
      </div>
    );
  }

  const topOverlap = topMatch
    ? topMatch.sharedSkills.length + topMatch.sharedInterests.length
    : 0;

  if (matches.length === 0) {
    return <FirstOne me={state.me} live={peopleSource === 'dynamodb'} />;
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <header className="shrink-0 px-6 pb-1 pt-6 md:px-10 md:pt-9">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#FFF8E7] md:text-[27px]">
          Your orbit
        </h1>
        <p className="mt-1 max-w-[52ch] text-[13px] leading-relaxed text-[#FFF8E7]/40 md:text-[14px]">
          {matches.length} {matches.length === 1 ? 'builder' : 'builders'}, sized by what
          you actually share.
          {topMatch && topOverlap > 0 ? (
            <>
              {' '}
              Closest is <span className="text-[#FFD60A]/85">{topMatch.person.name}</span>,
              overlapping on {topOverlap}.
            </>
          ) : null}
        </p>
      </header>

      <div className="relative min-h-0 flex-1">
        <BubbleField
          me={state.me}
          matches={matches}
          selectedId={selectedId}
          onSelect={(m) => setSelectedId(m.person.id)}
          onSelectMe={() => setSelectedId(null)}
          className="absolute inset-0"
        />
        <LiveBadge live={peopleSource === 'dynamodb'} />
      </div>

      {nudgeVisible && topIsStranger && !state.nudgeDismissed && (
        <MatchNudge
          match={topMatch}
          onConnect={(person) => {
            setNudgeVisible(false);
            openConnection(person);
          }}
          onDismiss={() => {
            setNudgeVisible(false);
            dismissNudge();
          }}
        />
      )}

      <ProfileCard
        match={selected}
        connected={selectedConnected}
        ctaLabel={selectedConnected ? 'Message' : 'Connect'}
        onClose={() => setSelectedId(null)}
        onConnect={openConnection}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Liveness marker — quiet proof the orbit is coming off AWS, not a
 * bundled constant.
 * ------------------------------------------------------------------ */

function LiveBadge({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <span
      className="pointer-events-none absolute left-4 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
      style={{
        fontFamily: MONO,
        fontSize: 9,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'rgba(255,214,10,.66)',
        background: 'rgba(20,17,10,.6)',
        border: '1px solid rgba(255,214,10,.16)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span
        aria-hidden
        className="animate-pulse"
        style={{
          width: 5,
          height: 5,
          borderRadius: 9999,
          background: '#FFD60A',
          boxShadow: '0 0 8px rgba(255,214,10,.9)',
        }}
      />
      Live
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The empty room. Not an error — the first person through the door.
 * ------------------------------------------------------------------ */

function FirstOne({ me, live }: { me: Profile; live: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const invite = useCallback(() => {
    const url = window.location.origin;
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2200);
    };
    try {
      void navigator.clipboard
        .writeText(url)
        .then(done)
        .catch(() => done());
    } catch {
      done();
    }
  }, []);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <style href="yellow-first" precedence="high">{`
@keyframes y-fo-breathe{
  0%,100%{ transform:scale(1); opacity:.7 }
  50%    { transform:scale(1.09); opacity:1 }
}
@keyframes y-fo-ring{
  0%   { transform:scale(.9); opacity:.55 }
  100% { transform:scale(1.55); opacity:0 }
}
@keyframes y-fo-rise{
  from{ opacity:0; transform:translateY(10px) }
}
.y-fo-halo{ animation:y-fo-breathe 6.4s cubic-bezier(.45,0,.55,1) infinite }
.y-fo-pulse{ animation:y-fo-ring 4.2s cubic-bezier(.22,1,.36,1) infinite }
.y-fo-rise{ animation:y-fo-rise 620ms cubic-bezier(.22,1,.36,1) backwards }
.y-fo-cta{
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  height:52px; padding:0 26px; border-radius:16px; border:0; cursor:pointer;
  font-size:15.5px; font-weight:670; letter-spacing:-.012em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 12px 32px -12px rgba(255,195,0,.62), inset 0 1px 0 rgba(255,255,255,.62);
  transition:transform 260ms cubic-bezier(.22,1,.36,1), filter 180ms linear;
}
.y-fo-cta:hover{ transform:translateY(-1.5px); filter:brightness(1.05) }
.y-fo-cta:active{ transform:translateY(1px) scale(.994) }
.y-fo-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px }
.y-fo-ghost{
  display:inline-flex; align-items:center; justify-content:center;
  height:44px; padding:0 18px; border-radius:14px; cursor:pointer;
  font-size:13.5px; font-weight:600; letter-spacing:-.008em;
  color:rgba(255,248,231,.6); background:transparent;
  border:1px solid rgba(255,248,231,.12);
  transition:color 200ms linear, border-color 200ms linear;
}
.y-fo-ghost:hover{ color:#FFF8E7; border-color:rgba(255,214,10,.38) }
.y-fo-ghost:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
@media (prefers-reduced-motion: reduce){
  .y-fo-halo,.y-fo-pulse{ animation:none }
  .y-fo-rise{ animation-duration:1ms }
}
`}</style>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(42% 30% at 84% 12%, rgba(255,214,10,.07) 0%, rgba(255,214,10,0) 72%)',
            'radial-gradient(46% 34% at 12% 88%, rgba(184,134,11,.085) 0%, rgba(184,134,11,0) 74%)',
            'radial-gradient(58% 40% at 50% 42%, rgba(255,201,10,.14) 0%, rgba(255,150,0,0) 72%)',
          ].join(','),
        }}
      />

      <LiveBadge live={live} />

      <div className="relative flex flex-1 flex-col items-center justify-center px-7 pb-14 text-center">
        {/* You, still the centre of the map. */}
        <div className="relative mb-9 flex items-center justify-center">
          <span
            aria-hidden
            className="y-fo-halo pointer-events-none absolute rounded-full"
            style={{
              width: 232,
              height: 232,
              background:
                'radial-gradient(circle, rgba(255,214,10,.22) 0%, rgba(255,178,0,.08) 46%, rgba(255,178,0,0) 72%)',
            }}
          />
          <span
            aria-hidden
            className="y-fo-pulse pointer-events-none absolute rounded-full"
            style={{ width: 168, height: 168, border: '1px solid rgba(255,214,10,.3)' }}
          />
          <span
            aria-hidden
            className="y-fo-pulse pointer-events-none absolute rounded-full"
            style={{
              width: 168,
              height: 168,
              border: '1px solid rgba(255,214,10,.22)',
              animationDelay: '2.1s',
            }}
          />
          <Bubble profile={me} size={132} prominence={1} variant="me" interactive={false} />
        </div>

        <p className="y-fo-rise" style={{ animationDelay: '60ms' }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              letterSpacing: '0.19em',
              textTransform: 'uppercase',
              color: 'rgba(255,214,10,.7)',
            }}
          >
            Your orbit
          </span>
        </p>

        <h1
          className="y-fo-rise mt-3 text-[26px] font-semibold leading-[1.2] tracking-[-0.03em] text-[#FFF8E7] md:text-[29px]"
          style={{ maxWidth: '15ch', animationDelay: '120ms' }}
        >
          You&rsquo;re the first one here.
        </h1>

        <p
          className="y-fo-rise mt-3 text-[14px] leading-[1.55] text-[#FFF8E7]/45"
          style={{ maxWidth: '34ch', animationDelay: '180ms' }}
        >
          Yellow matches on how you work, not where you worked. As people join,
          they&rsquo;ll appear around you — closer and bigger the more you actually share.
        </p>

        <div
          className="y-fo-rise mt-8 flex flex-col items-center gap-3"
          style={{ animationDelay: '240ms' }}
        >
          <button type="button" className="y-fo-cta" onClick={invite}>
            {copied ? 'Link copied' : 'Invite someone'}
            {copied ? null : (
              <svg width="15" height="12" viewBox="0 0 15 12" aria-hidden>
                <path
                  d="M1 6h12M8.6 1.4 13.2 6l-4.6 4.6"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            )}
          </button>

          <button
            type="button"
            className="y-fo-ghost"
            onClick={() => router.push('/onboarding')}
          >
            Edit your tags
          </button>
        </div>

        <p
          className="y-fo-rise mt-7 text-[11.5px] leading-relaxed text-[#FFF8E7]/26"
          style={{ maxWidth: '32ch', animationDelay: '300ms' }}
        >
          The orbit refreshes on its own — anyone who signs up shows up here.
        </p>
      </div>
    </div>
  );
}
