'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import VoiceNoteBubble from './VoiceNoteBubble';

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const BAR_COUNT = 26;
const WARN_AT = 10; // seconds remaining when the countdown becomes visible

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
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return undefined;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */

function RecorderStyles() {
  return (
    <style href="yellow-voicerecorder" precedence="high">{`
.y-rec{ --lvl:0; --used:0; display:flex; flex-direction:column; gap:10px }
.y-rec-card{
  position:relative; display:flex; align-items:center; gap:12px;
  padding:11px 14px 11px 11px; border-radius:19px 19px 6px 19px;
  border:1px solid rgba(255,214,10,.22);
  background:linear-gradient(180deg, rgba(255,214,10,.07), rgba(255,195,0,.028));
  transition:border-color 260ms ease, box-shadow 260ms ease, background 260ms ease;
}
.y-rec-live{
  border-color:rgba(255,214,10,calc(.34 + var(--lvl) * .5));
  background:linear-gradient(180deg, rgba(255,214,10,calc(.09 + var(--lvl) * .1)), rgba(255,195,0,.03));
  box-shadow:0 0 calc(16px + var(--lvl) * 42px) -10px rgba(255,195,0,calc(.35 + var(--lvl) * .5));
}
.y-rec-btn{
  flex:0 0 auto; width:40px; height:40px; border-radius:9999px; border:0; cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; color:#150F00;
  background:linear-gradient(180deg,#FFE45C 0%,#FFC300 100%);
  box-shadow:0 6px 18px -6px rgba(255,195,0,.75), inset 0 1px 0 rgba(255,255,255,.55);
  transition:transform 200ms cubic-bezier(.22,1,.36,1), filter 160ms linear;
}
.y-rec-btn:hover:not(:disabled){ transform:scale(1.05); filter:brightness(1.06) }
.y-rec-btn:active:not(:disabled){ transform:scale(.95) }
.y-rec-btn:focus-visible{ outline:2px solid #FFF8E7; outline-offset:3px }
.y-rec-btn:disabled{ opacity:.45; cursor:not-allowed }
.y-rec-btn-stop{
  background:linear-gradient(180deg,#FFF0A8 0%,#FFD60A 100%);
  animation:y-rec-breathe 1.9s ease-in-out infinite;
}
@keyframes y-rec-breathe{
  0%,100%{ box-shadow:0 6px 18px -6px rgba(255,195,0,.7), inset 0 1px 0 rgba(255,255,255,.55) }
  50%{ box-shadow:0 6px 30px -4px rgba(255,214,10,.95), inset 0 1px 0 rgba(255,255,255,.7) }
}
.y-rec-wave{ flex:1 1 auto; min-width:0; height:28px; display:flex; align-items:center; gap:2px }
.y-rec-bar{
  flex:1 1 0; min-width:2px; height:100%; border-radius:2px;
  background:linear-gradient(180deg,#FFE45C,#FFC300);
  transform:scaleY(.07); transform-origin:center;
}
.y-rec-idlebar{ background:rgba(255,214,10,.2) }
.y-rec-time{
  flex:0 0 auto; font-size:12px; font-variant-numeric:tabular-nums; letter-spacing:.02em;
  color:#FFD60A;
}
.y-rec-meter{
  position:absolute; left:14px; right:14px; bottom:5px; height:2px; border-radius:2px;
  background:rgba(255,248,231,.09); overflow:hidden;
}
.y-rec-meter i{
  display:block; height:100%; width:calc(var(--used) * 100%);
  background:linear-gradient(90deg,#FFD60A,#FF9F1C);
}
.y-rec-label{
  flex:1 1 auto; min-width:0; font-size:14px; letter-spacing:-.008em;
  color:rgba(255,248,231,.72); text-align:left;
}
.y-rec-quiet{
  border:0; background:none; cursor:pointer; padding:2px 0;
  font-size:9.5px; letter-spacing:.15em; text-transform:uppercase;
  color:rgba(255,248,231,.4);
  transition:color 180ms linear;
}
.y-rec-quiet:hover{ color:#FFD60A }
.y-rec-quiet:focus-visible{ outline:2px solid #FFD60A; outline-offset:3px; border-radius:4px }
.y-rec-quiet:disabled{ opacity:.4; cursor:not-allowed }
.y-rec-foot{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 4px }
.y-rec-note{
  font-size:11.5px; line-height:1.45; letter-spacing:-.004em;
  color:rgba(255,248,231,.44); margin:0;
}
.y-rec-warn{ color:#FF9F1C; animation:y-rec-blink 1s steps(2,end) infinite }
@keyframes y-rec-blink{ 50%{ opacity:.35 } }
.y-rec-ta{
  width:100%; min-height:96px; resize:vertical; padding:13px 15px;
  border-radius:19px 19px 6px 19px; border:1px solid rgba(255,214,10,.28);
  background:linear-gradient(180deg, rgba(255,214,10,.07), rgba(255,195,0,.025));
  color:#FFF8E7; font-size:14.5px; line-height:1.52; letter-spacing:-.008em;
  outline:none; transition:border-color 200ms linear, box-shadow 200ms linear;
}
.y-rec-ta::placeholder{ color:rgba(255,248,231,.28) }
.y-rec-ta:focus{
  border-color:rgba(255,214,10,.6);
  box-shadow:0 0 0 3px rgba(255,214,10,.12);
}
@media (prefers-reduced-motion: reduce){
  .y-rec-btn-stop{ animation:none }
  .y-rec-warn{ animation:none }
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */

export type VoiceAnswer =
  | { kind: 'voice'; blob: Blob; url: string; durationSec: number; waveSeed: number }
  | { kind: 'text'; text: string };

export interface VoiceRecorderProps {
  /** Stable id for this question. Used for element ids only. */
  id: string;
  /** The question being answered — placeholder and accessible names use it. */
  question: string;
  /** Fires with the finished answer, or `null` when the answer is cleared. */
  onChange: (answer: VoiceAnswer | null) => void;
  /** Hard cap on a recording. Default 30 seconds. */
  maxSeconds?: number;
  /** Locks every control, e.g. while the intro is being sent. */
  disabled?: boolean;
}

type Phase = 'idle' | 'requesting' | 'recording' | 'review' | 'text';

export default function VoiceRecorder({
  id,
  question,
  onChange,
  maxSeconds = 30,
  disabled = false,
}: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<{ url: string; durationSec: number; waveSeed: number } | null>(
    null,
  );
  const [typed, setTyped] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [micUsable, setMicUsable] = useState(true);

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
  const cardRef = useRef<HTMLDivElement | null>(null);
  /* Bumped whenever the user moves on. A `getUserMedia` prompt the user never
     answers stays pending forever, and its stream must not hijack the UI when
     it finally resolves. */
  const runRef = useRef(0);

  /* -- teardown: this is what keeps the browser's mic dot from sticking -- */

  const releaseMic = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Already stopping; nothing to do.
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

    cardRef.current?.style.setProperty('--lvl', '0');
    barsRef.current.forEach((bar) => bar?.style.setProperty('transform', 'scaleY(.07)'));
  }, []);

  useEffect(
    () => () => {
      // Invalidate any in-flight recording so its `onstop` can't report an
      // answer to a page that has already moved on.
      runRef.current += 1;
      releaseMic();
    },
    [releaseMic],
  );

  /* -- the live bar row ---------------------------------------------- */

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
          // Low frequencies dominate speech, so lift the tail to keep the row alive.
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
        // No analyser (older Safari, blocked AudioContext): keep the row moving
        // so the recording state still reads as live.
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

      cardRef.current?.style.setProperty('--lvl', level.toFixed(3));

      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      elapsedRef.current = elapsed;
      cardRef.current?.style.setProperty('--used', Math.min(1, elapsed / maxSeconds).toFixed(4));
      setSeconds((prev) => (Math.floor(elapsed) !== prev ? Math.floor(elapsed) : prev));

      if (elapsed >= maxSeconds) {
        const recorder = recorderRef.current;
        if (recorder && recorder.state === 'recording') recorder.stop();
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
  }, [maxSeconds]);

  /* -- fallbacks ------------------------------------------------------ */

  const switchToTyping = useCallback(
    (message: string | null, permanent: boolean) => {
      runRef.current += 1;
      releaseMic();
      if (permanent) setMicUsable(false);
      setNotice(message);
      setPhase('text');
    },
    [releaseMic],
  );

  /* -- start / stop --------------------------------------------------- */

  const start = useCallback(async () => {
    if (disabled) return;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      switchToTyping('This browser can’t record audio. Type your answer instead.', true);
      return;
    }

    setNotice(null);
    setPhase('requesting');
    const run = (runRef.current += 1);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (runRef.current !== run) return;
      switchToTyping('Yellow can’t reach your mic. Type your answer instead.', false);
      return;
    }
    // The user gave up on the prompt and typed instead: let the mic go.
    if (runRef.current !== run) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;

    // Real levels if the browser allows it, a convincing animation if not.
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
      switchToTyping('This browser can’t record audio. Type your answer instead.', true);
      return;
    }

    chunksRef.current = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      switchToTyping('That recording didn’t take. Type your answer instead.', false);
    };

    recorder.onstop = () => {
      const measured = Math.max(1, Math.round(elapsedRef.current));
      releaseMic();

      const blob = new Blob(chunksRef.current, { type: mimeType ?? 'audio/webm' });
      chunksRef.current = [];

      // Unmounted, or the user switched to typing while this was stopping.
      if (runRef.current !== run) return;

      if (blob.size === 0) {
        setPhase('idle');
        setNotice('Nothing came through. Try again, or type your answer.');
        return;
      }

      const url = URL.createObjectURL(blob);
      const waveSeed = Math.floor(Math.random() * 2147483646) + 1;
      setClip({ url, durationSec: measured, waveSeed });
      setPhase('review');
      setNotice(null);
      onChange({ kind: 'voice', blob, url, durationSec: measured, waveSeed });
    };

    startedAtRef.current = performance.now();
    elapsedRef.current = 0;
    setSeconds(0);
    recorder.start();
    setPhase('recording');
    startMeter();
  }, [disabled, onChange, startMeter, releaseMic, switchToTyping]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
    else releaseMic();
  }, [releaseMic]);

  const reRecord = useCallback(() => {
    const stale = clip?.url;
    setClip(null);
    onChange(null);
    setPhase('idle');
    // Let the bubble unmount before the URL goes away.
    if (stale) window.setTimeout(() => URL.revokeObjectURL(stale), 800);
  }, [clip, onChange]);

  const handleTyped = useCallback(
    (value: string) => {
      setTyped(value);
      const trimmed = value.trim();
      onChange(trimmed.length >= 2 ? { kind: 'text', text: trimmed } : null);
    },
    [onChange],
  );

  const backToMic = useCallback(() => {
    setTyped('');
    onChange(null);
    setNotice(null);
    setPhase('idle');
  }, [onChange]);

  /* -- render --------------------------------------------------------- */

  const remaining = Math.max(0, maxSeconds - seconds);

  return (
    <div className="y-rec" style={{ fontFamily: SANS }}>
      <RecorderStyles />

      {phase === 'review' && clip ? (
        <>
          <VoiceNoteBubble
            side="me"
            kind="voice"
            audioUrl={clip.url}
            durationSec={clip.durationSec}
            waveSeed={clip.waveSeed}
          />
          <div className="y-rec-foot">
            <span className="y-rec-quiet" style={{ fontFamily: MONO, color: '#FFD60A' }}>
              Your answer
            </span>
            <button
              type="button"
              className="y-rec-quiet"
              style={{ fontFamily: MONO }}
              onClick={reRecord}
              disabled={disabled}
            >
              Record again
            </button>
          </div>
        </>
      ) : phase === 'text' ? (
        <>
          <textarea
            id={`answer-${id}`}
            className="y-rec-ta"
            value={typed}
            maxLength={400}
            disabled={disabled}
            onChange={(event) => handleTyped(event.target.value)}
            placeholder={question}
            aria-label={`Your written answer to: ${question}`}
          />
          <div className="y-rec-foot">
            <p className="y-rec-note">{notice ?? 'Typed answers count just the same.'}</p>
            {micUsable ? (
              <button
                type="button"
                className="y-rec-quiet"
                style={{ fontFamily: MONO, whiteSpace: 'nowrap' }}
                onClick={backToMic}
                disabled={disabled}
              >
                Use my mic
              </button>
            ) : (
              <span
                className="y-rec-quiet"
                style={{ fontFamily: MONO, whiteSpace: 'nowrap' }}
              >
                {typed.trim().length}/400
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <div
            ref={cardRef}
            className={`y-rec-card${phase === 'recording' ? ' y-rec-live' : ''}`}
          >
            <button
              type="button"
              className={`y-rec-btn${phase === 'recording' ? ' y-rec-btn-stop' : ''}`}
              onClick={phase === 'recording' ? stop : () => void start()}
              disabled={disabled || phase === 'requesting'}
              aria-label={
                phase === 'recording' ? `Stop recording` : `Record your answer to: ${question}`
              }
            >
              {phase === 'recording' ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <rect x="0" y="0" width="12" height="12" rx="3" fill="currentColor" />
                </svg>
              ) : (
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
              )}
            </button>

            {phase === 'recording' ? (
              <>
                <div className="y-rec-wave" aria-hidden>
                  {Array.from({ length: BAR_COUNT }, (_, i) => (
                    <span
                      key={i}
                      className="y-rec-bar"
                      ref={(node) => {
                        barsRef.current[i] = node;
                      }}
                    />
                  ))}
                </div>
                <span
                  className={`y-rec-time${remaining <= WARN_AT ? ' y-rec-warn' : ''}`}
                  style={{ fontFamily: MONO }}
                >
                  {remaining <= WARN_AT ? `${remaining}s left` : mmss(seconds)}
                </span>
                <div className="y-rec-meter" aria-hidden>
                  <i />
                </div>
              </>
            ) : (
              <span className="y-rec-label">
                {phase === 'requesting' ? 'Waiting for your mic…' : 'Record your answer'}
              </span>
            )}
          </div>

          <div className="y-rec-foot">
            <p className="y-rec-note">
              {notice ??
                (phase === 'recording'
                  ? 'Stop whenever you’re done.'
                  : phase === 'requesting'
                    ? 'Allow the mic in your browser to start.'
                    : `Up to ${maxSeconds} seconds.`)}
            </p>
            {phase === 'idle' || phase === 'requesting' ? (
              <button
                type="button"
                className="y-rec-quiet"
                style={{ fontFamily: MONO, whiteSpace: 'nowrap' }}
                onClick={() => switchToTyping(null, false)}
                disabled={disabled}
              >
                Type instead
              </button>
            ) : null}
          </div>
        </>
      )}

      <span aria-live="polite" className="sr-only">
        {phase === 'recording' ? `Recording, ${seconds} seconds` : ''}
        {phase === 'review' ? 'Answer recorded' : ''}
      </span>
    </div>
  );
}
