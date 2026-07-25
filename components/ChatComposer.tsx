'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const MAX_SECONDS = 30;
const BAR_COUNT = 16;

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

type WithWebkitAudio = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const type of MIME_CANDIDATES) {
    if (
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported(type)
    ) {
      return type;
    }
  }
  return undefined;
}

/**
 * Whether this browser can record at all. Read through `useSyncExternalStore`
 * rather than an effect: the server has no `MediaRecorder`, and this is the
 * one hook that lets the server and client disagree without a mismatch.
 */
function canRecordHere(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

const neverChanges = () => () => {};
const noRecorderOnServer = () => false;

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — its own href, so it can't collide with the      */
/* chat page's sheet even though it borrows its visual language.        */
/* ------------------------------------------------------------------ */
function ComposerStyles() {
  return (
    <style href="yellow-composer" precedence="high">{`
.y-cc{ --lvl:0; display:flex; align-items:center; gap:8px; width:100%; margin:0 }

.y-cc-input{
  flex:1; min-width:0; height:44px; padding:0 15px;
  border-radius:9999px; border:1px solid rgba(255,214,10,.15);
  background:rgba(255,248,231,.045); color:#FFF8E7;
  font-size:14.5px; letter-spacing:-.008em; outline:none;
  transition:border-color 220ms linear, background 220ms linear;
}
.y-cc-input::placeholder{ color:rgba(255,248,231,.3) }
.y-cc-input:focus{ border-color:rgba(255,214,10,.5); background:rgba(255,248,231,.07) }
.y-cc-input:disabled{ opacity:.5 }

.y-cc-btn{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:44px; height:44px; border-radius:9999px; cursor:pointer;
  color:rgba(255,248,231,.66); background:rgba(255,248,231,.045);
  border:1px solid rgba(255,214,10,.15);
  transition:color 200ms linear, border-color 200ms linear, background 200ms linear;
}
.y-cc-btn:hover:not(:disabled){ color:#FFF8E7; border-color:rgba(255,214,10,.42); background:rgba(255,214,10,.07) }
.y-cc-btn:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px }
.y-cc-btn:disabled{ opacity:.35; cursor:default }

.y-cc-send{
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:44px; height:44px; border-radius:9999px; border:0; cursor:pointer;
  color:#1A1200; background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 8px 22px -10px rgba(255,195,0,.75), inset 0 1px 0 rgba(255,255,255,.6);
  transition:transform 240ms cubic-bezier(.22,1,.36,1), opacity 200ms linear, filter 200ms linear;
}
.y-cc-send:hover:not(:disabled){ filter:brightness(1.06); transform:translateY(-1px) }
.y-cc-send:active:not(:disabled){ transform:scale(.94); transition-duration:110ms }
.y-cc-send:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px }
.y-cc-send:disabled{
  cursor:default; opacity:.32; background:rgba(255,248,231,.1);
  color:rgba(255,248,231,.5); box-shadow:none;
}

.y-cc-live{
  flex:1; min-width:0; display:flex; align-items:center; gap:9px;
  height:44px; padding:0 14px; border-radius:9999px;
  border:1px solid rgba(255,214,10,calc(.3 + var(--lvl) * .5));
  background:linear-gradient(180deg, rgba(255,214,10,calc(.07 + var(--lvl) * .1)), rgba(255,195,0,.03));
  box-shadow:0 0 calc(12px + var(--lvl) * 34px) -12px rgba(255,195,0,calc(.4 + var(--lvl) * .5));
}
.y-cc-pulse{
  flex:0 0 auto; width:7px; height:7px; border-radius:9999px; background:#FFD60A;
  animation:y-cc-pulse 1.6s ease-in-out infinite;
}
@keyframes y-cc-pulse{ 0%,100%{ opacity:1 } 50%{ opacity:.32 } }
.y-cc-wave{ flex:1 1 auto; min-width:0; height:20px; display:flex; align-items:center; gap:2px }
.y-cc-bar{
  flex:1 1 0; min-width:2px; height:100%; border-radius:2px;
  background:linear-gradient(180deg,#FFE45C,#FFC300);
  transform:scaleY(.07); transform-origin:center;
}
.y-cc-time{
  flex:0 0 auto; font-size:12px; font-variant-numeric:tabular-nums;
  letter-spacing:.02em; color:#FFD60A;
}

@media (prefers-reduced-motion: reduce){
  .y-cc-pulse{ animation:none; opacity:.8 }
  .y-cc-send{ transition-duration:1ms }
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */

export interface ChatComposerProps {
  personName: string;
  disabled?: boolean;
  onSendText(text: string): void;
  onSendVoice(clip: { blob: Blob; durationSec: number; waveSeed: number }): void;
}

type Phase = 'idle' | 'requesting' | 'recording';

export default function ChatComposer({
  personName,
  disabled = false,
  onSendText,
  onSendVoice,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [micDenied, setMicDenied] = useState(false);

  const recordable = useSyncExternalStore(
    neverChanges,
    canRecordHere,
    noRecorderOnServer,
  );
  const micUsable = recordable && !micDenied;

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const binsRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const liveRef = useRef<HTMLDivElement | null>(null);
  /** Whether the clip about to stop should be sent or thrown away. */
  const keepRef = useRef(false);
  /** Bumped whenever we move on, so a late `getUserMedia` can't hijack the bar. */
  const runRef = useRef(0);

  const releaseMic = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Already stopping.
      }
    }
    recorderRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    analyserRef.current = null;
    binsRef.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});

    liveRef.current?.style.setProperty('--lvl', '0');
    barsRef.current.forEach((bar) => bar?.style.setProperty('transform', 'scaleY(.07)'));
  }, []);

  useEffect(
    () => () => {
      runRef.current += 1;
      keepRef.current = false;
      releaseMic();
    },
    [releaseMic],
  );

  const startMeter = useCallback(() => {
    function step() {
      const analyser = analyserRef.current;
      const bins = binsRef.current;
      let level = 0;

      if (analyser && bins) {
        analyser.getByteFrequencyData(bins);
        const usable = Math.min(bins.length, 48);
        const perBar = Math.max(1, Math.floor(usable / BAR_COUNT));
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < perBar; j++) sum += bins[Math.min(usable - 1, i * perBar + j)];
          // Speech piles into the low bins, so lift the tail to keep the row alive.
          const boost = 1 + (i / BAR_COUNT) * 1.5;
          const value = Math.min(1, (sum / perBar / 255) * boost * 1.5);
          level += value;
          barsRef.current[i]?.style.setProperty(
            'transform',
            `scaleY(${(0.07 + value * 0.93).toFixed(3)})`,
          );
        }
        level /= BAR_COUNT;
      } else {
        const t = performance.now() / 1000;
        for (let i = 0; i < BAR_COUNT; i++) {
          const value =
            0.18 +
            0.34 * Math.abs(Math.sin(t * 3.1 + i * 0.55)) +
            0.26 * Math.abs(Math.sin(t * 7.7 + i * 1.9));
          barsRef.current[i]?.style.setProperty('transform', `scaleY(${value.toFixed(3)})`);
          level += value;
        }
        level /= BAR_COUNT;
      }

      liveRef.current?.style.setProperty('--lvl', level.toFixed(3));

      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      elapsedRef.current = elapsed;
      setSeconds((prev) => (Math.floor(elapsed) !== prev ? Math.floor(elapsed) : prev));

      if (elapsed >= MAX_SECONDS) {
        const recorder = recorderRef.current;
        // The cap sends what's there; thirty seconds of speech is not a mistake.
        keepRef.current = true;
        if (recorder && recorder.state === 'recording') recorder.stop();
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const start = useCallback(async () => {
    if (disabled) return;
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      setMicDenied(true);
      return;
    }

    setPhase('requesting');
    const run = (runRef.current += 1);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (runRef.current !== run) return;
      setMicDenied(true);
      setPhase('idle');
      return;
    }
    if (runRef.current !== run) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;

    try {
      const Ctor = window.AudioContext ?? (window as WithWebkitAudio).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.72;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        binsRef.current = new Uint8Array(analyser.frequencyBinCount);
        if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      }
    } catch {
      analyserRef.current = null;
      binsRef.current = null;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseMic();
      setMicDenied(true);
      setPhase('idle');
      return;
    }

    chunksRef.current = [];
    keepRef.current = false;
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      keepRef.current = false;
      releaseMic();
      setPhase('idle');
      setSeconds(0);
    };

    recorder.onstop = () => {
      const measured = Math.max(1, Math.round(elapsedRef.current));
      const keep = keepRef.current;
      keepRef.current = false;
      releaseMic();

      const blob = new Blob(chunksRef.current, { type: mimeType ?? 'audio/webm' });
      chunksRef.current = [];

      if (runRef.current !== run) return;

      setPhase('idle');
      setSeconds(0);
      if (!keep || blob.size === 0) return;

      onSendVoice({
        blob,
        durationSec: measured,
        waveSeed: Math.floor(Math.random() * 2 ** 32),
      });
    };

    startedAtRef.current = performance.now();
    elapsedRef.current = 0;
    setSeconds(0);
    recorder.start();
    setPhase('recording');
    startMeter();
  }, [disabled, onSendVoice, releaseMic, startMeter]);

  const finish = useCallback(() => {
    keepRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
    else releaseMic();
  }, [releaseMic]);

  const cancel = useCallback(() => {
    runRef.current += 1;
    keepRef.current = false;
    releaseMic();
    setPhase('idle');
    setSeconds(0);
  }, [releaseMic]);

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || disabled) return;
      setDraft('');
      onSendText(text);
    },
    [disabled, draft, onSendText],
  );

  const firstName = personName.split(' ')[0];
  const recording = phase === 'recording';

  return (
    <form className="y-cc" style={{ fontFamily: SANS }} onSubmit={submit}>
      <ComposerStyles />

      {recording ? (
        <>
          <button
            type="button"
            className="y-cc-btn"
            onClick={cancel}
            aria-label="Discard this recording"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
              <path
                d="M1.4 1.4l10.2 10.2M11.6 1.4L1.4 11.6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="y-cc-live" ref={liveRef}>
            <span className="y-cc-pulse" aria-hidden />
            <span className="y-cc-wave" aria-hidden>
              {Array.from({ length: BAR_COUNT }, (_, i) => (
                <span
                  key={i}
                  className="y-cc-bar"
                  ref={(node) => {
                    barsRef.current[i] = node;
                  }}
                />
              ))}
            </span>
            <span className="y-cc-time" style={{ fontFamily: MONO }}>
              {mmss(seconds)}
            </span>
          </div>

          <button
            type="button"
            className="y-cc-send"
            onClick={finish}
            aria-label="Send this voice note"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M2.6 8H14M14 8L9 3M14 8l-5 5"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        </>
      ) : (
        <>
          <input
            className="y-cc-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Message ${firstName}`}
            aria-label={`Message ${personName}`}
            autoComplete="off"
            disabled={disabled}
          />

          {micUsable ? (
            <button
              type="button"
              className="y-cc-btn"
              onClick={() => void start()}
              disabled={disabled || phase === 'requesting'}
              aria-label={
                phase === 'requesting'
                  ? 'Waiting for your mic'
                  : `Send ${firstName} a voice note`
              }
            >
              <svg width="15" height="19" viewBox="0 0 15 19" aria-hidden>
                <rect x="4.6" y="0.9" width="5.8" height="10.2" rx="2.9" fill="currentColor" />
                <path
                  d="M1.7 8.4a5.8 5.8 0 0 0 11.6 0M7.5 14.2v3.9"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>
          ) : null}

          <button
            type="submit"
            className="y-cc-send"
            disabled={disabled || draft.trim().length === 0}
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
        </>
      )}

      <span aria-live="polite" className="sr-only">
        {recording ? `Recording, ${seconds} seconds` : ''}
      </span>
    </form>
  );
}
