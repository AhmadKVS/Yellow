'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useRouter } from 'next/navigation';
import TagEditor, { type TagGroups } from '@/components/TagEditor';
import { extractTags } from '@/lib/extract';
import { initialsFor } from '@/lib/initials';
import { resolveIdentity } from '@/lib/people';
import { rejectPhoto, uploadPhoto } from '@/lib/photoClient';
import { useAppState } from '@/lib/store';
import type { Profile } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Type stacks — pinned so the column never falls back to a system face. */
/* ------------------------------------------------------------------ */
const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const MIN_CHARS = 40;
const MAX_CHARS = 900;
const MAX_TAGLINE = 60;
/* Long enough for the scan to read as a deliberate beat on stage;
   `extractTags` already floors itself at ~1s, this floors the screen. */
const READING_FLOOR_MS = 1200;
const STEP_SWAP_MS = 190;

const MY_GRADIENT: [string, string] = ['#FFD60A', '#FF8A00'];

/* Avatars are photo-or-monogram now. `Profile.emoji` is still a required
   field on the frozen contract, so every profile carries this placeholder —
   it is written, never rendered. */
const DEFAULT_AVATAR_EMOJI = '🟡';

/* Deliberately never repeats the headline — the h1 is the stable frame,
   this line is the part that reads as live progress. */
const READING_LINES = [
  'Listening for what you care about',
  'Weighing how you work with people',
  'Naming what you keep coming back to',
];

type Step = 'write' | 'reading' | 'confirm';

const STEP_WORDS = ['Write', 'Read', 'Confirm'] as const;

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
/* Chrome glyphs — inline SVG, stroke 1.8, round caps. No emoji here.  */
/* ------------------------------------------------------------------ */

function CameraGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="6.4"
        width="15"
        height="9.6"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M7.3 6.4 8.5 4.2h3l1.2 2.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="11.2" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SpinnerGlyph() {
  return (
    <svg
      className="yo-spin"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="9"
        r="6.8"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.8"
      />
      <path
        d="M15.8 9A6.8 6.8 0 0 0 9 2.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** First sentence of the blurb, trimmed to a bubble-sized excerpt. */
function deriveTagline(text: string): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Here to meet people building things.';

  const sentence = clean.match(/^[^.!?\n]+[.!?]?/)?.[0] ?? clean;
  let excerpt = sentence.trim().replace(/[.!?,;:\s]+$/, '');
  if (!excerpt) excerpt = clean.slice(0, MAX_TAGLINE);

  if (excerpt.length > MAX_TAGLINE) {
    const cut = excerpt.slice(0, MAX_TAGLINE);
    const lastSpace = cut.lastIndexOf(' ');
    excerpt = `${(lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  return excerpt;
}

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

const delay = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** PhoneFrame owns the scroll container, so walk up and reset whichever
 *  ancestor is actually scrolling. Falls back to the window. */
function scrollScrollerToTop(from: HTMLElement | null): void {
  let node: HTMLElement | null = from;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight
    ) {
      node.scrollTop = 0;
      return;
    }
    node = node.parentElement;
  }
  window.scrollTo({ top: 0 });
}

/* ------------------------------------------------------------------ */
/* Scoped stylesheet — React hoists and dedupes by `href`.              */
/* ------------------------------------------------------------------ */

function OnboardingStyles() {
  return (
    <style href="yellow-onboarding" precedence="high">{`
/* PhoneFrame owns the scroll container and the horizontal gutters
   (max-w-[560px] + px-5/md:px-8), so this page adds no side padding and
   pins its rail/footer with sticky rather than a fixed-height column. */
.yo-root{display:flex;flex-direction:column;min-height:100dvh;position:relative}

/* --- rail: a floating layer, so chrome glass is the right material -
       The material lives on ::before so the mask can fade the blur out
       with the fill (no hard edge across the column) without fading the
       wordmark and step words sitting on top of it. */
.yo-rail{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:20px 0 14px;flex:none;position:sticky;top:0;z-index:3;
}
/* Two mask layers, intersected: the vertical one fades the band into the
   column, the horizontal one dissolves its left/right edges so the glass
   never reads as a lighter rectangle floating on the canvas. */
.yo-rail::before{
  content:'';position:absolute;left:-18px;right:-18px;top:0;bottom:-22px;z-index:-1;
  pointer-events:none;background:rgba(20,17,10,.70);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);
  -webkit-mask-image:linear-gradient(180deg,#000 0%,#000 56%,transparent 100%),
                     linear-gradient(90deg,transparent 0%,#000 12%,#000 88%,transparent 100%);
  mask-image:linear-gradient(180deg,#000 0%,#000 56%,transparent 100%),
             linear-gradient(90deg,transparent 0%,#000 12%,#000 88%,transparent 100%);
  -webkit-mask-composite:source-in;mask-composite:intersect;
}
.yo-mark{display:flex;align-items:center;gap:8px}
.yo-dot{width:8px;height:8px;border-radius:999px;background:#FFD60A;flex:none}
.yo-wordmark{font-size:15px;font-weight:600;letter-spacing:-.02em;color:#FFF8E7}
.yo-steps{display:flex;align-items:center;gap:8px}
.yo-step{
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(255,248,231,.26);transition:color 420ms cubic-bezier(.32,.72,0,1);
}
.yo-step[data-state="done"]{color:rgba(184,134,11,.9)}
.yo-step[data-state="now"]{color:#FFD60A}
.yo-tick{width:10px;height:1px;background:rgba(255,255,255,.14);flex:none}

/* --- content ---------------------------------------------------- */
.yo-body{flex:1;min-width:0;padding:6px 0 24px}
/* The reading step is short — centre it so the beat doesn't sit above
   a void with the footer stranded at the bottom of the viewport. */
.yo-body[data-step="reading"]{
  display:flex;flex-direction:column;justify-content:center;padding-bottom:64px;
}

/* fill-mode is 'backwards', not 'both': once the entrance has played the
   element must hand opacity/transform back so the exit transition can win. */
.yo-stage{
  animation:yo-rise 400ms cubic-bezier(.32,.72,0,1) backwards;
  transition:opacity ${STEP_SWAP_MS}ms ease, transform ${STEP_SWAP_MS}ms ease;
}
.yo-stage[data-phase="out"]{opacity:0;transform:translateY(-14px)}

/* --- type ladder ------------------------------------------------- */
.yo-eyebrow{
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:#B8860B;margin:0 0 12px;
}
.yo-h1{
  font-size:clamp(26px,7.2vw,30px);font-weight:700;letter-spacing:-.03em;
  line-height:1.1;color:#FFF8E7;margin:0;text-wrap:balance;
}
.yo-h1 em{font-style:normal;color:#FFD60A}
.yo-sub{
  font-size:15px;line-height:1.5;color:rgba(255,248,231,.62);
  margin:12px 0 0;max-width:36ch;text-wrap:pretty;
}

/* --- textarea: an inset card, hairline stroke, yellow on focus ---- */
.yo-field{
  position:relative;margin-top:24px;border-radius:18px;
  background:rgba(255,255,255,.045);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),
             inset 0 1px 0 rgba(255,255,255,.05),
             0 10px 30px -12px rgba(0,0,0,.6);
  transition:background 260ms cubic-bezier(.32,.72,0,1),
             box-shadow 260ms cubic-bezier(.32,.72,0,1);
}
.yo-field:focus-within{
  background:rgba(255,214,10,.07);
  box-shadow:inset 0 0 0 1px rgba(255,214,10,.42),
             inset 0 1px 0 rgba(255,255,255,.05),
             0 10px 30px -12px rgba(0,0,0,.6);
}
.yo-ta{
  display:block;width:100%;min-height:158px;resize:none;border:0;background:transparent;
  padding:17px 18px;
  color:#FFF8E7;font-size:15.5px;line-height:1.62;letter-spacing:-.011em;
}
.yo-ta:focus{outline:none}
.yo-ta::placeholder{color:rgba(255,248,231,.26)}

.yo-meter{
  display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  margin-top:11px;padding:0 2px;
}
.yo-hint{font-size:13.5px;color:rgba(255,248,231,.40);transition:color 300ms ease}
.yo-hint[data-ready="true"]{color:rgba(255,214,10,.9)}
.yo-num{
  font-size:12.5px;font-weight:500;letter-spacing:.08em;color:rgba(255,248,231,.40);
  font-variant-numeric:tabular-nums;flex:none;
}

/* --- reading step: the beam is this screen's one glow ------------- */
.yo-scan{
  position:relative;margin-top:28px;padding:20px 18px;overflow:hidden;
  border-radius:18px;background:rgba(255,255,255,.045);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),
             inset 0 1px 0 rgba(255,255,255,.05),
             0 10px 30px -12px rgba(0,0,0,.6);
}
.yo-scan-text{
  font-size:13.5px;line-height:2.05;color:rgba(255,248,231,.40);
  letter-spacing:-.008em;margin:0;
  display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;
}
.yo-beam{
  position:absolute;left:0;right:0;top:0;height:58%;pointer-events:none;
  will-change:transform;
  background:linear-gradient(180deg,
    rgba(255,214,10,0) 0%,
    rgba(255,214,10,.035) 38%,
    rgba(255,214,10,.14) 50%,
    rgba(255,214,10,.035) 62%,
    rgba(255,214,10,0) 100%);
  animation:yo-sweep 1.5s cubic-bezier(.55,0,.45,1) infinite;
}
.yo-beam::after{
  content:'';position:absolute;left:6%;right:6%;top:50%;height:1px;
  background:linear-gradient(90deg,rgba(255,214,10,0),#FFE45C 22%,#FFE45C 78%,rgba(255,214,10,0));
  box-shadow:0 0 14px rgba(255,214,10,.85);
}
.yo-status{
  display:flex;align-items:center;gap:9px;margin:22px 0 0;
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:#FFD60A;
}
.yo-pip{
  width:6px;height:6px;border-radius:999px;background:#FFD60A;flex:none;
  animation:yo-pip 1.15s ease-in-out infinite;
}
.yo-statusline{animation:yo-fade 360ms ease backwards}
.yo-ghosts{display:flex;flex-wrap:wrap;gap:8px;margin-top:26px}
/* Clear glass, so the tags-to-be read as forming rather than as holes. */
.yo-ghost{
  height:32px;border-radius:999px;background:rgba(255,255,255,.06);
  -webkit-backdrop-filter:blur(16px) saturate(1.3);backdrop-filter:blur(16px) saturate(1.3);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.10),inset 0 1px 0 rgba(255,255,255,.06);
  animation:yo-breathe 1.6s ease-in-out infinite;animation-delay:var(--yo-d,0ms);
}

/* --- confirm step ------------------------------------------------ */
.yo-confirmhead{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin-bottom:12px;
}
.yo-source{
  display:inline-flex;align-items:center;gap:6px;margin:16px 0 0;
  height:26px;padding:0 11px;border-radius:999px;
  background:linear-gradient(180deg,rgba(255,214,10,.16),rgba(255,214,10,.12)),rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.22);
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:#FFD60A;
}
.yo-divider{height:1px;margin:32px 0;background:rgba(255,255,255,.08)}
.yo-name{
  width:100%;height:50px;padding:0 16px;border:0;border-radius:14px;
  background:rgba(255,255,255,.045);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),inset 0 1px 0 rgba(255,255,255,.05);
  color:#FFF8E7;font-size:16px;letter-spacing:-.015em;font-weight:500;
  transition:background 220ms cubic-bezier(.32,.72,0,1),
             box-shadow 220ms cubic-bezier(.32,.72,0,1);
}
.yo-name::placeholder{color:rgba(255,248,231,.26);font-weight:400}
.yo-name:focus{
  outline:none;background:rgba(255,214,10,.07);
  box-shadow:inset 0 0 0 1px rgba(255,214,10,.42),inset 0 1px 0 rgba(255,255,255,.05);
}

/* --- identity: photo, else an Apple-Contacts initials monogram ---- */
.yo-identity{display:flex;align-items:center;gap:14px;margin-top:14px}
.yo-avatar{
  position:relative;flex:none;width:72px;height:72px;border-radius:999px;padding:0;border:0;
  display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;
  background:linear-gradient(180deg,rgba(255,214,10,.16),rgba(255,214,10,.12)),rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.22);
  color:rgba(255,248,231,.55);
  transition:box-shadow 200ms cubic-bezier(.32,.72,0,1),
             transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
.yo-avatar:hover:not(:disabled){
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.24),inset 0 1px 0 rgba(255,255,255,.28);
}
.yo-avatar:active:not(:disabled){transform:scale(.96)}
.yo-avatar:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
/* A photo is its own material — flat rim, no tint under it. */
.yo-avatar[data-photo="true"]{
  background:rgba(255,255,255,.045);
  -webkit-backdrop-filter:none;backdrop-filter:none;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);
}
.yo-mono{
  color:#FFF8E7;font-weight:600;letter-spacing:.02em;line-height:1;
  transition:font-size 200ms cubic-bezier(.32,.72,0,1);
}
.yo-avatar-img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.yo-identity-copy{flex:1;min-width:0}
.yo-identity-line{
  margin:0;font-size:13.5px;line-height:1.45;color:rgba(255,248,231,.62);
}
.yo-photorow{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:2px}
.yo-photobtn{
  display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 2px;
  border:0;background:transparent;cursor:pointer;
  font-size:13.5px;font-weight:500;letter-spacing:-.01em;color:#FFD60A;
  transition:color 180ms ease;-webkit-tap-highlight-color:transparent;
}
.yo-photobtn[data-quiet="true"]{color:rgba(255,248,231,.62)}
.yo-photobtn:hover:not(:disabled){color:#FFE45C}
.yo-photobtn[data-quiet="true"]:hover:not(:disabled){color:#FFD60A}
.yo-photobtn:disabled{color:rgba(255,248,231,.26);cursor:default}
.yo-photobtn:focus-visible{outline:2px solid #FFD60A;outline-offset:2px;border-radius:10px}
.yo-photo-err{margin:8px 0 0;font-size:12.5px;line-height:1.45;color:#FFCFA6}

/* --- footer ----------------------------------------------------- */
.yo-foot{
  flex:none;position:sticky;bottom:0;z-index:2;
  padding:16px 0 calc(18px + env(safe-area-inset-bottom,0px));
}
.yo-foot::before{
  content:'';position:absolute;left:-18px;right:-18px;top:-26px;bottom:0;z-index:-1;
  pointer-events:none;background:rgba(20,17,10,.70);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);backdrop-filter:blur(20px) saturate(1.4);
  -webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 46%,#000 100%),
                     linear-gradient(90deg,transparent 0%,#000 12%,#000 88%,transparent 100%);
  mask-image:linear-gradient(180deg,transparent 0%,#000 46%,#000 100%),
             linear-gradient(90deg,transparent 0%,#000 12%,#000 88%,transparent 100%);
  -webkit-mask-composite:source-in;mask-composite:intersect;
}
/* The one filled pill, and the one glow, per step. */
.yo-cta{
  display:flex;align-items:center;justify-content:center;gap:9px;
  width:100%;height:50px;border:0;border-radius:999px;cursor:pointer;
  background:linear-gradient(180deg,#FFE45C,#FFC300);color:#1A1200;
  font-size:15px;font-weight:600;letter-spacing:-.01em;
  box-shadow:0 8px 24px -10px rgba(255,199,0,.55),inset 0 1px 0 rgba(255,255,255,.45);
  transition:transform 120ms cubic-bezier(.32,.72,0,1),box-shadow 200ms ease,
             background 200ms ease;
  -webkit-tap-highlight-color:transparent;
}
.yo-cta:hover:not(:disabled){
  box-shadow:0 12px 30px -10px rgba(255,199,0,.72),inset 0 1px 0 rgba(255,255,255,.45);
}
.yo-cta:active:not(:disabled){transform:scale(.97)}
.yo-cta:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
.yo-cta:disabled{
  background:rgba(255,255,255,.055);color:rgba(255,248,231,.26);
  box-shadow:none;cursor:default;
}
.yo-footnote{
  margin:10px 0 0;text-align:center;font-size:12.5px;color:rgba(255,248,231,.40);
  min-height:1em;
}
.yo-back{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:44px;padding:0 4px;border:0;background:transparent;cursor:pointer;
  font-size:13.5px;font-weight:500;letter-spacing:-.01em;color:rgba(255,248,231,.62);
  transition:color 180ms ease;-webkit-tap-highlight-color:transparent;
}
.yo-back:hover{color:#FFD60A}
.yo-back:focus-visible{outline:2px solid #FFD60A;outline-offset:2px;border-radius:10px}

/* --- gate ------------------------------------------------------- */
.yo-gate{
  flex:1;display:flex;align-items:center;justify-content:center;
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(184,134,11,.8);animation:yo-breathe 1.6s ease-in-out infinite;
}

/* --- keyframes --------------------------------------------------- */
@keyframes yo-rise{
  from{opacity:0;transform:translateY(16px)}
  to{opacity:1;transform:translateY(0)}
}
@keyframes yo-fade{from{opacity:0}to{opacity:1}}
@keyframes yo-sweep{
  0%{transform:translateY(-108%)}
  100%{transform:translateY(220%)}
}
@keyframes yo-pip{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.25;transform:scale(.7)}
}
@keyframes yo-breathe{
  0%,100%{opacity:.4}
  50%{opacity:.95}
}
@keyframes yo-spin{to{transform:rotate(360deg)}}
.yo-spin{animation:yo-spin 900ms linear infinite;transform-origin:50% 50%}

/* No backdrop-filter (older Firefox): raise the fill so nothing turns
   into see-through soup. */
@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){
  .yo-rail::before,.yo-foot::before{background:rgba(9,8,5,.96)}
  .yo-source,.yo-avatar{background:rgba(60,48,10,.85)}
  .yo-avatar[data-photo="true"]{background:rgba(38,34,25,.94)}
  .yo-ghost{background:rgba(26,23,17,.92)}
}

@media (prefers-reduced-motion: reduce){
  .yo-stage,.yo-statusline{animation-duration:1ms}
  .yo-beam{animation:yo-breathe 1.8s ease-in-out infinite;transform:translateY(55%)}
  .yo-spin{animation:none}
  .yo-cta:active:not(:disabled),.yo-avatar:active:not(:disabled){transform:none}
  .yo-mono{transition-duration:1ms}
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */

export default function OnboardingPage() {
  const router = useRouter();
  const { state, setProfile } = useAppState();

  const [step, setStep] = useState<Step>('write');
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  const [text, setText] = useState('');
  const [tags, setTags] = useState<TagGroups>({ softSkills: [], interests: [] });
  const [source, setSource] = useState<'ai' | 'local'>('local');
  const [statusIndex, setStatusIndex] = useState(0);

  const [name, setName] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* The store hydrates in an effect. Don't paint the form until it has —
     but never hold the demo hostage to a store that never resolves. */
  const [gateOpen, setGateOpen] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setGateOpen(true), 1200);
    return () => window.clearTimeout(id);
  }, []);

  const alive = useRef(true);
  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  /* Kept so an over-eager editor that empties a group can still be
     rescued into a matchable profile at submit time. */
  const extracted = useRef<TagGroups>({ softSkills: [], interests: [] });

  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach((id) => window.clearTimeout(id));
      pending.length = 0;
    };
  }, []);

  /* Nobody re-onboards by accident mid-demo. */
  const alreadyOnboarded = state.hydrated && Boolean(state.me);
  useEffect(() => {
    if (alreadyOnboarded) router.replace('/home');
  }, [alreadyOnboarded, router]);

  /* Cycle the reading copy so the wait reads as work, not as a spinner. */
  useEffect(() => {
    if (step !== 'reading') return;
    const id = window.setInterval(
      () => setStatusIndex((i) => (i + 1) % READING_LINES.length),
      620,
    );
    return () => window.clearInterval(id);
  }, [step]);

  const goTo = useCallback((next: Step) => {
    setPhase('out');
    const id = window.setTimeout(() => {
      if (!alive.current) return;
      setStep(next);
      setPhase('in');
      scrollScrollerToTop(rootRef.current);
    }, STEP_SWAP_MS);
    timers.current.push(id);
  }, []);

  const trimmed = text.trim();
  const canRead = trimmed.length >= MIN_CHARS;

  const handleRead = useCallback(() => {
    if (!canRead || step !== 'write') return;
    setStatusIndex(0);
    goTo('reading');

    const id = window.setTimeout(async () => {
      /* `extractTags` never throws and never rejects — it falls back to
         local keyword extraction — so there is no failure branch here. */
      const [result] = await Promise.all([
        extractTags(trimmed),
        delay(READING_FLOOR_MS),
      ]);
      if (!alive.current) return;

      const next: TagGroups = {
        softSkills: tidy(result.softSkills, 10),
        interests: tidy(result.interests, 10),
      };
      extracted.current = next;
      setTags(next);
      setSource(result.source === 'ai' ? 'ai' : 'local');
      goTo('confirm');
    }, STEP_SWAP_MS + 40);
    timers.current.push(id);
  }, [canRead, goTo, step, trimmed]);

  const handlePhotoFile = useCallback(async (file: File | null) => {
    if (!file) return;
    const rejection = rejectPhoto(file);
    if (rejection) {
      setPhotoError(rejection === 'type' ? 'That file isn’t an image.' : 'Keep it under 8MB.');
      return;
    }
    setPhotoError('');
    setPhotoBusy(true);
    const ownerId = await resolveIdentity();
    const url = await uploadPhoto(ownerId, file);
    if (!alive.current) return;
    setPhotoBusy(false);
    if (url) setPhotoUrl(url);
    else setPhotoError('Couldn’t upload that — try again.');
  }, []);

  const tagline = useMemo(() => deriveTagline(text), [text]);
  const trimmedName = name.trim();
  const monogram = useMemo(() => initialsFor(trimmedName), [trimmedName]);
  const canEnter =
    trimmedName.length > 0 &&
    tags.softSkills.length > 0 &&
    tags.interests.length > 0;

  const enterHint = useMemo(() => {
    if (trimmedName.length === 0) return 'Add a name so people know who they met.';
    if (tags.softSkills.length === 0) return 'Keep at least one soft skill.';
    if (tags.interests.length === 0) return 'Keep at least one interest.';
    return '';
  }, [tags.interests.length, tags.softSkills.length, trimmedName.length]);

  const handleEnter = useCallback(() => {
    if (!canEnter || submitting) return;
    setSubmitting(true);

    const softSkills = tidy(tags.softSkills, 10);
    const interests = tidy(tags.interests, 10);

    const profile: Profile = {
      id: 'me',
      name: trimmedName.slice(0, 40) || 'You',
      emoji: DEFAULT_AVATAR_EMOJI,
      photoUrl,
      gradient: MY_GRADIENT,
      tagline,
      bio: trimmed || undefined,
      softSkills: softSkills.length
        ? softSkills
        : tidy(extracted.current.softSkills, 10),
      interests: interests.length
        ? interests
        : tidy(extracted.current.interests, 10),
    };

    setProfile(profile);
    router.push('/home');
  }, [
    canEnter,
    photoUrl,
    router,
    setProfile,
    submitting,
    tagline,
    tags.interests,
    tags.softSkills,
    trimmed,
    trimmedName,
  ]);

  /* ---------------------------------------------------------------- */

  if (!state.hydrated && !gateOpen) {
    return (
      <div className="yo-root" style={{ fontFamily: SANS }}>
        <OnboardingStyles />
        <p className="yo-gate" style={{ fontFamily: MONO }}>
          Yellow
        </p>
      </div>
    );
  }

  if (alreadyOnboarded) {
    return (
      <div className="yo-root" style={{ fontFamily: SANS }}>
        <OnboardingStyles />
        <p className="yo-gate" style={{ fontFamily: MONO }}>
          Taking you back
        </p>
      </div>
    );
  }

  const stepIndex = step === 'write' ? 0 : step === 'reading' ? 1 : 2;
  const stepState = (i: number) =>
    i === stepIndex ? 'now' : i < stepIndex ? 'done' : 'next';

  return (
    <div className="yo-root" style={{ fontFamily: SANS }} ref={rootRef}>
      <OnboardingStyles />

      <header className="yo-rail">
        <div className="yo-mark">
          <span className="yo-dot" aria-hidden="true" />
          <span className="yo-wordmark">Yellow</span>
        </div>
        <div className="yo-steps" style={{ fontFamily: MONO }} aria-hidden="true">
          {STEP_WORDS.map((word, i) => (
            <Fragment key={word}>
              {i > 0 ? <span className="yo-tick" /> : null}
              <span className="yo-step" data-state={stepState(i)}>
                {word}
              </span>
            </Fragment>
          ))}
        </div>
        <p style={srOnly} role="status" aria-live="polite">
          {`Step ${stepIndex + 1} of 3: ${STEP_WORDS[stepIndex]}`}
        </p>
      </header>

      <div className="yo-body" data-step={step}>
        <div className="yo-stage" data-phase={phase} key={step}>
          {/* ---------------- STEP 1 — write ---------------- */}
          {step === 'write' ? (
            <>
              <p className="yo-eyebrow" style={{ fontFamily: MONO }}>
                No résumé required
              </p>
              <h1 className="yo-h1">
                Who are you, and what are you <em>building</em>?
              </h1>
              <p className="yo-sub">
                Write it the way you&rsquo;d tell a friend. What you care about
                counts for more here than what you do.
              </p>

              <div className="yo-field">
                <label htmlFor="yo-blurb" style={srOnly}>
                  Tell us who you are and what you are building
                </label>
                <textarea
                  id="yo-blurb"
                  className="yo-ta"
                  value={text}
                  maxLength={MAX_CHARS}
                  placeholder="I spent six years in kitchens before I…"
                  aria-describedby="yo-blurb-hint"
                  onChange={(event) => setText(event.target.value)}
                />
              </div>

              <div className="yo-meter">
                <span id="yo-blurb-hint" className="yo-hint" data-ready={canRead}>
                  {canRead
                    ? "That's plenty to go on."
                    : 'A few more words and we can work with this.'}
                </span>
                <span className="yo-num" style={{ fontFamily: MONO }}>
                  {trimmed.length}
                </span>
              </div>
            </>
          ) : null}

          {/* ---------------- STEP 2 — reading ---------------- */}
          {step === 'reading' ? (
            <>
              <p className="yo-eyebrow" style={{ fontFamily: MONO }}>
                Hold on
              </p>
              <h1 className="yo-h1">
                Reading between the <em>lines</em>.
              </h1>

              <div className="yo-scan">
                <p className="yo-scan-text">{trimmed}</p>
                <span className="yo-beam" aria-hidden="true" />
              </div>

              <p
                className="yo-status"
                style={{ fontFamily: MONO }}
                role="status"
                aria-live="polite"
              >
                <span className="yo-pip" aria-hidden="true" />
                <span className="yo-statusline" key={statusIndex}>
                  {READING_LINES[statusIndex]}
                </span>
              </p>

              <div className="yo-ghosts" aria-hidden="true">
                {[104, 78, 132, 92, 116, 70].map((width, i) => (
                  <span
                    key={width}
                    className="yo-ghost"
                    style={{ width, ['--yo-d' as string]: `${i * 110}ms` }}
                  />
                ))}
              </div>
            </>
          ) : null}

          {/* ---------------- STEP 3 — confirm ---------------- */}
          {step === 'confirm' ? (
            <>
              <div className="yo-confirmhead">
                <p className="yo-eyebrow" style={{ fontFamily: MONO, margin: 0 }}>
                  What we heard
                </p>
                <button
                  type="button"
                  className="yo-back"
                  onClick={() => goTo('write')}
                >
                  Rewrite
                </button>
              </div>

              <h1 className="yo-h1">
                Here&rsquo;s what we heard. <em>Adjust anything.</em>
              </h1>
              <p className="yo-sub">
                These are what we&rsquo;ll match you on. You know you better
                than we do, so cut what&rsquo;s wrong and add what&rsquo;s
                missing.
              </p>
              <p className="yo-source" style={{ fontFamily: MONO }}>
                {source === 'ai' ? 'Read by AI' : 'Read from your words'}
              </p>

              <div style={{ marginTop: 28 }}>
                <TagEditor
                  softSkills={tags.softSkills}
                  interests={tags.interests}
                  onChange={setTags}
                />
              </div>

              <div className="yo-divider" aria-hidden="true" />

              <p className="yo-eyebrow" style={{ fontFamily: MONO }}>
                Name yourself
              </p>
              <label htmlFor="yo-name" style={srOnly}>
                Your name
              </label>
              <input
                id="yo-name"
                className="yo-name"
                type="text"
                value={name}
                maxLength={40}
                placeholder="What should people call you?"
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />

              <div className="yo-identity">
                <button
                  type="button"
                  className="yo-avatar"
                  data-photo={Boolean(photoUrl)}
                  disabled={photoBusy}
                  aria-label={photoUrl ? 'Replace your photo' : 'Add a photo'}
                  onClick={() => photoInputRef.current?.click()}
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="" className="yo-avatar-img" />
                  ) : photoBusy ? (
                    <SpinnerGlyph />
                  ) : (
                    <span
                      className="yo-mono"
                      aria-hidden="true"
                      style={{ fontSize: monogram.length > 1 ? 23 : 29 }}
                    >
                      {monogram}
                    </span>
                  )}
                </button>

                <div className="yo-identity-copy">
                  <p className="yo-identity-line">
                    {photoUrl
                      ? 'Your photo is how people will spot you.'
                      : 'People see your initials until you add a photo.'}
                  </p>
                  <div className="yo-photorow">
                    <button
                      type="button"
                      className="yo-photobtn"
                      disabled={photoBusy}
                      onClick={() => photoInputRef.current?.click()}
                    >
                      <CameraGlyph />
                      {photoBusy
                        ? 'Uploading…'
                        : photoUrl
                          ? 'Replace photo'
                          : 'Add a photo'}
                    </button>
                    {photoUrl ? (
                      <button
                        type="button"
                        className="yo-photobtn"
                        data-quiet="true"
                        onClick={() => setPhotoUrl(undefined)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
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
              {photoError ? <p className="yo-photo-err">{photoError}</p> : null}
            </>
          ) : null}
        </div>
      </div>

      <footer className="yo-foot">
        {step === 'write' ? (
          <>
            <button
              type="button"
              className="yo-cta"
              disabled={!canRead}
              onClick={handleRead}
            >
              Read between the lines
            </button>
            <p className="yo-footnote">
              {canRead ? 'Takes a second.' : `${MIN_CHARS} characters or so.`}
            </p>
          </>
        ) : null}

        {step === 'reading' ? (
          <>
            <button type="button" className="yo-cta" disabled>
              Reading&hellip;
            </button>
            <p className="yo-footnote">Nearly there.</p>
          </>
        ) : null}

        {step === 'confirm' ? (
          <>
            <button
              type="button"
              className="yo-cta"
              disabled={!canEnter || submitting}
              onClick={handleEnter}
            >
              {submitting ? 'Opening Yellow…' : 'Enter Yellow'}
            </button>
            <p className="yo-footnote" role="status" aria-live="polite">
              {enterHint || 'You can change all of this later.'}
            </p>
          </>
        ) : null}
      </footer>
    </div>
  );
}
