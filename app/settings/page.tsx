'use client';

/**
 * Settings — the editable twin of onboarding.
 *
 * Everything Yellow knows about you was, until this screen, write-once: you set
 * it during onboarding and could never see it again. The voice intro was worse —
 * it could only be recorded from inside a connection flow, so anyone who skipped
 * it had no path back and stayed invisible for the wrong reason.
 *
 * Three sections down one completeness rail: **You**, **Your tags**, **Your
 * voice intro**. A node is solid when that part of your record is complete and
 * hollow-and-breathing when it isn't, so the thing you still owe the product is
 * the one thing on the page that moves.
 *
 * Save policy is deliberately split. The profile saves on an explicit press —
 * a half-typed name must never reach the public directory. Voice answers save
 * on completion, because a recording is discrete and already finished.
 *
 * Fail-soft, like the rest of the app: a failed `GET /api/intro` renders the
 * honest "not recorded yet" state rather than an error, a failed save keeps
 * your edits and offers a retry, and a failed S3 upload never loses the take.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import TagEditor, { type TagGroups } from '@/components/TagEditor';
import VoiceNoteBubble, {
  estimateDuration,
  waveSeedFrom,
} from '@/components/VoiceNoteBubble';
import VoiceRecorder, { type VoiceAnswer } from '@/components/VoiceRecorder';
import { resolvePlaybackUrl, uploadClip } from '@/lib/audioClient';
import { setAudioUrl } from '@/lib/audioStore';
import {
  INTRO_KEYS,
  fetchIntro,
  isVoiceClip,
  saveIntro,
  type IntroKey,
  type VoiceClip,
  type VoiceIntro,
} from '@/lib/intro';
import { publishProfile, resolveIdentity } from '@/lib/people';
import { rejectPhoto, uploadPhoto } from '@/lib/photoClient';
import { useAppState } from '@/lib/store';
import type { Profile } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Type stacks — pinned so the column never falls back to a system face */
/* ------------------------------------------------------------------ */

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';
const EMOJI_FACE =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

const MAX_NAME = 40;
const MAX_TAGLINE = 60;
const MAX_BIO = 900;
const MAX_PER_GROUP = 10;

/** Long enough to read, short enough that it never becomes the resting state. */
const SAVED_NOTE_MS = 2600;

/** S3 is a nice-to-have. Give it a moment, then save the intro regardless. */
const UPLOAD_BUDGET_MS = 2500;

/** Must stay in step with `app/onboarding/page.tsx` — the same twelve faces. */
const AVATARS = [
  '🐝',
  '🍋',
  '🌞',
  '🚀',
  '🔥',
  '🪐',
  '☕',
  '🧭',
  '🎧',
  '🦊',
  '🌊',
  '🏔️',
];

const QUESTIONS: { key: IntroKey; label: string }[] = [
  { key: 'who', label: 'Who are you?' },
  { key: 'building', label: 'What are you building?' },
  { key: 'lookingFor', label: 'What are you looking for?' },
];

/**
 * The id an intro clip is stored under. **Must match `clipMessageId` in
 * `app/connect/[id]/page.tsx`** — deriving it the same way on both screens is
 * what lets a clip recorded here play back on the connect screen, and what
 * keeps re-recording from stranding an orphan object in S3.
 */
function clipMessageId(ownerId: string, key: IntroKey): string {
  return `intro-${ownerId}-${key}`;
}

/** A clip with words but no audio was typed; anything else is a recording. */
function clipKind(clip: VoiceClip): 'text' | 'voice' {
  return clip.text && !clip.s3Key ? 'text' : 'voice';
}

/**
 * Drops the presigned `url` before a clip is posted back. It expires in an
 * hour and the row outlives it; the server strips it too, but sending a link
 * we know is dead is not a thing to rely on someone else to clean up.
 */
function forStorage(clip: VoiceClip): VoiceClip {
  const stored: VoiceClip = {
    durationSec: clip.durationSec,
    waveSeed: clip.waveSeed,
  };
  const key = clip.s3Key?.trim();
  const text = clip.text?.trim();
  if (key) stored.s3Key = key;
  if (text) stored.text = text;
  return stored;
}

/**
 * Answers recorded but not yet all three. Kept in this browser only — never
 * published, never sent to `/api/intro` — so recording one question and
 * coming back later doesn't mean recording it again. `isVoiceIntro` still
 * requires all three, so a draft can never be mistaken for the real thing.
 */
const DRAFT_KEY_PREFIX = 'yellow:introDraft:';

function readIntroDraft(ownerId: string): Partial<Record<IntroKey, VoiceClip>> {
  if (!ownerId) return {};
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_PREFIX + ownerId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Partial<Record<IntroKey, VoiceClip>> = {};
    for (const key of INTRO_KEYS) {
      const clip = (parsed as Record<string, unknown>)[key];
      if (isVoiceClip(clip)) out[key] = clip;
    }
    return out;
  } catch {
    return {};
  }
}

function writeIntroDraft(ownerId: string, clips: Partial<Record<IntroKey, VoiceClip>>): void {
  if (!ownerId) return;
  try {
    window.localStorage.setItem(DRAFT_KEY_PREFIX + ownerId, JSON.stringify(clips));
  } catch {
    // Private mode / quota — the draft just doesn't survive a reload.
  }
}

function clearIntroDraft(ownerId: string): void {
  if (!ownerId) return;
  try {
    window.localStorage.removeItem(DRAFT_KEY_PREFIX + ownerId);
  } catch {
    /* nothing to clear */
  }
}

/** Trim, dedupe case-insensitively, cap. Same shape onboarding submits. */
function tidy(tags: string[] | undefined, max: number): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const value = tag.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (out.some((entry) => entry.toLowerCase() === value.toLowerCase())) continue;
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — React hoists and dedupes by `href`.             */
/* ------------------------------------------------------------------ */

