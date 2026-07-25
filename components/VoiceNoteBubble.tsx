'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const BAR_COUNT = 38;

/* ------------------------------------------------------------------ *
 * Deterministic waveform
 * ------------------------------------------------------------------ */

/** Small, fast, seeded PRNG. Same seed in, same sequence out, every render. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 31-bit hash, for turning a message key into a waveform seed. */
export function waveSeedFrom(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}

/**
 * Bar heights in 0..1. Envelope-shaped so it swells in the middle the way a
 * spoken sentence does, rather than looking like white noise.
 */
export function waveBars(seed = 1, count = BAR_COUNT): number[] {
  const rnd = mulberry32(seed);
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const envelope = 0.42 + 0.58 * Math.pow(Math.sin(Math.PI * t), 0.65);
    const value = (0.22 + rnd() * 0.9) * envelope;
    bars.push(Math.min(1, Math.max(0.12, value)));
  }
  return bars;
}

/** Reading pace used to give a scripted answer a believable clip length. */
export function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(29, Math.max(5, Math.round(words / 2.5)));
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

function BubbleStyles() {
  return (
    <style href="yellow-voicenote" precedence="high">{`
.y-vn{ --p:0; display:flex; flex-direction:column; gap:7px; min-width:0 }
.y-vn-eyebrow{
  font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:rgba(255,248,231,.4);
}
/* Yours is yellow glass, theirs is clear glass — the canvas refracts through
   both, and the filled play knob is the only solid thing in the bubble. */
.y-vn-body{
  position:relative; display:flex; align-items:center; gap:10px;
  padding:10px 14px 10px 10px; min-width:0;
  border:1px solid var(--edge); background:var(--fill);
  box-shadow:var(--lift);
  backdrop-filter:var(--frost); -webkit-backdrop-filter:var(--frost);
}
@supports not (backdrop-filter: blur(1px)){
  .y-vn-them .y-vn-body{ background:rgba(38,34,26,.9) }
  .y-vn-me .y-vn-body{ background:rgba(60,48,10,.85) }
}
/* Voice notes hold a fixed measure so the waveform keeps chat proportions
   instead of stretching across a wide reading column. */
.y-vn-voice .y-vn-body{ width:min(100%, 340px) }
.y-vn-them .y-vn-body{ border-radius:18px 18px 18px 6px }
.y-vn-me .y-vn-body{ border-radius:18px 18px 6px 18px }
.y-vn-play{
  flex:0 0 auto; width:34px; height:34px; border-radius:9999px; border:0; padding:0;
  display:inline-flex; align-items:center; justify-content:center; cursor:pointer;
  color:var(--ink); background:var(--knob);
  box-shadow:var(--knob-lift);
  transition:transform 120ms cubic-bezier(.32,.72,0,1), filter 160ms linear;
}
.y-vn-play:hover:not(:disabled){ filter:brightness(1.06) }
.y-vn-play:active:not(:disabled){ transform:scale(.94) }
.y-vn-play:focus-visible{ outline:2px solid var(--focus); outline-offset:2px }
.y-vn-play:disabled{
  cursor:default; color:rgba(255,248,231,.32);
  background:rgba(255,255,255,.06); box-shadow:none;
}
.y-vn-wave{
  position:relative; flex:1 1 auto; min-width:0; height:24px; overflow:hidden;
}
.y-vn-row{
  position:absolute; inset:0; display:flex; align-items:center; gap:2px;
}
/* The played portion is the same row of bars, revealed left-to-right by a
   clip. Progress moves a single custom property, so playback never re-renders
   the bars. */
.y-vn-row-lit{
  clip-path:inset(0 calc((1 - var(--p)) * 100%) 0 0);
  will-change:clip-path;
}
.y-vn-row-lit .y-vn-bar{ background:var(--lit) }
.y-vn-bar{
  flex:1 1 0; min-width:2px; border-radius:2px;
  background:var(--dim);
  transform-origin:center;
  animation:y-vn-grow 380ms cubic-bezier(.32,.72,0,1) backwards;
}
.y-vn-row-lit .y-vn-bar{ animation:none }
@keyframes y-vn-grow{ from{ transform:scaleY(.06); opacity:.3 } to{ transform:scaleY(1); opacity:1 } }
.y-vn-time{
  flex:0 0 auto; font-size:11px; letter-spacing:.02em; font-variant-numeric:tabular-nums;
  color:var(--stamp);
}
.y-vn-text{
  margin:0; font-size:15px; line-height:1.5; letter-spacing:-.006em;
  color:#FFF8E7;
}
.y-vn-word{ opacity:0; transition:opacity 340ms ease }
.y-vn-word-on{ opacity:1 }
.y-vn-note{
  display:flex; align-items:center; gap:6px;
  font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:rgba(255,248,231,.3);
}
.y-vn-hint{
  font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase;
  color:var(--stamp); opacity:.7;
}
@media (prefers-reduced-motion: reduce){
  .y-vn-bar{ animation:none }
  .y-vn-word{ transition:none }
  .y-vn-play{ transition-duration:1ms }
}
`}</style>
  );
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export type VoiceNoteSide = 'me' | 'them';

export interface VoiceNoteBubbleProps {
  /** Which way the bubble points. `me` is gold, `them` borrows their gradient. */
  side: VoiceNoteSide;
  /** `voice` renders a waveform; `text` renders the typed fallback body. */
  kind: 'voice' | 'text';
  /**
   * For `kind="text"` this is the message body. For `kind="voice"` it is the
   * transcript: present on scripted persona answers, absent on real
   * recordings. A voice note with a transcript but no audio plays back as a
   * timed transcript reveal; one with neither degrades to a disabled waveform.
   */
  text?: string;
  durationSec?: number;
  /** Same seed, same bars — the waveform must not reshuffle on re-render. */
  waveSeed?: number;
  /** Object URL from `lib/audioStore`. Absent after a refresh. */
  audioUrl?: string | null;
  /** The question this answers, set above the bubble. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

type Mode = 'audio' | 'transcript' | 'unavailable' | 'text';

export default function VoiceNoteBubble({
  side,
  kind,
  text,
  durationSec,
  waveSeed = 1,
  audioUrl,
  label,
  className,
  style,
}: VoiceNoteBubbleProps) {
  const mode: Mode =
    kind === 'text' ? 'text' : audioUrl ? 'audio' : text ? 'transcript' : 'unavailable';

  const bars = useMemo(() => waveBars(waveSeed), [waveSeed]);
  const words = useMemo(() => (text ? text.split(/(\s+)/) : []), [text]);
  const wordCount = useMemo(() => words.filter((w) => w.trim()).length, [words]);

  const [playing, setPlaying] = useState(false);
  const [shownWords, setShownWords] = useState(0);
  const [broken, setBroken] = useState(false);

  const waveRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const total = Math.max(1, durationSec ?? (text ? estimateDuration(text) : 1));

  const paint = useCallback((p: number) => {
    waveRef.current?.style.setProperty('--p', String(Math.min(1, Math.max(0, p))));
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  /* -- real playback ------------------------------------------------ */

  const followAudio = useCallback(() => {
    function step() {
      const el = audioRef.current;
      if (!el) return;
      const length = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : total;
      paint(el.currentTime / length);
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
  }, [paint, total]);

  /* -- simulated playback (scripted answers) ------------------------ */

  const followTranscript = useCallback(() => {
    function step() {
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      const p = elapsed / total;
      paint(p);
      setShownWords((prev) => {
        const next = Math.min(wordCount, Math.ceil(p * wordCount) + 1);
        return next > prev ? next : prev;
      });
      if (p >= 1) {
        stopLoop();
        paint(1);
        setShownWords(wordCount);
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
  }, [paint, stopLoop, total, wordCount]);

  const toggle = useCallback(() => {
    if (mode === 'audio') {
      const el = audioRef.current;
      if (!el) return;
      if (playing) {
        el.pause();
        stopLoop();
        setPlaying(false);
        return;
      }
      if (el.ended || el.currentTime >= (el.duration || total)) el.currentTime = 0;
      void el
        .play()
        .then(() => {
          setPlaying(true);
          stopLoop();
          followAudio();
        })
        .catch(() => {
          setBroken(true);
          setPlaying(false);
        });
      return;
    }

    if (mode === 'transcript') {
      if (playing) {
        stopLoop();
        setPlaying(false);
        return;
      }
      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        paint(1);
        setShownWords(wordCount);
        return;
      }
      startedAtRef.current = performance.now();
      setShownWords(0);
      setPlaying(true);
      stopLoop();
      followTranscript();
    }
  }, [mode, paint, playing, stopLoop, followAudio, followTranscript, total, wordCount]);

  /* -- palette ------------------------------------------------------ */

  const mine = side === 'me';
  const vars = {
    ['--fill' as string]: mine
      ? `linear-gradient(0deg, rgba(255,214,10,.16), rgba(255,214,10,.16)),
         linear-gradient(0deg, rgba(255,255,255,.05), rgba(255,255,255,.05))`
      : 'rgba(255,255,255,.06)',
    ['--edge' as string]: mine ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.08)',
    ['--frost' as string]: mine
      ? 'blur(18px) saturate(1.6)'
      : 'blur(16px) saturate(1.3)',
    ['--lift' as string]: mine
      ? 'inset 0 1px 0 rgba(255,255,255,.22)'
      : 'inset 0 1px 0 rgba(255,255,255,.05)',
    /* Only your own knob is filled yellow. A received note used to take the
       sender's raw brand gradient, which put cyan and violet discs inside a
       screen that has exactly one accent — so theirs is quiet glass instead. */
    ['--knob' as string]: mine
      ? 'linear-gradient(180deg,#FFE45C 0%,#FFC300 100%)'
      : 'rgba(255,255,255,.1)',
    ['--ink' as string]: mine ? '#1A1200' : '#FFF8E7',
    ['--knob-lift' as string]: mine
      ? 'inset 0 1px 0 rgba(255,255,255,.45)'
      : 'inset 0 0 0 1px rgba(255,255,255,.12)',
    ['--dim' as string]: mine ? 'rgba(255,214,10,.36)' : 'rgba(255,248,231,.24)',
    ['--lit' as string]: '#FFD60A',
    ['--stamp' as string]: mine ? 'rgba(255,214,10,.72)' : 'rgba(255,248,231,.45)',
    /* Cream on a cream knob would vanish, so the quiet side focuses in yellow. */
    ['--focus' as string]: mine ? '#FFF8E7' : '#FFD60A',
  } as CSSProperties;

  const disabled = mode === 'unavailable' || broken;
  const showTranscript = mode === 'transcript' && shownWords > 0;

  /* -- text-only bubble --------------------------------------------- */

  if (mode === 'text') {
    return (
      <div
        className={`y-vn y-vn-typed ${mine ? 'y-vn-me' : 'y-vn-them'} ${className ?? ''}`}
        style={{ ...vars, ...style, fontFamily: SANS }}
      >
        <BubbleStyles />
        {label ? (
          <span className="y-vn-eyebrow" style={{ fontFamily: MONO }}>
            {label}
          </span>
        ) : null}
        <div
          className="y-vn-body"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 9, padding: '12px 15px' }}
        >
          <p className="y-vn-text">{text}</p>
          <span className="y-vn-hint" style={{ fontFamily: MONO }}>
            Typed
          </span>
        </div>
      </div>
    );
  }

  /* -- voice bubble -------------------------------------------------- */

  return (
    <div
      className={`y-vn y-vn-voice ${mine ? 'y-vn-me' : 'y-vn-them'} ${className ?? ''}`}
      style={{ ...vars, ...style, fontFamily: SANS }}
    >
      <BubbleStyles />

      {label ? (
        <span className="y-vn-eyebrow" style={{ fontFamily: MONO }}>
          {label}
        </span>
      ) : null}

      <div className="y-vn-body">
        {mode === 'audio' && audioUrl ? (
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="metadata"
            onEnded={() => {
              stopLoop();
              paint(1);
              setPlaying(false);
            }}
            onError={() => {
              setBroken(true);
              setPlaying(false);
            }}
          />
        ) : null}

        <button
          type="button"
          className="y-vn-play"
          onClick={toggle}
          disabled={disabled}
          aria-label={
            disabled
              ? 'Playback unavailable'
              : playing
                ? 'Pause this voice note'
                : 'Play this voice note'
          }
        >
          {disabled ? (
            <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
              <circle cx="7.5" cy="7.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M3.7 11.3 11.3 3.7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          ) : playing ? (
            <svg width="12" height="13" viewBox="0 0 12 13" aria-hidden>
              <rect x="1.1" y="0.8" width="3.4" height="11.4" rx="1.4" fill="currentColor" />
              <rect x="7.5" y="0.8" width="3.4" height="11.4" rx="1.4" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden>
              <path
                d="M2 1.8 10.4 7 2 12.2Z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <div className="y-vn-wave" ref={waveRef} aria-hidden>
          <div className="y-vn-row">
            {bars.map((h, i) => (
              <span
                key={i}
                className="y-vn-bar"
                style={{
                  height: `${Math.round(h * 100)}%`,
                  animationDelay: `${i * 11}ms`,
                  opacity: disabled ? 0.45 : 1,
                }}
              />
            ))}
          </div>
          <div className="y-vn-row y-vn-row-lit">
            {bars.map((h, i) => (
              <span key={i} className="y-vn-bar" style={{ height: `${Math.round(h * 100)}%` }} />
            ))}
          </div>
        </div>

        <span className="y-vn-time" style={{ fontFamily: MONO }}>
          {mmss(total)}
        </span>
      </div>

      {showTranscript ? (
        <p className="y-vn-text" style={{ padding: '0 4px' }}>
          {words.map((w, i) => {
            if (!w.trim()) return <span key={i}>{w}</span>;
            const index = words.slice(0, i).filter((x) => x.trim()).length;
            return (
              <span
                key={i}
                className={`y-vn-word ${index < shownWords ? 'y-vn-word-on' : ''}`}
              >
                {w}
              </span>
            );
          })}
        </p>
      ) : null}

      {mode === 'transcript' && shownWords === 0 ? (
        <span className="y-vn-hint" style={{ fontFamily: MONO, padding: '0 4px' }}>
          Play to read along
        </span>
      ) : null}

      {disabled ? (
        <span className="y-vn-note" style={{ fontFamily: MONO, padding: '0 4px' }}>
          Recording stayed in the last session
        </span>
      ) : null}
    </div>
  );
}
