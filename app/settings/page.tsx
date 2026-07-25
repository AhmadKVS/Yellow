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
import { initialsFor } from '@/lib/initials';
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

const MAX_NAME = 40;
const MAX_TAGLINE = 60;
const MAX_BIO = 900;
const MAX_PER_GROUP = 10;

/** Long enough to read, short enough that it never becomes the resting state. */
const SAVED_NOTE_MS = 2600;

/** S3 is a nice-to-have. Give it a moment, then save the intro regardless. */
const UPLOAD_BUDGET_MS = 2500;

/**
 * Avatars are a photo or an initials monogram now — nobody picks an emoji any
 * more. `Profile.emoji` is still part of the frozen contract, so every save
 * keeps carrying a value for readers that expect one; this is just the value
 * used when a profile somehow reaches this screen without one.
 */
const DEFAULT_EMOJI = '🐝';

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
/* Chrome icons — inline SVG, stroke 1.8, round caps. Never emoji.     */
/* (Emoji on this screen are avatars, which is content, not chrome.)   */
/* ------------------------------------------------------------------ */

const stroked = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};

function IconCamera({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M4 8.5h2.6l1.3-2h8.2l1.3 2H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
        {...stroked}
      />
      <circle cx="12" cy="13.4" r="3.1" {...stroked} />
    </svg>
  );
}

/**
 * Apple Contacts monogram — one letter reads bigger than two. The letters sit
 * on whatever disc material the caller already painted; this only draws type.
 */
