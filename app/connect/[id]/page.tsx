'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Celebration from '@/components/Celebration';
import VoiceNoteBubble, { estimateDuration, waveSeedFrom } from '@/components/VoiceNoteBubble';
import VoiceRecorder, { type VoiceAnswer } from '@/components/VoiceRecorder';
import { resolvePlaybackUrl, uploadClip } from '@/lib/audioClient';
import { setAudioUrl } from '@/lib/audioStore';
import {
  INTRO_KEYS,
  fetchIntro,
  saveIntro,
  type IntroKey,
  type VoiceClip,
  type VoiceIntro,
} from '@/lib/intro';
import { initialsFor } from '@/lib/initials';
import { rankMatches } from '@/lib/match';
import { fetchPair, sendPairIntro, type PairView } from '@/lib/pair';
import { resolveIdentity } from '@/lib/people';
import { useAppState } from '@/lib/store';
import type { SeedPersona } from '@/lib/types';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const QUESTIONS: { key: IntroKey; label: string }[] = [
  { key: 'who', label: 'Who are you?' },
  { key: 'building', label: 'What are you building?' },
  { key: 'lookingFor', label: 'What are you looking for?' },
];

/** How often we re-read the shared pair while this screen is open. */
const PAIR_POLL_MS = 4000;

/** Upload is best-effort; the flow never waits longer than this for S3. */
const UPLOAD_BUDGET_MS = 2500;

/**
 * The id the server gives an intro clip when it seeds the thread. Deriving it
 * the same way on both sides is what lets one presigned URL serve the connect
 * screen and the chat, and what makes a clip survive a refresh.
 */
function clipMessageId(ownerId: string, key: IntroKey): string {
  return `intro-${ownerId}-${key}`;
}

/** A clip with words but no audio was typed; anything else is a recording. */
function clipKind(clip: VoiceClip): 'text' | 'voice' {
  return clip.text && !clip.s3Key ? 'text' : 'voice';
}

/**
 * A profile photo, as a CSS layer rather than an `<img>` — the face is a
 * decorative disc, and this keeps it one element. Anything that could close
 * the `url("…")` is rejected instead of escaped.
 */