function SettingsStyles() {
  return (
    <style href="yellow-settings" precedence="high">{`
/* PhoneFrame owns the scroll container and the horizontal gutters
   (max-w-[560px] + px-5/md:px-8), so this page adds no side padding. Both
   sticky elements resolve against that scroller. */
.ys-root{position:relative;display:block;min-height:100dvh;padding-bottom:10px}

/* --- header rail -------------------------------------------------- */
.ys-rail-top{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:18px 0 14px;position:sticky;top:0;z-index:3;
  /* Glass, not a flat fill: an opaque band reads as a hard rectangle against
     the frame's ambient glow in the desktop gutters. */
  background:linear-gradient(180deg,rgba(11,10,8,.92) 0%,rgba(11,10,8,.74) 55%,rgba(11,10,8,0) 100%);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
}
.ys-mark{display:flex;align-items:center;gap:8px}
.ys-dot{
  width:8px;height:8px;border-radius:999px;background:#FFD60A;flex:none;
  box-shadow:0 0 12px rgba(255,214,10,.85);
}
.ys-mark-text{
  font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;color:#FFF8E7;
}
.ys-tally{
  font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;
  color:rgba(184,134,11,.85);transition:color 420ms ease;flex:none;
  font-variant-numeric:tabular-nums;
}
.ys-tally[data-todo="true"]{color:#FFD60A;text-shadow:0 0 14px rgba(255,214,10,.45)}

/* --- masthead ----------------------------------------------------- */
.ys-h1{
  font-size:clamp(26px,7vw,34px);font-weight:600;letter-spacing:-.038em;
  line-height:1.06;color:#FFF8E7;margin:6px 0 0;text-wrap:balance;
}
.ys-h1 em{font-style:normal;color:#FFD60A}
.ys-lede{
  font-size:14px;line-height:1.55;color:rgba(255,248,231,.5);
  margin:13px 0 0;max-width:36ch;text-wrap:pretty;
}

/* --- the live card: you, as you'll appear in the orbit ------------- */
.ys-card{
  display:flex;align-items:center;gap:14px;margin-top:22px;padding:14px 16px;
  border-radius:22px;border:1px solid rgba(184,134,11,.26);
  background:linear-gradient(180deg,rgba(255,248,231,.05),rgba(255,248,231,.014));
}
.ys-face{
  flex:none;width:58px;height:58px;border-radius:999px;
  display:flex;align-items:center;justify-content:center;font-size:27px;
  box-shadow:0 12px 28px -14px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,255,255,.45);
}
.ys-face span{display:block;animation:ys-pop 380ms cubic-bezier(.22,1,.36,1) backwards}
.ys-card-name{
  margin:0;font-size:18px;font-weight:640;letter-spacing:-.026em;line-height:1.16;
  color:#FFF8E7;overflow-wrap:anywhere;
}
.ys-card-name[data-empty="true"]{color:rgba(255,248,231,.28);font-weight:500}
.ys-card-tag{
  margin:4px 0 0;font-size:12.5px;line-height:1.4;color:rgba(255,248,231,.48);
  overflow-wrap:anywhere;
}
.ys-card-tag[data-empty="true"]{color:rgba(255,248,231,.24)}
.ys-card-live{
  display:flex;align-items:center;gap:6px;margin:8px 0 0;
  font-size:9px;letter-spacing:.16em;text-transform:uppercase;
  color:rgba(184,134,11,.95);
}
.ys-card-live i{
  width:5px;height:5px;border-radius:999px;background:#FFD60A;flex:none;
  animation:ys-pulse 2.6s ease-in-out infinite;
}

/* --- the section dashboard ------------------------------------------ */
/* Three self-contained cards: "You" and "Your tags" side by side on wide
   viewports (Settings is the one page PhoneFrame widens for this), "Your
   voice intro" full-width below since its three recorders need the room.
   Each card carries its own done/todo status dot in its header — there
   used to be one continuous rail connecting all three top to bottom, but
   that only reads correctly in a single column, and two of these three
   sections no longer are one. */
.ys-dash{display:flex;flex-direction:column;gap:22px}
@media (min-width:860px){
  .ys-dash{display:grid;grid-template-columns:1fr 1fr;gap:26px;align-items:start}
}
.ys-sec{
  position:relative;padding:20px 20px 26px;margin-top:22px;
  border-radius:22px;border:1px solid rgba(184,134,11,.2);
  background:linear-gradient(180deg,rgba(255,248,231,.03),rgba(255,248,231,.008));
}
.ys-dash .ys-sec{margin-top:0}
.ys-node{
  flex:none;width:18px;height:18px;border-radius:999px;
  display:flex;align-items:center;justify-content:center;
  border:1px solid rgba(255,248,231,.16);background:rgba(255,248,231,.03);
  transition:border-color 460ms ease,box-shadow 460ms ease;
}
.ys-node i{
  width:8px;height:8px;border-radius:999px;background:transparent;
  transform:scale(.35);
  transition:background 460ms ease,transform 460ms cubic-bezier(.22,1,.36,1);
}
.ys-node[data-state="done"]{
  border-color:rgba(255,214,10,.62);box-shadow:0 0 15px -2px rgba(255,195,0,.7);
}
.ys-node[data-state="done"] i{
  background:linear-gradient(180deg,#FFE45C,#FFC300);transform:scale(1);
}
.ys-node[data-state="todo"]{
  border-color:rgba(255,214,10,.55);
  animation:ys-breathe 2.5s ease-in-out infinite;
}

/* --- section type -------------------------------------------------- */
.ys-label{
  display:flex;align-items:center;gap:10px;margin:0;
  font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:#B8860B;
  font-weight:400;
}
.ys-label::after{
  content:'';flex:1;height:1px;
  background:linear-gradient(90deg,rgba(184,134,11,.4),rgba(184,134,11,0));
}
.ys-why{
  margin:11px 0 0;font-size:12.5px;line-height:1.5;
  color:rgba(255,248,231,.46);max-width:40ch;text-wrap:pretty;
}
.ys-why b{color:rgba(255,248,231,.78);font-weight:600}

/* --- fields -------------------------------------------------------- */
.ys-field{margin-top:16px}
.ys-fieldhead{
  display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  margin-bottom:7px;
}
.ys-fieldname{
  font-size:10px;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(255,248,231,.42);
}
.ys-count{
  font-size:10px;letter-spacing:.1em;color:rgba(184,134,11,.7);
  font-variant-numeric:tabular-nums;flex:none;
}
.ys-input{
  display:block;width:100%;height:46px;padding:0 15px;
  background:rgba(255,248,231,.045);border:1px solid rgba(184,134,11,.3);
  border-radius:14px;color:#FFF8E7;font-size:15.5px;letter-spacing:-.014em;
  font-weight:500;
  transition:border-color 220ms ease,background 220ms ease;
}
.ys-input::placeholder{color:rgba(255,248,231,.26);font-weight:400}
.ys-input:focus{
  outline:none;border-color:rgba(255,214,10,.75);background:rgba(255,214,10,.05);
}

/* Capped so the tiles stay ~56px at every column width rather than ballooning
   into slabs on desktop. Same grid onboarding uses. */
.ys-faces{
  display:grid;grid-template-columns:repeat(6,1fr);gap:9px;max-width:404px;
}
.ys-facebtn{
  aspect-ratio:1;display:flex;align-items:center;justify-content:center;
  border-radius:16px;border:1px solid rgba(184,134,11,.24);background:transparent;
  font-size:clamp(19px,4.4vw,25px);cursor:pointer;
  transition:border-color 200ms ease,background 200ms ease,transform 200ms cubic-bezier(.22,1,.36,1);
  -webkit-tap-highlight-color:transparent;
}
.ys-facebtn:hover{border-color:rgba(255,214,10,.55);transform:translateY(-2px)}
.ys-facebtn:active{transform:scale(.9)}
.ys-facebtn:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
.ys-facebtn[aria-checked="true"]{
  border-color:#FFD60A;background:rgba(255,214,10,.15);
  box-shadow:0 0 0 1px #FFD60A inset,0 0 20px rgba(255,214,10,.3);
  transform:translateY(-2px) scale(1.04);
}
.ys-face-wrap{position:relative;aspect-ratio:1}
.ys-face-wrap .ys-facebtn{width:100%;height:100%;aspect-ratio:auto;font-size:17px;overflow:hidden}
.ys-face-img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.ys-face-clear{
  position:absolute;top:-5px;right:-5px;width:18px;height:18px;padding:0;
  display:flex;align-items:center;justify-content:center;border-radius:999px;cursor:pointer;
  border:1px solid rgba(255,214,10,.5);background:#100E09;color:#FFF8E7;font-size:9px;
  -webkit-tap-highlight-color:transparent;
}
.ys-face-clear:hover{border-color:#FFD60A;color:#FFD60A}
.ys-photo-err{margin:8px 0 0;font-size:11.5px;color:#FFC300}
.ys-textarea{
  display:block;width:100%;min-height:120px;padding:13px 15px;resize:vertical;
  background:rgba(255,248,231,.045);border:1px solid rgba(184,134,11,.3);
  border-radius:14px;color:#FFF8E7;font-size:14.5px;line-height:1.55;letter-spacing:-.008em;
  font-weight:450;font-family:inherit;
  transition:border-color 220ms ease,background 220ms ease;
}
.ys-textarea::placeholder{color:rgba(255,248,231,.26);font-weight:400}
.ys-textarea:focus{
  outline:none;border-color:rgba(255,214,10,.75);background:rgba(255,214,10,.05);
}

/* --- voice intro --------------------------------------------------- */
.ys-gate{
  margin-top:16px;padding:16px 17px;border-radius:20px;
  border:1px solid rgba(255,214,10,.32);
  background:linear-gradient(180deg,rgba(255,214,10,.085),rgba(255,195,0,.02));
  box-shadow:0 0 40px -22px rgba(255,195,0,.95);
}
.ys-gate-eyebrow{
  display:flex;align-items:center;gap:8px;
  font-size:9.5px;letter-spacing:.19em;text-transform:uppercase;color:#FFD60A;
}
.ys-gate-title{
  margin:9px 0 0;font-size:17px;font-weight:650;letter-spacing:-.026em;
  line-height:1.24;color:#FFF8E7;text-wrap:balance;
}
.ys-gate-body{
  margin:8px 0 0;font-size:12.5px;line-height:1.55;
  color:rgba(255,248,231,.58);max-width:42ch;text-wrap:pretty;
}
.ys-quiet-card{
  margin-top:16px;padding:13px 15px;border-radius:18px;
  border:1px solid rgba(255,248,231,.08);background:rgba(255,248,231,.028);
}
.ys-quiet-eyebrow{
  display:flex;align-items:center;gap:8px;
  font-size:9.5px;letter-spacing:.19em;text-transform:uppercase;
  color:rgba(184,134,11,.95);
}
.ys-quiet-body{
  margin:7px 0 0;font-size:12.5px;line-height:1.5;color:rgba(255,248,231,.48);
  max-width:42ch;
}
.ys-q{margin-top:24px;max-width:470px}
.ys-q-head{
  display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  margin-bottom:11px;
}
.ys-q-label{
  margin:0;font-size:15.5px;font-weight:620;letter-spacing:-.022em;
  line-height:1.22;color:#FFF8E7;
}
.ys-ghost{
  border:0;background:none;cursor:pointer;padding:2px 0;flex:none;
  font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;
  color:rgba(255,248,231,.42);
  transition:color 180ms linear;-webkit-tap-highlight-color:transparent;
}
.ys-ghost:hover{color:#FFD60A}
.ys-ghost:focus-visible{outline:2px solid #FFD60A;outline-offset:3px;border-radius:4px}
.ys-ghost:disabled{opacity:.4;cursor:not-allowed}
.ys-answer{display:flex;flex-direction:column;gap:9px}
.ys-cancel{margin-top:9px;display:flex;justify-content:flex-end}

.ys-introsave{
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:26px;
}
.ys-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  height:44px;padding:0 22px;border-radius:999px;border:0;cursor:pointer;flex:none;
  background:linear-gradient(180deg,#FFDE3B,#FFC300);color:#1A1200;
  font-size:14.5px;font-weight:650;letter-spacing:-.014em;
  box-shadow:0 10px 26px -12px rgba(255,195,0,.85),inset 0 1px 0 rgba(255,255,255,.5);
  transition:transform 200ms cubic-bezier(.22,1,.36,1),filter 180ms linear;
  -webkit-tap-highlight-color:transparent;
}
.ys-btn:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.05)}
.ys-btn:active:not(:disabled){transform:scale(.978)}
.ys-btn:focus-visible{outline:2px solid #FFF8E7;outline-offset:3px}
.ys-btn:disabled{
  background:rgba(255,248,231,.07);color:rgba(255,248,231,.3);
  box-shadow:none;cursor:default;
}
.ys-note{
  flex:1 1 150px;min-width:0;margin:0;
  font-size:11.5px;line-height:1.4;color:rgba(255,248,231,.46);
}
.ys-note[data-tone="warn"]{color:#FFC300}
.ys-note[data-tone="good"]{color:rgba(255,214,10,.85)}

/* --- the save bar -------------------------------------------------- */
/* A floating chip rather than a full-width bar: the frame's gutter belongs to
   PhoneFrame, and a bar would need a negative-margin bleed to cover it.
   It pins itself only while there is something to press — a permanent overlay
   would sit on top of the voice section's own save row for no reason. */
.ys-bar{
  position:relative;bottom:0;z-index:4;margin-top:30px;
  display:flex;align-items:center;gap:12px;
  padding:8px 8px 8px 16px;border-radius:999px;
  border:1px solid rgba(255,248,231,.09);
  background:rgba(17,15,11,.88);
  -webkit-backdrop-filter:blur(18px) saturate(1.25);
  backdrop-filter:blur(18px) saturate(1.25);
  box-shadow:0 20px 44px -20px rgba(0,0,0,.98),inset 0 1px 0 rgba(255,248,231,.06);
  transition:border-color 320ms ease,box-shadow 320ms ease;
}
.ys-bar[data-pinned="true"]{position:sticky;bottom:14px}
.ys-bar[data-dirty="true"]{
  border-color:rgba(255,214,10,.34);
  box-shadow:0 20px 44px -20px rgba(0,0,0,.98),
             0 0 30px -14px rgba(255,195,0,.75),
             inset 0 1px 0 rgba(255,248,231,.06);
}
.ys-bar .ys-btn{height:38px;padding:0 18px;font-size:13.5px}

/* --- gate screen --------------------------------------------------- */
.ys-loading{
  display:flex;align-items:center;justify-content:center;min-height:60vh;
  font-size:10px;letter-spacing:.24em;text-transform:uppercase;
  color:rgba(184,134,11,.75);animation:ys-breathe 1.6s ease-in-out infinite;
}

/* --- keyframes ----------------------------------------------------- */
@keyframes ys-pop{
  from{opacity:0;transform:scale(.6) rotate(-12deg)}
  to{opacity:1;transform:scale(1) rotate(0)}
}
@keyframes ys-breathe{0%,100%{opacity:.42}50%{opacity:1}}
@keyframes ys-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.7)}}

@media (prefers-reduced-motion: reduce){
  .ys-face span{animation:none}
  .ys-node[data-state="todo"],.ys-card-live i,.ys-loading{animation:none}
  .ys-facebtn:hover,.ys-btn:hover:not(:disabled),.ys-btn:active:not(:disabled){transform:none}
  .ys-facebtn[aria-checked="true"]{transform:none}
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */
/* Playback links                                                      */
/* ------------------------------------------------------------------ */

/**
 * A playable URL per clip — complete or draft, whichever exists. The
 * in-session object URL wins (instant, no round trip); otherwise the key is
 * presigned once and cached under the same message id the connect screen
 * uses, so a clip is fetched at most once per session.
 */
function useIntroUrls(
  clips: Partial<Record<IntroKey, VoiceClip>>,
  ownerId: string,
): Partial<Record<IntroKey, string>> {
  const [urls, setUrls] = useState<Partial<Record<IntroKey, string>>>({});

  useEffect(() => {
    if (!ownerId) return;
    let active = true;

    void (async () => {
      const found: Partial<Record<IntroKey, string>> = {};
      await Promise.all(
        INTRO_KEYS.map(async (key) => {
          const clip = clips[key];
          if (!clip) return;
          const url =
            (await resolvePlaybackUrl(clipMessageId(ownerId, key), clip.s3Key)) ??
            clip.url;
          if (url) found[key] = url;
        }),
      );
      if (active) setUrls(found);
    })();

    return () => {
      active = false;
    };
  }, [clips, ownerId]);

  return urls;
}

/* ------------------------------------------------------------------ */

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** The editable half of a `Profile`. `id` and `gradient` are not yours to change. */
interface Draft extends TagGroups {
  name: string;
  emoji: string;
  /** `''` means "no photo" — once a draft exists it always carries a real
   *  value for every field, so there is no separate "unset" to track. */
  photoUrl: string;
  tagline: string;
  /** The full write-up from onboarding. `''` means "none written". */
  bio: string;
}

/** Stable identity so a fallback can't hand `TagEditor` a fresh array a frame. */
const EMPTY_TAGS: string[] = [];

export default function SettingsPage() {
  const router = useRouter();
  const { state, setProfile, myId, myIntro, setMyIntro } = useAppState();

  /* -- profile draft ------------------------------------------------ *
   * `null` means "untouched", and every field falls through to the stored
   * profile. Deriving the form rather than copying the store into it on an
   * effect is what keeps the page from flashing an empty form on the frame
   * before hydration lands — and it means a save that lands leaves the draft
   * and the store agreeing, so `dirty` falls back to false on its own.        */

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  /* -- voice intro -------------------------------------------------- */

  const [ownerId, setOwnerId] = useState('');
  const [fetchedIntro, setFetchedIntro] = useState<VoiceIntro | null>(null);
  const [introLoading, setIntroLoading] = useState(true);
  const [answers, setAnswers] = useState<Partial<Record<IntroKey, VoiceAnswer>>>({});
  const [editing, setEditing] = useState<IntroKey[]>([]);
  const [introState, setIntroState] = useState<SaveState>('idle');
  const [introError, setIntroError] = useState('');
  /** Answers saved locally before all three existed. See `readIntroDraft`. */
  const [draftClips, setDraftClips] = useState<Partial<Record<IntroKey, VoiceClip>>>({});

  /* The store fetches my intro once on mount too. Falling through to it means
     a slow — or failed — read here never shows "not recorded yet" to someone
     who has. A real answer from our own fetch always wins. */
  const intro = fetchedIntro ?? myIntro;

  /* What's actually recorded right now, complete or not — the single source
     the questions below render from. A complete `intro` always wins per key;
     a lingering draft can't un-answer a question the server already has. */
  const clipsForPlayback = useMemo<Partial<Record<IntroKey, VoiceClip>>>(
    () => ({ ...draftClips, ...(intro ?? {}) }),
    [draftClips, intro],
  );

  const introUrls = useIntroUrls(clipsForPlayback, ownerId);

  const stored = state.me;
  const view: Draft = {
    name: draft?.name ?? stored?.name ?? '',
    emoji: draft?.emoji ?? stored?.emoji ?? AVATARS[0],
    photoUrl: draft?.photoUrl ?? stored?.photoUrl ?? '',
    tagline: draft?.tagline ?? stored?.tagline ?? '',
    bio: draft?.bio ?? stored?.bio ?? '',
    softSkills: draft?.softSkills ?? stored?.softSkills ?? EMPTY_TAGS,
    interests: draft?.interests ?? stored?.interests ?? EMPTY_TAGS,
  };

  /* -- nobody edits a profile they never created --------------------- */

  const needsOnboarding = state.hydrated && !state.me;
  useEffect(() => {
    if (needsOnboarding) router.replace('/onboarding');
  }, [needsOnboarding, router]);

  /* -- identity, then my own intro ----------------------------------- */

  /* One effect owns everything that hangs off the id, rather than a second one
     racing `ownerId` into existence. The draft is per-owner, so it is read in
     the same breath as the owner it belongs to. */
  useEffect(() => {
    let active = true;
    void (async () => {
      const id = myId ?? (await resolveIdentity());
      if (!active || !id) return;
      setOwnerId(id);
      // Answers recorded on an earlier visit but never completed.
      setDraftClips(readIntroDraft(id));
    })();
    return () => {
      active = false;
    };
  }, [myId]);

  useEffect(() => {
    if (!ownerId) return;
    let active = true;

    void (async () => {
      // `fetchIntro` never throws: null means "hasn't recorded" *and* "couldn't
      // find out". Only a real answer replaces what we already have.
      const found = await fetchIntro(ownerId);
      if (!active) return;
      if (found) {
        setFetchedIntro(found);
        // A complete intro on the server makes the local draft redundant — and
        // a stale one, if it was recorded on another device.
        clearIntroDraft(ownerId);
        setDraftClips({});
      }
      setIntroLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [ownerId]);

  /* -- transient "Saved" notes clear themselves ---------------------- */

  useEffect(() => {
    if (saveState !== 'saved') return;
    const id = window.setTimeout(() => setSaveState('idle'), SAVED_NOTE_MS);
    return () => window.clearTimeout(id);
  }, [saveState]);

  useEffect(() => {
    if (introState !== 'saved') return;
    const id = window.setTimeout(() => setIntroState('idle'), SAVED_NOTE_MS);
    return () => window.clearTimeout(id);
  }, [introState]);

  /* -- derived ------------------------------------------------------- */

  const trimmedName = view.name.trim();
  const trimmedTagline = view.tagline.trim();
  const trimmedBio = view.bio.trim();

  /* Cheap enough to recompute — the React compiler memoizes what it needs, and
     hand-rolled `useMemo` over a derived object it can't prove stable only
     defeats that. */
  const dirty = stored
    ? trimmedName !== stored.name ||
      view.emoji !== stored.emoji ||
      view.photoUrl !== (stored.photoUrl ?? '') ||
      trimmedTagline !== stored.tagline ||
      trimmedBio !== (stored.bio ?? '') ||
      !sameList(view.softSkills, stored.softSkills) ||
      !sameList(view.interests, stored.interests)
    : false;

  const blocker =
    trimmedName.length === 0
      ? 'Add a name so people know who they met.'
      : trimmedTagline.length === 0
        ? 'Add a line about what you’re building.'
        : view.softSkills.length === 0
          ? 'Keep at least one soft skill.'
          : view.interests.length === 0
            ? 'Keep at least one interest.'
            : '';

  const saving = saveState === 'saving';
  // A failed save leaves the local store already updated, so `dirty` is false —
  // the retry has to stay pressable on its own account.
  const canSave = blocker === '' && !saving && (dirty || saveState === 'failed');

  const introDirty = INTRO_KEYS.some((key) => Boolean(answers[key]));
  const introReady = INTRO_KEYS.every((key) => Boolean(answers[key] || clipsForPlayback[key]));
  const savingIntro = introState === 'saving';
  const answeredCount = INTRO_KEYS.filter((key) =>
    Boolean(answers[key] || clipsForPlayback[key]),
  ).length;

  const profileDone = trimmedName.length > 0 && trimmedTagline.length > 0;
  const tagsDone = view.softSkills.length > 0 && view.interests.length > 0;
  const voiceDone = intro !== null;
  const doneCount = [profileDone, tagsDone, voiceDone].filter(Boolean).length;

  /* -- photo upload ---------------------------------------------------- */

  const handlePhotoFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const rejection = rejectPhoto(file);
      if (rejection) {
        setPhotoError(rejection === 'type' ? 'That file isn’t an image.' : 'Keep it under 8MB.');
        return;
      }
      setPhotoError('');
      setPhotoBusy(true);
      const id = myId ?? (await resolveIdentity());
      const url = await uploadPhoto(id, file);
      setPhotoBusy(false);
      if (url) setDraft({ ...view, photoUrl: url });
      else setPhotoError('Couldn’t upload that — try again.');
    },
    [myId, view],
  );

  /* -- save the profile ---------------------------------------------- */

  async function handleSave() {
    if (!stored || blocker !== '' || saveState === 'saving') return;
    if (!dirty && saveState !== 'failed') return;

    setSaveState('saving');

    const next: Profile = {
      ...stored,
      name: trimmedName.slice(0, MAX_NAME),
      emoji: view.emoji || stored.emoji,
      photoUrl: view.photoUrl || undefined,
      tagline: trimmedTagline.slice(0, MAX_TAGLINE),
      bio: trimmedBio.slice(0, MAX_BIO) || undefined,
      softSkills: tidy(view.softSkills, MAX_PER_GROUP),
      interests: tidy(view.interests, MAX_PER_GROUP),
    };

    // Local store + this account's `yellow-app` row, and a fire-and-forget
    // directory publish. On a retry the local write has already landed.
    if (dirty) setProfile(next);

    // The `yellow-users` row is what everyone else reads — and it is what the
    // matcher scores — so it is the write worth reporting on. `setProfile`
    // swallows its result, so publish once more, awaited. `POST /api/people`
    // is an idempotent `UpdateCommand` touching only `profile`, so the second
    // write costs a few milliseconds and cannot disturb the `voiceIntro`
    // sitting on the same row.
    const id = myId ?? (await resolveIdentity());
    const ok = await publishProfile({ ...next, id }, id);

    setSaveState(ok ? 'saved' : 'failed');
  }

  /* -- save the intro ------------------------------------------------ */

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

  const handleSaveIntro = useCallback(async () => {
    if (!introDirty || introState === 'saving') return;
    setIntroState('saving');
    setIntroError('');

    const me = ownerId || (await resolveIdentity());
    const clips: Partial<Record<IntroKey, VoiceClip>> = {};
    const uploads: Promise<void>[] = [];

    for (const key of INTRO_KEYS) {
      const answer = answers[key];

      if (!answer) {
        const kept = clipsForPlayback[key];
        if (kept) clips[key] = forStorage(kept);
        continue;
      }

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
      // Playback comes from this object URL whether or not S3 ever answers.
      setAudioUrl(messageId, answer.url);
      uploads.push(
        uploadClip(me, messageId, answer.blob).then((s3Key) => {
          if (s3Key) clip.s3Key = s3Key;
        }),
      );
      clips[key] = clip;
    }

    await Promise.race([
      Promise.allSettled(uploads),
      new Promise((resolve) => setTimeout(resolve, UPLOAD_BUDGET_MS)),
    ]);

    // A recording that never reached S3 has no audio *and* no words, which is
    // exactly the shape the intro validator rejects. Say so plainly rather
    // than letting the save fail for a reason nobody could guess.
    const orphaned = INTRO_KEYS.some((key) => {
      const clip = clips[key];
      return clip && !clip.s3Key && !clip.text;
    });
    if (orphaned) {
      setIntroState('failed');
      setIntroError(
        'Your recording couldn’t reach storage. It’s still here — try saving again.',
      );
      return;
    }

    const { who, building, lookingFor } = clips;

    if (who && building && lookingFor) {
      // All three exist — this is a real, publishable intro.
      const next: VoiceIntro = { who, building, lookingFor, recordedAt: Date.now() };
      const ok = await saveIntro(next, me);

      if (!ok) {
        // The takes stay in hand; nothing is lost by pressing again.
        setIntroState('failed');
        setIntroError('Couldn’t save your intro. Your recordings are still here — try again.');
        return;
      }

      setFetchedIntro(next);
      // Keep the connect screen from offering three empty recorders to someone
      // who just recorded here.
      setMyIntro(next);
      // The published intro supersedes the local draft in every respect.
      clearIntroDraft(me);
      setDraftClips({});
    } else {
      // Fewer than three answered. Not publishable — the connect gate still
      // needs all three from both sides — but the takes are yours to keep.
      writeIntroDraft(me, clips);
      setDraftClips(clips);
    }

    setAnswers({});
    setEditing([]);
    setIntroState('saved');
  }, [introDirty, introState, ownerId, answers, clipsForPlayback, setMyIntro]);

  /* -- gates ---------------------------------------------------------- */

  if (!state.hydrated) {
    return (
      <div className="ys-root" style={{ fontFamily: SANS }}>
        <SettingsStyles />
        <p className="ys-loading" style={{ fontFamily: MONO }}>
          Loading your settings
        </p>
      </div>
    );
  }

  if (!stored) {
    return (
      <div className="ys-root" style={{ fontFamily: SANS }}>
        <SettingsStyles />
        <p className="ys-loading" style={{ fontFamily: MONO }}>
          Taking you to onboarding
        </p>
      </div>
    );
  }

  /* -- copy for the save bar ------------------------------------------ */

  const barNote =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'failed'
        ? 'Couldn’t reach the directory. Your changes are still here — try again.'
        : blocker !== ''
          ? blocker
          : dirty
            ? 'You have unsaved changes.'
            : saveState === 'saved'
              ? 'Saved. This is what everyone sees now.'
              : 'Up to date.';

  const barTone =
    saveState === 'failed' || (blocker !== '' && dirty)
      ? 'warn'
      : saveState === 'saved'
        ? 'good'
        : 'plain';

  const introNote =
    introState === 'saving'
      ? 'Saving your intro…'
      : introState === 'failed'
        ? introError
        : introState === 'saved'
          ? voiceDone
            ? 'Saved. Anyone who connects with you hears this.'
            : 'Saved on this device. Finish all three to go live for others.'
          : introReady
            ? 'All three answered.'
            : `${answeredCount} of 3 answered.`;

  const introTone =
    introState === 'failed' ? 'warn' : introState === 'saved' ? 'good' : 'plain';

  const recordedOn = intro
    ? new Date(intro.recordedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : '';

  return (
    <div className="ys-root" style={{ fontFamily: SANS }}>
      <SettingsStyles />

      <header className="ys-rail-top">
        <span className="ys-mark">
          <span className="ys-dot" aria-hidden="true" />
          <span className="ys-mark-text" style={{ fontFamily: MONO }}>
            Settings
          </span>
        </span>
        <span
          className="ys-tally"
          style={{ fontFamily: MONO }}
          data-todo={!introLoading && doneCount < 3}
          role="status"
          aria-live="polite"
        >
          {introLoading
            ? 'Checking'
            : doneCount === 3
              ? 'All set'
              : `${doneCount} of 3 done`}
        </span>
      </header>

      <h1 className="ys-h1">
        Everything you told <em>Yellow</em>.
      </h1>
      <p className="ys-lede">
        Change any of it. Your bubble, and who you match with, update the moment
        you save.
      </p>

      {/* The hero is you as you appear in everyone else's orbit — the same
          object that floats in the bubble map, redrawn as you type. */}
      <div className="ys-card">
        <span
          className="ys-face"
          aria-hidden="true"
          style={{
            fontFamily: EMOJI_FACE,
            backgroundImage: `radial-gradient(circle at 34% 26%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 48%), linear-gradient(150deg, ${stored.gradient[0]}, ${stored.gradient[1]})`,
          }}
        >
          <span key={view.emoji}>{view.emoji}</span>
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="ys-card-name" data-empty={trimmedName.length === 0}>
            {trimmedName || 'Your name'}
          </p>
          <p className="ys-card-tag" data-empty={trimmedTagline.length === 0}>
            {trimmedTagline || 'A line about what you’re building'}
          </p>
          <p className="ys-card-live" style={{ fontFamily: MONO }}>
            <i aria-hidden="true" />
            Live in the directory
          </p>
        </div>
      </div>

      <div style={{ height: 30 }} aria-hidden="true" />

      <div className="ys-dash">
        {/* ---------------- 1 · You ---------------- */}
        <section className="ys-sec">
          <h2 className="ys-label" style={{ fontFamily: MONO }}>
            <span
              className="ys-node"
              data-state={profileDone ? 'done' : 'todo'}
              aria-hidden="true"
            >
              <i />
            </span>
            You
          </h2>

          <div className="ys-field">
            <div className="ys-fieldhead">
              <label
                className="ys-fieldname"
                htmlFor="ys-name"
                style={{ fontFamily: MONO }}
              >
                Name
              </label>
              <span className="ys-count" style={{ fontFamily: MONO }}>
                {view.name.length}/{MAX_NAME}
              </span>
            </div>
            <input
              id="ys-name"
              className="ys-input"
              type="text"
              value={view.name}
              maxLength={MAX_NAME}
              placeholder="What should people call you?"
              autoComplete="name"
              onChange={(event) => setDraft({ ...view, name: event.target.value })}
            />
          </div>

          <div className="ys-field">
            <div className="ys-fieldhead">
              <span className="ys-fieldname" style={{ fontFamily: MONO }} id="ys-face-label">
                Avatar
              </span>
            </div>
            <div className="ys-faces" role="radiogroup" aria-labelledby="ys-face-label">
              {AVATARS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={!view.photoUrl && view.emoji === option}
                  aria-label={`Avatar ${option}`}
                  className="ys-facebtn"
                  style={{ fontFamily: EMOJI_FACE }}
                  onClick={() => setDraft({ ...view, emoji: option, photoUrl: '' })}
                >
                  {option}
                </button>
              ))}

              <div className="ys-face-wrap">
                <button
                  type="button"
                  role="radio"
                  aria-checked={Boolean(view.photoUrl)}
                  aria-label={view.photoUrl ? 'Your photo. Tap to replace.' : 'Upload a photo'}
                  className="ys-facebtn"
                  disabled={photoBusy}
                  onClick={() => photoInputRef.current?.click()}
                >
                  {view.photoUrl ? (
                    <img src={view.photoUrl} alt="" className="ys-face-img" />
                  ) : photoBusy ? (
                    '…'
                  ) : (
                    '📷'
                  )}
                </button>
                {view.photoUrl ? (
                  <button
                    type="button"
                    className="ys-face-clear"
                    aria-label="Remove photo"
                    onClick={() => setDraft({ ...view, photoUrl: '' })}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              style={srOnly}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                void handlePhotoFile(file);
                event.target.value = '';
              }}
            />
            {photoError ? <p className="ys-photo-err">{photoError}</p> : null}
          </div>

          <div className="ys-field">
            <div className="ys-fieldhead">
              <label
                className="ys-fieldname"
                htmlFor="ys-tagline"
                style={{ fontFamily: MONO }}
              >
                Tagline
              </label>
              <span className="ys-count" style={{ fontFamily: MONO }}>
                {view.tagline.length}/{MAX_TAGLINE}
              </span>
            </div>
            <input
              id="ys-tagline"
              className="ys-input"
              type="text"
              value={view.tagline}
              maxLength={MAX_TAGLINE}
              placeholder="The one line under your bubble"
              onChange={(event) => setDraft({ ...view, tagline: event.target.value })}
            />
          </div>
        </section>

        {/* ---------------- 2 · Your tags ---------------- */}
        <section className="ys-sec">
          <h2 className="ys-label" style={{ fontFamily: MONO }}>
            <span
              className="ys-node"
              data-state={tagsDone ? 'done' : 'todo'}
              aria-hidden="true"
            >
              <i />
            </span>
            Your tags
          </h2>
          <p className="ys-why">
            <b>This is what your matches are computed from.</b> Everyone in your
            bubble map is placed by how much of this you share — bigger and closer
            means more overlap. Soft skills count double.
          </p>

          <div style={{ marginTop: 20 }}>
            <TagEditor
              softSkills={view.softSkills}
              interests={view.interests}
              onChange={(next) => setDraft({ ...view, ...next })}
              maxPerGroup={MAX_PER_GROUP}
            />
          </div>
        </section>
      </div>

      {/* ---------------- 3 · Your voice intro ---------------- */}
      <section className="ys-sec">
        <h2 className="ys-label" style={{ fontFamily: MONO }}>
          <span
            className="ys-node"
            data-state={introLoading ? 'idle' : voiceDone ? 'done' : 'todo'}
            aria-hidden="true"
          >
            <i />
          </span>
          Your voice intro
        </h2>

        {introLoading ? (
          <div className="ys-quiet-card">
            <span className="ys-quiet-eyebrow" style={{ fontFamily: MONO }}>
              Checking
            </span>
            <p className="ys-quiet-body">Looking for a recording on your account.</p>
          </div>
        ) : intro ? (
          <div className="ys-quiet-card">
            <span className="ys-quiet-eyebrow" style={{ fontFamily: MONO }}>
              Recorded {recordedOn}
            </span>
            <p className="ys-quiet-body">
              Everyone who connects with you hears these three answers. Re-record
              any of them — the new take replaces the old one everywhere.
            </p>
          </div>
        ) : answeredCount > 0 ? (
          <div className="ys-quiet-card">
            <span className="ys-quiet-eyebrow" style={{ fontFamily: MONO }}>
              In progress
            </span>
            <p className="ys-quiet-body">
              {answeredCount} of 3 saved on this device. Nobody can connect with you
              until all three are answered — finish whenever you&rsquo;re ready.
            </p>
          </div>
        ) : (
          <div className="ys-gate">
            <span className="ys-gate-eyebrow" style={{ fontFamily: MONO }}>
              Not recorded yet
            </span>
            <h3 className="ys-gate-title">Nobody can connect with you yet.</h3>
            <p className="ys-gate-body">
              Yellow opens a chat only when both people have answered these three
              out loud. Until you record yours, you&rsquo;re on the map but no one
              can reach you. It takes about a minute — or type your answers if the
              mic isn&rsquo;t an option. Answer one now and finish the rest later —
              nothing is lost in between.
            </p>
          </div>
        )}

        {QUESTIONS.map((question) => {
          const stored = clipsForPlayback[question.key];
          const isEditing = editing.includes(question.key);
          const showRecorder = introLoading ? false : !stored || isEditing;

          return (
            <div className="ys-q" key={question.key}>
              <div className="ys-q-head">
                <h3 className="ys-q-label">{question.label}</h3>
                {stored && !isEditing ? (
                  <button
                    type="button"
                    className="ys-ghost"
                    style={{ fontFamily: MONO }}
                    disabled={savingIntro}
                    onClick={() => setEditing((current) => [...current, question.key])}
                  >
                    Re-record
                  </button>
                ) : null}
              </div>

              {showRecorder ? (
                <>
                  <VoiceRecorder
                    id={`me-${question.key}`}
                    question={question.label}
                    disabled={savingIntro}
                    onChange={(answer) => setAnswer(question.key, answer)}
                  />
                  {stored && isEditing ? (
                    <div className="ys-cancel">
                      <button
                        type="button"
                        className="ys-ghost"
                        style={{ fontFamily: MONO }}
                        disabled={savingIntro}
                        onClick={() => {
                          setEditing((current) =>
                            current.filter((key) => key !== question.key),
                          );
                          setAnswer(question.key, null);
                        }}
                      >
                        Keep the one I had
                      </button>
                    </div>
                  ) : null}
                </>
              ) : stored ? (
                <div className="ys-answer">
                  <VoiceNoteBubble
                    side="me"
                    kind={clipKind(stored)}
                    text={stored.text}
                    durationSec={stored.durationSec}
                    waveSeed={stored.waveSeed}
                    audioUrl={introUrls[question.key] ?? null}
                  />
                </div>
              ) : null}
            </div>
          );
        })}

        {!introLoading && (introDirty || !intro) ? (
          <div className="ys-introsave">
            <button
              type="button"
              className="ys-btn"
              disabled={!introDirty || savingIntro}
              onClick={() => void handleSaveIntro()}
            >
              {savingIntro
                ? 'Saving…'
                : introState === 'failed'
                  ? 'Try again'
                  : introReady
                    ? 'Save my intro'
                    : 'Save what I have'}
            </button>
            <p className="ys-note" data-tone={introTone} role="status" aria-live="polite">
              {introNote}
            </p>
          </div>
        ) : null}
      </section>

      {/* ---------------- save ---------------- */}
      {/* Pinned only while it is worth pressing — see `.ys-bar` above. */}
      <div
        className="ys-bar"
        data-dirty={dirty && blocker === ''}
        data-pinned={dirty || saveState !== 'idle'}
      >
        <p className="ys-note" data-tone={barTone} role="status" aria-live="polite">
          {barNote}
        </p>
        <button
          type="button"
          className="ys-btn"
          disabled={!canSave}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : saveState === 'failed' ? 'Try again' : 'Save changes'}
        </button>
      </div>

      <p style={srOnly} role="status" aria-live="polite">
        {saveState === 'saved' ? 'Profile saved.' : ''}
        {introState === 'saved' ? 'Voice intro saved.' : ''}
      </p>
    </div>
  );
}