function Monogram({ name, size }: { name: string; size: number }) {
  const letters = initialsFor(name);
  return (
    <span
      style={{
        fontFamily: SANS,
        fontSize: Math.round(size * (letters.length > 1 ? 0.32 : 0.4)),
        fontWeight: 600,
        letterSpacing: '0.02em',
        lineHeight: 1,
        color: '#FFF8E7',
        textShadow: '0 1px 3px rgba(0,0,0,.35)',
      }}
    >
      {letters}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — React hoists and dedupes by `href`.             */
/* ------------------------------------------------------------------ */

function SettingsStyles() {
  return (
    <style href="yellow-settings" precedence="high">{`
/* PhoneFrame owns the scroll container and the horizontal gutters
   (max-w-[1040px] + px-5/md:px-8), so this page adds no side padding. Both
   sticky elements resolve against that scroller. */
.ys-root{position:relative;display:block;min-height:100dvh;padding-bottom:12px}

/* --- header rail: glass, and only where it floats ----------------- */
.ys-rail-top{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:16px 0 14px;position:sticky;top:0;z-index:3;
  /* Chrome glass. The mask fades the material out with the scrim so it has
     no hard bottom edge against the frame's ambient glow in the gutters. */
  background:linear-gradient(180deg,rgba(20,17,10,.86) 0%,rgba(20,17,10,.62) 58%,rgba(20,17,10,0) 100%);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);
  -webkit-mask-image:linear-gradient(180deg,#000 0%,#000 76%,transparent 100%);
  mask-image:linear-gradient(180deg,#000 0%,#000 76%,transparent 100%);
}
.ys-mark{display:flex;align-items:center;gap:9px}
.ys-dot{
  width:7px;height:7px;border-radius:999px;background:#FFD60A;flex:none;
  box-shadow:0 0 12px rgba(255,214,10,.8);
}
.ys-mark-text{
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(255,248,231,.72);
}
.ys-tally{
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(184,134,11,.95);transition:color 420ms ease;flex:none;
  font-variant-numeric:tabular-nums;
}
.ys-tally[data-todo="true"]{color:#FFD60A}

/* --- masthead ----------------------------------------------------- */
.ys-h1{
  font-size:30px;font-weight:700;letter-spacing:-.03em;
  line-height:1.08;color:#FFF8E7;margin:10px 0 0;text-wrap:balance;
}
@media (min-width:520px){ .ys-h1{font-size:34px} }
.ys-h1 em{font-style:normal;color:#FFD60A}
.ys-lede{
  font-size:15px;line-height:1.5;letter-spacing:-.006em;
  color:rgba(255,248,231,.62);margin:12px 0 0;max-width:38ch;text-wrap:pretty;
}

/* --- the live card: you, as you'll appear in the orbit ------------- */
.ys-card{
  display:flex;align-items:center;gap:15px;margin-top:24px;padding:16px;
  border-radius:22px;border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.045);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 10px 30px -12px rgba(0,0,0,.6);
}
.ys-face{
  flex:none;width:60px;height:60px;border-radius:999px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;
  box-shadow:inset 0 1px 1px rgba(255,255,255,.34),
             inset 0 0 0 1px rgba(255,214,10,.14),
             0 10px 24px -12px rgba(0,0,0,.9);
}
.ys-face-photo{width:100%;height:100%;object-fit:cover}
.ys-face span{display:block;animation:ys-pop 380ms cubic-bezier(.32,.72,0,1) backwards}
.ys-card-name{
  margin:0;font-size:21px;font-weight:600;letter-spacing:-.02em;line-height:1.18;
  color:#FFF8E7;overflow-wrap:anywhere;
}
.ys-card-name[data-empty="true"]{color:rgba(255,248,231,.26);font-weight:500}
.ys-card-tag{
  margin:4px 0 0;font-size:13.5px;line-height:1.4;color:rgba(255,248,231,.5);
  overflow-wrap:anywhere;
}
.ys-card-tag[data-empty="true"]{color:rgba(255,248,231,.26)}
.ys-card-live{
  display:flex;align-items:center;gap:7px;margin:9px 0 0;
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
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
  .ys-dash{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
}
.ys-sec{
  position:relative;padding:20px 20px 24px;margin-top:22px;
  border-radius:22px;border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.045);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 10px 30px -12px rgba(0,0,0,.6);
}
.ys-dash .ys-sec{margin-top:0}
.ys-node{
  flex:none;width:16px;height:16px;border-radius:999px;
  display:flex;align-items:center;justify-content:center;
  border:1px solid rgba(255,255,255,.16);background:transparent;
  transition:border-color 460ms ease;
}
.ys-node i{
  width:7px;height:7px;border-radius:999px;background:transparent;
  transform:scale(.3);
  transition:background 460ms ease,transform 460ms cubic-bezier(.32,.72,0,1);
}
.ys-node[data-state="done"]{border-color:rgba(255,214,10,.5)}
.ys-node[data-state="done"] i{
  background:linear-gradient(180deg,#FFE45C,#FFC300);transform:scale(1);
}
.ys-node[data-state="todo"]{
  border-color:rgba(255,214,10,.45);
  animation:ys-breathe 2.6s ease-in-out infinite;
}

/* --- section type -------------------------------------------------- */
.ys-label{
  display:flex;align-items:center;gap:10px;margin:0;
  font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(184,134,11,.95);font-weight:500;
}
.ys-label::after{
  content:'';flex:1;height:1px;
  background:linear-gradient(90deg,rgba(255,255,255,.1),rgba(255,255,255,0));
}
.ys-why{
  margin:12px 0 0;font-size:12.5px;line-height:1.5;
  color:rgba(255,248,231,.4);max-width:40ch;text-wrap:pretty;
}
.ys-why b{color:rgba(255,248,231,.74);font-weight:600}

/* --- fields -------------------------------------------------------- */
.ys-field{margin-top:18px}
.ys-fieldhead{
  display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  margin-bottom:8px;
}
.ys-fieldname{
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(255,248,231,.4);
}
.ys-count{
  font-size:10.5px;letter-spacing:.06em;color:rgba(184,134,11,.9);
  font-variant-numeric:tabular-nums;flex:none;
}
.ys-input{
  display:block;width:100%;height:48px;padding:0 15px;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);
  border-radius:14px;color:#FFF8E7;font-size:15px;letter-spacing:-.008em;
  font-weight:450;
  transition:border-color 220ms ease,background 220ms ease;
}
.ys-input::placeholder{color:rgba(255,248,231,.26);font-weight:400}
.ys-input:focus{
  outline:none;border-color:rgba(255,214,10,.5);background:rgba(255,214,10,.045);
}

/* --- the photo field ----------------------------------------------- */
/* Nobody picks an emoji any more: an avatar is your photo, or the initials
   that stand in until there is one. iOS Contacts, not a sticker sheet. */
.ys-photo-row{display:flex;align-items:center;gap:16px}
.ys-photo-btn{
  position:relative;flex:none;width:76px;height:76px;border-radius:999px;padding:0;
  display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;
  border:1px solid rgba(255,255,255,.14);
  box-shadow:inset 0 1px 1px rgba(255,255,255,.3),
             inset 0 0 0 1px rgba(255,214,10,.12),
             0 10px 24px -14px rgba(0,0,0,.9);
  transition:transform 120ms cubic-bezier(.32,.72,0,1),box-shadow 200ms ease;
  -webkit-tap-highlight-color:transparent;
}
.ys-photo-btn:hover:not(:disabled){box-shadow:inset 0 1px 1px rgba(255,255,255,.3),
             inset 0 0 0 1px rgba(255,214,10,.3),0 10px 24px -14px rgba(0,0,0,.9)}
.ys-photo-btn:active:not(:disabled){transform:scale(.96)}
.ys-photo-btn:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
.ys-photo-btn:disabled{cursor:default;opacity:.6}
.ys-photo-veil{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:rgba(255,248,231,.9);background:rgba(0,0,0,.34);opacity:0;
  transition:opacity 200ms ease;
}
.ys-photo-btn:hover .ys-photo-veil,
.ys-photo-btn:focus-visible .ys-photo-veil{opacity:1}
.ys-face-img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.ys-photo-acts{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0}
.ys-photo-err{margin:9px 0 0;font-size:12.5px;color:#FFC300}
.ys-hint{margin:10px 0 0;font-size:12.5px;line-height:1.45;color:rgba(255,248,231,.4)}
.ys-textarea{
  display:block;width:100%;min-height:120px;padding:13px 15px;resize:vertical;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);
  border-radius:14px;color:#FFF8E7;font-size:15px;line-height:1.5;letter-spacing:-.006em;
  font-weight:400;font-family:inherit;
  transition:border-color 220ms ease,background 220ms ease;
}
.ys-textarea::placeholder{color:rgba(255,248,231,.26);font-weight:400}
.ys-textarea:focus{
  outline:none;border-color:rgba(255,214,10,.5);background:rgba(255,214,10,.045);
}

/* --- voice intro --------------------------------------------------- */
/* The one thing you still owe the product. Yellow glass, not a glow:
   urgency comes from the material being there at all, next to two cards
   that are plain surface. */
.ys-gate{
  margin-top:16px;padding:16px 17px;border-radius:18px;
  background:linear-gradient(0deg,rgba(255,214,10,.13),rgba(255,214,10,.13)),
             rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);
  backdrop-filter:blur(18px) saturate(1.6);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22);
}
.ys-gate-eyebrow{
  display:flex;align-items:center;gap:8px;
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:#FFD60A;
}
.ys-gate-eyebrow i{
  width:5px;height:5px;border-radius:999px;background:#FFD60A;flex:none;
  animation:ys-pulse 2.6s ease-in-out infinite;
}
.ys-gate-title{
  margin:10px 0 0;font-size:16.5px;font-weight:600;letter-spacing:-.018em;
  line-height:1.28;color:#FFF8E7;text-wrap:balance;
}
.ys-gate-body{
  margin:9px 0 0;font-size:13.5px;line-height:1.5;
  color:rgba(255,248,231,.62);max-width:44ch;text-wrap:pretty;
}
.ys-quiet-card{
  margin-top:16px;padding:14px 15px;border-radius:18px;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);
}
.ys-quiet-eyebrow{
  display:flex;align-items:center;gap:8px;
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(184,134,11,.95);
}
.ys-quiet-body{
  margin:8px 0 0;font-size:13.5px;line-height:1.5;color:rgba(255,248,231,.5);
  max-width:44ch;
}
/* One reading column for the whole voice section: the status card, the three
   questions and the save row all share an edge on wide viewports. */
.ys-gate,.ys-quiet-card,.ys-q,.ys-introsave{max-width:560px}
.ys-q{margin-top:26px}
.ys-q-head{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  min-height:32px;margin-bottom:11px;
}
.ys-q-label{
  margin:0;font-size:16.5px;font-weight:600;letter-spacing:-.016em;
  line-height:1.28;color:#FFF8E7;
}

/* Pills: tinted is the secondary action, quiet is tertiary. Nothing here is
   filled — the screen's one filled control lives in the save bar. */
.ys-pill{
  position:relative;display:inline-flex;align-items:center;justify-content:center;
  gap:6px;height:32px;padding:0 14px;border-radius:999px;
  cursor:pointer;flex:none;white-space:nowrap;
  font-size:12.5px;font-weight:600;letter-spacing:-.008em;
  color:#FFD60A;
  background:linear-gradient(0deg,rgba(255,214,10,.13),rgba(255,214,10,.13)),
             rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);
  backdrop-filter:blur(18px) saturate(1.6);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22);
  transition:background 200ms linear,border-color 200ms linear,
             color 200ms linear,transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
.ys-pill::after{content:'';position:absolute;inset:-6px;border-radius:inherit}
.ys-pill:hover:not(:disabled){
  background:linear-gradient(0deg,rgba(255,214,10,.19),rgba(255,214,10,.19)),
             rgba(255,255,255,.07);
  border-color:rgba(255,255,255,.22);
}
.ys-pill:active:not(:disabled){transform:scale(.97)}
.ys-pill:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
.ys-pill:disabled{opacity:.4;cursor:default}
.ys-pill-lg{height:44px;padding:0 20px;font-size:14px}
.ys-pill-quiet{
  color:rgba(255,248,231,.6);background:transparent;border-color:transparent;
  -webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none;
}
.ys-pill-quiet:hover:not(:disabled){
  color:#FFD60A;background:rgba(255,255,255,.05);border-color:transparent;
}
.ys-answer{display:flex;flex-direction:column;gap:9px}
.ys-cancel{margin-top:10px;display:flex;justify-content:flex-end}

.ys-introsave{
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:26px;
}

/* The one filled control on this screen. */
.ys-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  height:44px;padding:0 22px;border-radius:999px;border:0;cursor:pointer;flex:none;
  background:linear-gradient(180deg,#FFE45C,#FFC300);color:#1A1200;
  font-size:15px;font-weight:600;letter-spacing:-.012em;
  box-shadow:0 8px 24px -10px rgba(255,199,0,.55),inset 0 1px 0 rgba(255,255,255,.45);
  transition:transform 120ms cubic-bezier(.32,.72,0,1),filter 180ms linear;
  -webkit-tap-highlight-color:transparent;
}
.ys-btn:hover:not(:disabled){filter:brightness(1.04)}
.ys-btn:active:not(:disabled){transform:scale(.97)}
.ys-btn:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
.ys-btn:disabled{
  background:rgba(255,255,255,.06);color:rgba(255,248,231,.26);
  box-shadow:none;cursor:default;
}
.ys-note{
  flex:1 1 150px;min-width:0;margin:0;
  font-size:12.5px;line-height:1.45;color:rgba(255,248,231,.45);
}
.ys-note[data-tone="warn"]{color:#FFC300}
.ys-note[data-tone="good"]{color:rgba(255,214,10,.85)}

/* --- the save bar -------------------------------------------------- */
/* A floating glass pill rather than a full-width bar: the frame's gutter
   belongs to PhoneFrame, and a bar would need a negative-margin bleed to
   cover it. It pins itself only while there is something to press — a
   permanent overlay would sit on top of the voice section's own save row
   for no reason. */
.ys-bar{
  position:relative;bottom:0;z-index:4;margin-top:30px;
  display:flex;align-items:center;gap:12px;
  padding:7px 7px 7px 17px;border-radius:999px;
  border:1px solid rgba(255,255,255,.14);
  background:rgba(20,17,10,.70);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
  backdrop-filter:blur(20px) saturate(1.4);
  box-shadow:0 20px 44px -20px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.08);
  transition:border-color 320ms ease;
}
.ys-bar[data-pinned="true"]{position:sticky;bottom:14px}
.ys-bar[data-dirty="true"]{border-color:rgba(255,214,10,.3)}
.ys-bar .ys-btn{height:40px;padding:0 18px;font-size:14px}

/* --- no-backdrop-filter fallback ----------------------------------- */
@supports not (backdrop-filter: blur(1px)){
  .ys-rail-top{background:linear-gradient(180deg,rgba(20,17,10,.97) 0%,rgba(20,17,10,.8) 58%,rgba(20,17,10,0) 100%)}
  .ys-bar{background:rgba(20,17,10,.94)}
  .ys-gate,.ys-pill,.ys-pill:hover:not(:disabled){background:rgba(60,48,10,.85)}
  .ys-pill-quiet{background:transparent}
}

/* --- gate screen --------------------------------------------------- */
.ys-loading{
  display:flex;align-items:center;justify-content:center;min-height:60vh;
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(184,134,11,.95);animation:ys-breathe 1.6s ease-in-out infinite;
}

/* --- keyframes ----------------------------------------------------- */
@keyframes ys-pop{
  from{opacity:0;transform:scale(.7)}
  to{opacity:1;transform:scale(1)}
}
@keyframes ys-breathe{0%,100%{opacity:.42}50%{opacity:1}}
@keyframes ys-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.7)}}

@media (prefers-reduced-motion: reduce){
  .ys-face span{animation:none}
  .ys-node[data-state="todo"],.ys-card-live i,.ys-loading,
  .ys-gate-eyebrow i{animation:none}
  .ys-photo-btn,.ys-photo-veil,.ys-btn,.ys-pill,.ys-input,.ys-textarea,
  .ys-node,.ys-node i,.ys-bar{transition-duration:1ms}
  .ys-photo-btn:active:not(:disabled),.ys-btn:active:not(:disabled),
  .ys-pill:active:not(:disabled){transform:none}
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
  /* Pure derivation of two pieces of state, so memoizing it changes nothing
     but its identity — and that identity is what `handlePhotoFile`'s dep list
     hangs off. Without this it is a fresh object every render, which is both
     what `react-hooks/exhaustive-deps` flags and what stops the compiler
     preserving the callback's own memoization. */
  const view: Draft = useMemo(
    () => ({
      name: draft?.name ?? stored?.name ?? '',
      emoji: draft?.emoji ?? stored?.emoji ?? DEFAULT_EMOJI,
      photoUrl: draft?.photoUrl ?? stored?.photoUrl ?? '',
      tagline: draft?.tagline ?? stored?.tagline ?? '',
      bio: draft?.bio ?? stored?.bio ?? '',
      softSkills: draft?.softSkills ?? stored?.softSkills ?? EMPTY_TAGS,
      interests: draft?.interests ?? stored?.interests ?? EMPTY_TAGS,
    }),
    [draft, stored],
  );

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
            backgroundImage: view.photoUrl
              ? undefined
              : `radial-gradient(circle at 34% 26%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 48%), linear-gradient(150deg, ${stored.gradient[0]}, ${stored.gradient[1]})`,
          }}
        >
          {view.photoUrl ? (
            <img src={view.photoUrl} alt="" className="ys-face-photo" />
          ) : (
            <span key={initialsFor(trimmedName)}>
              <Monogram name={trimmedName} size={60} />
            </span>
          )}
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
                Photo
              </span>
            </div>

            {/* Photo or initials — there is no third option, so there is no
                picker. The tile is the control: tap to choose or replace. */}
            <div className="ys-photo-row">
              <button
                type="button"
                className="ys-photo-btn"
                aria-labelledby="ys-face-label"
                aria-label={view.photoUrl ? 'Replace your photo' : 'Add a photo'}
                disabled={photoBusy}
                onClick={() => photoInputRef.current?.click()}
                style={{
                  backgroundImage: view.photoUrl
                    ? undefined
                    : `radial-gradient(circle at 34% 26%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 48%), linear-gradient(150deg, ${stored.gradient[0]}, ${stored.gradient[1]})`,
                }}
              >
                {view.photoUrl ? (
                  <img src={view.photoUrl} alt="" className="ys-face-img" />
                ) : photoBusy ? (
                  <span style={{ fontFamily: MONO, fontSize: 14 }}>···</span>
                ) : (
                  <Monogram name={trimmedName} size={76} />
                )}
                <span className="ys-photo-veil" aria-hidden="true">
                  <IconCamera size={24} />
                </span>
              </button>

              <div className="ys-photo-acts">
                <button
                  type="button"
                  className="ys-pill"
                  disabled={photoBusy}
                  onClick={() => photoInputRef.current?.click()}
                >
                  {view.photoUrl ? 'Replace photo' : 'Add a photo'}
                </button>
                {view.photoUrl ? (
                  <button
                    type="button"
                    className="ys-pill ys-pill-quiet"
                    onClick={() => setDraft({ ...view, photoUrl: '' })}
                  >
                    Remove photo
                  </button>
                ) : (
                  <p className="ys-hint" style={{ margin: 0 }}>
                    Until you add one, your initials stand in.
                  </p>
                )}
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

          <div className="ys-field">
            <div className="ys-fieldhead">
              <label
                className="ys-fieldname"
                htmlFor="ys-bio"
                style={{ fontFamily: MONO }}
              >
                Full description
              </label>
              <span className="ys-count" style={{ fontFamily: MONO }}>
                {view.bio.length}/{MAX_BIO}
              </span>
            </div>
            <textarea
              id="ys-bio"
              className="ys-textarea"
              value={view.bio}
              maxLength={MAX_BIO}
              placeholder="Who you are and what you're building — this is what you wrote at onboarding, and the only place to read it back."
              onChange={(event) => setDraft({ ...view, bio: event.target.value })}
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
              <i aria-hidden="true" />
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
                    className="ys-pill"
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
                        className="ys-pill ys-pill-quiet"
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
              className="ys-pill ys-pill-lg"
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