function photoLayer(url: string | undefined): string | null {
  const clean = url?.trim();
  if (!clean || !/^https?:\/\/[^"')\s]+$/i.test(clean)) return null;
  return `url("${clean}") center/cover no-repeat`;
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

function ConnectStyles() {
  return (
    <style href="yellow-connect" precedence="high">{`
.y-cn-back{
  display:inline-flex; align-items:center; gap:8px; text-decoration:none;
  height:28px; font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:rgba(255,248,231,.4); transition:color 180ms linear;
}
.y-cn-back:hover{ color:#FFD60A }
.y-cn-back:focus-visible{ outline:2px solid #FFD60A; outline-offset:3px; border-radius:4px }
.y-cn-face{
  flex:0 0 auto; width:54px; height:54px; border-radius:9999px; overflow:hidden;
  display:flex; align-items:center; justify-content:center; line-height:1;
  box-shadow:0 10px 26px -14px rgba(0,0,0,.9),
             inset 0 0 0 1px rgba(255,255,255,.12),
             inset 0 1px 0 rgba(255,255,255,.38);
}
.y-cn-mono{
  font-weight:600; letter-spacing:.02em; color:#FFF8E7;
  text-shadow:0 1px 4px rgba(0,0,0,.45);
}
.y-cn-name{
  margin:0; font-size:21px; font-weight:650; letter-spacing:-.022em; line-height:1.16;
  color:#FFF8E7;
}
.y-cn-tag{
  margin:4px 0 0; font-size:13.5px; line-height:1.4; color:rgba(255,248,231,.62);
}
/* Yellow glass, not filled: the Send CTA is the only filled thing here. */
.y-cn-shared{
  display:inline-flex; align-items:center; margin-top:10px; height:24px; padding:0 10px;
  border-radius:9999px; font-size:10.5px; font-weight:500; letter-spacing:.14em;
  text-transform:uppercase; color:#FFD60A;
  background:linear-gradient(0deg, rgba(255,214,10,.14), rgba(255,214,10,.14)),
             linear-gradient(0deg, rgba(255,255,255,.05), rgba(255,255,255,.05));
  border:1px solid rgba(255,255,255,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22);
  backdrop-filter:blur(18px) saturate(1.6);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);
}

/* Status card — chrome glass, the screen's instrumentation panel. */
.y-cn-strip{
  padding:14px 16px; border-radius:18px;
  background:rgba(20,17,10,.70);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06), 0 10px 30px -14px rgba(0,0,0,.6);
  backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
}
@supports not (backdrop-filter: blur(1px)){
  .y-cn-shared{ background:rgba(60,48,10,.85) }
  .y-cn-strip{ background:rgba(16,14,9,.94) }
}
.y-cn-strip-eyebrow{
  display:flex; align-items:center; gap:8px;
  font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:rgba(255,214,10,.78);
}
.y-cn-strip-title{
  margin:9px 0 0; font-size:16.5px; font-weight:600; letter-spacing:-.014em; line-height:1.26;
  color:#FFF8E7;
}
.y-cn-strip-sub{
  margin:6px 0 0; font-size:13.5px; line-height:1.45; color:rgba(255,248,231,.5);
}
.y-cn-pulse{
  width:6px; height:6px; border-radius:9999px; background:#FFD60A;
  animation:y-cn-pulse 1.4s ease-in-out infinite;
}
@keyframes y-cn-pulse{ 0%,100%{ opacity:1; transform:scale(1) } 50%{ opacity:.3; transform:scale(.7) } }

/* The rail: one node per question, split down the middle. Left half fills
   when they answered, right half when you did. Both halves lit = unlocked. */
.y-cn-step{ position:relative; padding:0 0 26px 34px }
.y-cn-step:last-child{ padding-bottom:6px }
.y-cn-rail{
  position:absolute; left:0; top:5px; bottom:0; width:16px;
  display:flex; flex-direction:column; align-items:center;
}
.y-cn-node{
  flex:0 0 auto; width:16px; height:16px; border-radius:9999px; display:flex; overflow:hidden;
  background:rgba(255,255,255,.045);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);
  transition:box-shadow 480ms cubic-bezier(.32,.72,0,1);
}
.y-cn-node-done{ box-shadow:inset 0 0 0 1px rgba(255,214,10,.45) }
.y-cn-half{ flex:1 1 0; background:transparent; transition:background 480ms cubic-bezier(.32,.72,0,1) }
.y-cn-half-them{ background:#FFE45C }
.y-cn-half-me{ background:#FFC300 }
.y-cn-line{
  flex:1 1 auto; width:1px; margin-top:6px;
  background:rgba(255,255,255,.1);
  transition:background 560ms cubic-bezier(.32,.72,0,1);
}
.y-cn-line-on{ background:linear-gradient(180deg, rgba(255,214,10,.55), rgba(255,214,10,.14)) }

.y-cn-q{
  margin:0 0 12px; font-size:16.5px; font-weight:600; letter-spacing:-.014em;
  line-height:1.24; color:#FFF8E7;
}
/* Capped so the notes keep reading as chat bubbles on a wide column. */
.y-cn-slot{ display:flex; flex-direction:column; gap:14px; max-width:470px }
.y-cn-enter{ animation:y-cn-enter 420ms cubic-bezier(.32,.72,0,1) backwards }
@keyframes y-cn-enter{ from{ opacity:0; transform:translateY(10px) } }

.y-cn-typing{
  display:inline-flex; align-items:center; gap:6px; align-self:flex-start;
  height:36px; padding:0 15px; border-radius:18px 18px 18px 6px;
  background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08);
  backdrop-filter:blur(16px) saturate(1.3);
  -webkit-backdrop-filter:blur(16px) saturate(1.3);
}
.y-cn-dot{
  width:5px; height:5px; border-radius:9999px; background:rgba(255,248,231,.5);
  animation:y-cn-dot 1.15s ease-in-out infinite;
}
@keyframes y-cn-dot{ 0%,100%{ opacity:.25; transform:translateY(0) } 45%{ opacity:1; transform:translateY(-3px) } }

.y-cn-empty{
  margin:0 0 22px; padding:14px 16px; max-width:470px;
  border-radius:18px; border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.06);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter:blur(16px) saturate(1.3);
  -webkit-backdrop-filter:blur(16px) saturate(1.3);
}
@supports not (backdrop-filter: blur(1px)){
  .y-cn-typing,.y-cn-empty{ background:rgba(38,34,26,.9) }
}
.y-cn-empty .y-cn-strip-eyebrow{ color:rgba(255,248,231,.4) }
.y-cn-empty-line{
  margin:8px 0 0; font-size:13.5px; line-height:1.5; color:rgba(255,248,231,.5);
}

/* Sticks to the bottom of whatever column the app frame gives us, and bleeds
   its background out past the frame's gutter so the CTA always sits on solid
   ground while the thread scrolls behind it. */
.y-cn-foot{
  position:sticky; bottom:0; z-index:2;
  margin:10px -20px 0; padding:12px 20px calc(14px + env(safe-area-inset-bottom, 0px));
  border-top:1px solid rgba(255,255,255,.08);
  background:rgba(20,17,10,.70);
  backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
  animation:y-cn-foot 420ms cubic-bezier(.32,.72,0,1) backwards;
}
@supports not (backdrop-filter: blur(1px)){
  .y-cn-foot{ background:rgba(16,14,9,.96) }
}
@media (min-width:768px){
  .y-cn-foot{ margin-left:-32px; margin-right:-32px; padding-left:32px; padding-right:32px }
}
@keyframes y-cn-foot{ from{ transform:translateY(14px); opacity:0 } }
.y-cn-cta{
  display:flex; align-items:center; justify-content:center; gap:9px;
  width:100%; height:50px; border-radius:9999px; border:0; cursor:pointer; text-decoration:none;
  font-size:15px; font-weight:600; letter-spacing:-.01em; color:#1A1200;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 8px 24px -10px rgba(255,199,0,.55), inset 0 1px 0 rgba(255,255,255,.5);
  transition:transform 120ms cubic-bezier(.32,.72,0,1), filter 160ms linear;
}
.y-cn-cta:hover:not(:disabled){ filter:brightness(1.04) }
.y-cn-cta:active:not(:disabled){ transform:scale(.97) }
.y-cn-cta:focus-visible{ outline:2px solid #FFF8E7; outline-offset:2px }
.y-cn-cta:disabled{
  cursor:not-allowed; color:rgba(255,248,231,.28); background:rgba(255,255,255,.045);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);
}
/* Not a button: there is nothing left to press until they answer. */
.y-cn-cta-status{
  cursor:default; color:rgba(255,248,231,.4);
  background:rgba(255,255,255,.045); box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);
}
.y-cn-count{
  margin:12px 0 0; text-align:center;
  font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:rgba(255,248,231,.3);
}
.y-cn-quiet{
  display:block; width:max-content; margin:12px auto 0; padding:4px 2px;
  border:0; background:none; cursor:pointer; text-decoration:none;
  font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:rgba(255,248,231,.4); transition:color 180ms linear;
}
.y-cn-quiet:hover{ color:#FFD60A }
.y-cn-quiet:focus-visible{ outline:2px solid #FFD60A; outline-offset:3px; border-radius:4px }
.y-cn-quiet:disabled{ opacity:.4; cursor:not-allowed }

.y-cn-glyph{
  width:46px; height:46px; border-radius:9999px;
  display:flex; align-items:center; justify-content:center;
  color:rgba(255,248,231,.55); background:rgba(255,255,255,.05);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);
}
@media (prefers-reduced-motion: reduce){
  .y-cn-enter,.y-cn-foot{ animation-duration:1ms }
  .y-cn-pulse,.y-cn-dot{ animation:none }
  .y-cn-cta,.y-cn-node,.y-cn-half,.y-cn-line{ transition-duration:1ms }
}
`}</style>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { people, peopleSource } = useAppState();
  const person = useMemo(() => people.find((p) => p.id === id), [people, id]);

  // The directory arrives asynchronously. Never flash "no one here by that
  // name" at someone who is simply waiting on a network round trip.
  if (!person) {
    if (peopleSource === 'loading') return <Opening />;
    return <NotFound id={id} />;
  }
  return <Exchange person={person} />;
}

function Opening() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <ConnectStyles />
      <span
        className="y-cn-strip-eyebrow"
        style={{ fontFamily: MONO, color: 'rgba(255,248,231,.3)' }}
      >
        <span className="y-cn-pulse" aria-hidden />
        Opening
      </span>
    </div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div
      className="flex min-h-[70vh] w-full flex-col items-center justify-center gap-3 text-center"
      style={{ fontFamily: SANS }}
    >
      <ConnectStyles />
      <span aria-hidden className="y-cn-glyph">
        <svg width="22" height="22" viewBox="0 0 22 22">
          <circle
            cx="11"
            cy="11"
            r="8.2"
            stroke="currentColor"
            strokeWidth="1.6"
            fill="none"
            opacity=".5"
          />
          <path
            d="M7.4 7.4 14.6 14.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <h1
        style={{
          margin: '6px 0 0',
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: '-.02em',
        }}
      >
        No one here by that name
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 15,
          lineHeight: 1.5,
          color: 'rgba(255,248,231,.62)',
          maxWidth: '24em',
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 13 }}>/connect/{id}</span>
        {' doesn’t match anyone on Yellow. Pick someone from your matches instead.'}
      </p>
      <Link href="/home" className="y-cn-cta" style={{ maxWidth: 220, marginTop: 12 }}>
        Back to matches
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Playable URLs for one person's three clips. The in-session object URL wins,
 * otherwise the key is presigned once and cached under the same message id the
 * chat thread uses, so a clip is fetched once per session at most.
 */
function useClipUrls(
  intro: VoiceIntro | null,
  ownerId: string,
): Partial<Record<IntroKey, string>> {
  const [urls, setUrls] = useState<Partial<Record<IntroKey, string>>>({});

  useEffect(() => {
    if (!intro || !ownerId) return;
    let active = true;

    void (async () => {
      const found: Partial<Record<IntroKey, string>> = {};
      await Promise.all(
        INTRO_KEYS.map(async (key) => {
          const clip = intro[key];
          const url =
            (await resolvePlaybackUrl(clipMessageId(ownerId, key), clip.s3Key)) ?? clip.url;
          if (url) found[key] = url;
        }),
      );
      if (active) setUrls(found);
    })();

    return () => {
      active = false;
    };
  }, [intro, ownerId]);

  return urls;
}

function Exchange({ person }: { person: SeedPersona }) {
  const {
    state,
    people,
    ensureConnection,
    setStage,
    myIntro,
    setMyIntro,
    refreshPairs,
    suppressNotice,
  } = useAppState();

  const [answers, setAnswers] = useState<Partial<Record<IntroKey, VoiceAnswer>>>({});
  const [sending, setSending] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [rerecording, setRerecording] = useState(false);

  const [meId, setMeId] = useState('');
  const [pair, setPair] = useState<PairView | null>(null);
  const [theirIntro, setTheirIntro] = useState<VoiceIntro | null>(null);
  const [theirIntroLoaded, setTheirIntroLoaded] = useState(false);

  const sentRef = useRef(false);
  const sendingRef = useRef(false);
  const haveTheirIntroRef = useRef(false);
  /** True once we've seen "mine is in, theirs isn't" — what makes the flip news. */
  const waitedRef = useRef(false);
  const pairSigRef = useRef('');

  /* A poll that answers with what we already have must not re-render the page
     out from under a recorder that is halfway through a take. */
  const applyPair = useCallback((view: PairView | null) => {
    const signature = JSON.stringify(view);
    if (signature === pairSigRef.current) return;
    pairSigRef.current = signature;
    setPair(view);
  }, []);

  const firstName = person.name.split(' ')[0];

  const alreadyConnected = pair?.connectedAt != null;
  const waiting = Boolean(pair?.myIntroSent) && !alreadyConnected;

  const theirUrls = useClipUrls(theirIntro, person.id);
  const myUrls = useClipUrls(myIntro, meId);

  const overlap = useMemo(() => {
    if (!state.me) return null;
    const match = rankMatches(state.me, people).find((m) => m.person.id === person.id);
    if (!match) return null;
    return match.sharedSkills.length + match.sharedInterests.length;
  }, [state.me, people, person.id]);

  /* Register the connection as soon as we know the store is real. */
  useEffect(() => {
    if (!state.hydrated) return;
    ensureConnection(person.id);
  }, [state.hydrated, person.id, ensureConnection]);

  useEffect(() => {
    if (!state.hydrated || alreadyConnected) return;
    if (state.connections[person.id]?.stage === 'stranger') {
      setStage(person.id, 'intro_pending');
    }
  }, [state.hydrated, state.connections, alreadyConnected, person.id, setStage]);

  /* -- server truth ------------------------------------------------- */

  useEffect(() => {
    let active = true;

    const load = async () => {
      const me = await resolveIdentity();
      if (!active) return;
      setMeId(me);

      const [view, intro] = await Promise.all([
        fetchPair(person.id, me),
        haveTheirIntroRef.current ? Promise.resolve(null) : fetchIntro(person.id),
      ]);
      if (!active) return;

      if (intro) {
        haveTheirIntroRef.current = true;
        setTheirIntro(intro);
      }
      setTheirIntroLoaded(true);
      // A send in flight already knows more than a poll that started before it.
      if (!sendingRef.current) applyPair(view);
    };

    void load();

    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      void load();
    };
    const poll = setInterval(tick, PAIR_POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);

    return () => {
      active = false;
      clearInterval(poll);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [person.id, applyPair]);

  /* The unlock can land while this page is open — from the poll, not from us
     telling ourselves they answered. Someone who arrives at an already-open
     connection gets the summary instead; only a wait that flips is news. */
  useEffect(() => {
    if (!pair) return;
    if (pair.myIntroSent && !pair.connectedAt) {
      waitedRef.current = true;
      return;
    }
    if (pair.connectedAt && waitedRef.current) {
      waitedRef.current = false;
      setCelebrating(true);
    }
  }, [pair]);

  const setAnswer = useCallback((key: IntroKey, answer: VoiceAnswer | null) => {
    setAnswers((prev) => {
      if (answer === null) {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: answer };
    });
  }, []);

  const useSaved = Boolean(myIntro) && !rerecording;
  const answeredCount = QUESTIONS.filter((q) => Boolean(answers[q.key])).length;
  const ready = useSaved || answeredCount === QUESTIONS.length;

  /* -- send --------------------------------------------------------- */

  const handleSend = useCallback(async () => {
    if (!ready || sending || sentRef.current) return;
    sentRef.current = true;
    sendingRef.current = true;
    setSending(true);

    const me = await resolveIdentity();
    let intro = useSaved ? myIntro : null;

    if (!intro) {
      const clips: Partial<Record<IntroKey, VoiceClip>> = {};
      const uploads: Promise<void>[] = [];

      for (const key of INTRO_KEYS) {
        const answer = answers[key];
        if (!answer) continue;

        if (answer.kind === 'text') {
          clips[key] = {
            durationSec: estimateDuration(answer.text),
            waveSeed: waveSeedFrom(`${me}:${key}`),
            text: answer.text,
          };
          continue;
        }

        const clip: VoiceClip = {
          durationSec: answer.durationSec,
          waveSeed: answer.waveSeed,
        };
        const messageId = clipMessageId(me, key);
        // Playback comes from this object URL whether or not S3 ever works.
        setAudioUrl(messageId, answer.url);
        uploads.push(
          uploadClip(me, messageId, answer.blob).then((s3Key) => {
            if (s3Key) clip.s3Key = s3Key;
          }),
        );
        clips[key] = clip;
      }

      // S3 is a nice-to-have. Give it a moment, then move on regardless.
      await Promise.race([
        Promise.allSettled(uploads),
        new Promise((resolve) => setTimeout(resolve, UPLOAD_BUDGET_MS)),
      ]);

      const { who, building, lookingFor } = clips;
      if (!who || !building || !lookingFor) {
        sentRef.current = false;
        sendingRef.current = false;
        setSending(false);
        return;
      }

      intro = { who, building, lookingFor, recordedAt: Date.now() };
      await saveIntro(intro, me);
      setMyIntro(intro);
      setRerecording(false);
    }

    // The celebration below is this screen's job; a toast on top of it is noise.
    suppressNotice(person.id);

    const result = await sendPairIntro(person.id, me);
    void refreshPairs();

    if (result.pair) applyPair(result.pair);
    // Nothing landed, so let them try again rather than stranding the CTA.
    else sentRef.current = false;

    sendingRef.current = false;
    setSending(false);
    if (result.connected) setCelebrating(true);
  }, [
    ready,
    sending,
    useSaved,
    myIntro,
    answers,
    person.id,
    setMyIntro,
    suppressNotice,
    refreshPairs,
    applyPair,
  ]);

  /* -- render ------------------------------------------------------- */

  if (!state.hydrated) return <Opening />;

  const theirIntroMissing = theirIntroLoaded && !theirIntro;

  return (
    <div className="flex w-full flex-col" style={{ fontFamily: SANS }}>
      <ConnectStyles />

      <header className="pt-[18px]">
        <Link href="/home" className="y-cn-back" style={{ fontFamily: MONO }}>
          <svg width="14" height="11" viewBox="0 0 14 11" aria-hidden>
            <path
              d="M13 5.5H1.4M6 1 1.4 5.5 6 10"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          Matches
        </Link>

        <div className="mt-[14px] flex items-start gap-[13px]">
          <span
            className="y-cn-face"
            aria-hidden
            style={{
              background: [
                photoLayer(person.photoUrl),
                'radial-gradient(circle at 34% 26%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 48%)',
                `linear-gradient(150deg, ${person.gradient[0]}, ${person.gradient[1]})`,
              ]
                .filter(Boolean)
                .join(', '),
            }}
          >
            {photoLayer(person.photoUrl) ? null : (
              <span
                className="y-cn-mono"
                style={{ fontSize: initialsFor(person.name).length > 1 ? 17.5 : 22 }}
              >
                {initialsFor(person.name)}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="y-cn-name">{person.name}</h1>
            <p className="y-cn-tag">{person.tagline}</p>
            {overlap !== null && overlap > 0 ? (
              <span className="y-cn-shared" style={{ fontFamily: MONO }}>
                {overlap} shared
              </span>
            ) : null}
          </div>
        </div>

        <div className="y-cn-strip mt-[18px]">
          {alreadyConnected ? (
            <>
              <span className="y-cn-strip-eyebrow" style={{ fontFamily: MONO }}>
                Intros exchanged
              </span>
              <p className="y-cn-strip-sub">
                You both answered all three. The chat is open.
              </p>
            </>
          ) : waiting ? (
            <>
              <span className="y-cn-strip-eyebrow" style={{ fontFamily: MONO }}>
                Intro sent
              </span>
              <h2 className="y-cn-strip-title">Your intro is with {firstName}.</h2>
              <p className="y-cn-strip-sub">
                They&rsquo;ll get it next time they open Yellow. The chat opens the moment
                they send theirs back.
              </p>
            </>
          ) : (
            <>
              <span className="y-cn-strip-eyebrow" style={{ fontFamily: MONO }}>
                Your turn
              </span>
              <p className="y-cn-strip-sub">
                Answer all three. Neither of you can message until both have.
              </p>
            </>
          )}
        </div>
      </header>

      <div className="pt-[18px]">
        {theirIntroMissing && !alreadyConnected ? (
          <div className="y-cn-empty">
            <span className="y-cn-strip-eyebrow" style={{ fontFamily: MONO }}>
              Nothing yet
            </span>
            {/* One string, not a fragment: JSX drops the space between an
                expression and text that wraps onto the next line. */}
            <p className="y-cn-empty-line">
              {waiting
                ? `${firstName} hasn’t recorded their intro yet. Yours is waiting for them.`
                : `${firstName} hasn’t recorded their intro yet. Send yours and they’ll get it the moment they do.`}
            </p>
          </div>
        ) : null}

        {QUESTIONS.map((question, i) => {
          const theirClip = theirIntro?.[question.key];
          const myClip = useSaved ? myIntro?.[question.key] : undefined;
          const theirIn = Boolean(pair?.theirIntroSent);
          // Lights as soon as *you* have an answer for this question, not only
          // once the send lands — the rail's job is per-question feedback while
          // you work. The node only completes on server truth.
          const mineIn =
            Boolean(pair?.myIntroSent) || Boolean(myClip) || Boolean(answers[question.key]);
          const done = theirIn && Boolean(pair?.myIntroSent);

          return (
            <section className="y-cn-step" key={question.key}>
              <div className="y-cn-rail" aria-hidden>
                <span className={`y-cn-node${done ? ' y-cn-node-done' : ''}`}>
                  <span className={`y-cn-half${theirIn ? ' y-cn-half-them' : ''}`} />
                  <span className={`y-cn-half${mineIn ? ' y-cn-half-me' : ''}`} />
                </span>
                {i < QUESTIONS.length - 1 ? (
                  <span className={`y-cn-line${done ? ' y-cn-line-on' : ''}`} />
                ) : null}
              </div>

              <h2 className="y-cn-q">{question.label}</h2>

              <div className="y-cn-slot">
                {theirClip ? (
                  <VoiceNoteBubble
                    className="y-cn-enter"
                    side="them"
                    kind={clipKind(theirClip)}
                    text={theirClip.text}
                    durationSec={theirClip.durationSec}
                    waveSeed={theirClip.waveSeed}
                    audioUrl={theirUrls[question.key] ?? null}
                    label={`${firstName}’s answer`}
                  />
                ) : !theirIntroLoaded ? (
                  <span className="y-cn-typing" aria-label={`Loading ${firstName}’s answer`}>
                    <span className="y-cn-dot" style={{ animationDelay: '0ms' }} />
                    <span className="y-cn-dot" style={{ animationDelay: '160ms' }} />
                    <span className="y-cn-dot" style={{ animationDelay: '320ms' }} />
                  </span>
                ) : null}

                {myClip ? (
                  <VoiceNoteBubble
                    side="me"
                    kind={clipKind(myClip)}
                    text={myClip.text}
                    durationSec={myClip.durationSec}
                    waveSeed={myClip.waveSeed}
                    audioUrl={myUrls[question.key] ?? null}
                    label="Your answer"
                  />
                ) : waiting || alreadyConnected ? null : (
                  <div className="y-cn-enter">
                    <VoiceRecorder
                      id={`${person.id}-${question.key}`}
                      question={question.label}
                      disabled={sending || celebrating}
                      onChange={(answer) => setAnswer(question.key, answer)}
                    />
                  </div>
                )}
              </div>
            </section>
          );
        })}

        {useSaved && !waiting && !alreadyConnected ? (
          <button
            type="button"
            className="y-cn-quiet"
            style={{ fontFamily: MONO }}
            onClick={() => setRerecording(true)}
            disabled={sending}
          >
            Record again
          </button>
        ) : null}
      </div>

      {alreadyConnected ? (
        <footer className="y-cn-foot">
          <Link href={`/chat/${person.id}`} className="y-cn-cta">
            Go to chat
            <Arrow />
          </Link>
          <p className="y-cn-count" style={{ fontFamily: MONO }}>
            Connected
          </p>
        </footer>
      ) : waiting ? (
        <footer className="y-cn-foot">
          <span className="y-cn-cta y-cn-cta-status" aria-live="polite">
            Waiting on {firstName}
          </span>
          <Link href="/home" className="y-cn-quiet" style={{ fontFamily: MONO }}>
            Back to matches
          </Link>
        </footer>
      ) : (
        <footer className="y-cn-foot">
          <button
            type="button"
            className="y-cn-cta"
            onClick={() => void handleSend()}
            disabled={!ready || sending || celebrating}
          >
            {sending ? 'Sending…' : `Send my intro to ${firstName}`}
            {!sending && ready ? <Arrow /> : null}
          </button>
          <p className="y-cn-count" style={{ fontFamily: MONO }}>
            {useSaved
              ? 'Your recorded intro'
              : `${answeredCount} of ${QUESTIONS.length} answered`}
          </p>
        </footer>
      )}

      {celebrating ? (
        <Celebration
          person={person}
          me={state.me ?? undefined}
          href={`/chat/${person.id}`}
          ctaLabel={`Say hi to ${firstName}`}
        />
      ) : null}
    </div>
  );
}

function Arrow() {
  return (
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
  );
}
