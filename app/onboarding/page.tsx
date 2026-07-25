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
const EMOJI_FACE =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

const MIN_CHARS = 40;
const MAX_CHARS = 900;
const MAX_TAGLINE = 60;
/* Long enough for the scan to read as a deliberate beat on stage;
   `extractTags` already floors itself at ~1s, this floors the screen. */
const READING_FLOOR_MS = 1200;
const STEP_SWAP_MS = 190;

const MY_GRADIENT: [string, string] = ['#FFD60A', '#FF8A00'];

/* Deliberately disjoint from the seed personas' emoji so a new user never
   reads as a duplicate of someone already floating in the bubble map. */
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

const EXAMPLES = [
  {
    emoji: '🧪',
    title: 'The teacher',
    text: "I taught middle-school science for nine years, then quit to build a tutoring app for the kids who quietly fall through the cracks. I'm stubborn about the ones everyone else has given up on, and I'm happiest explaining something over and over until it finally clicks. Weekends I cook for far too many people.",
  },
  {
    emoji: '🔩',
    title: 'The tinkerer',
    text: "Ex-warehouse ops, self-taught engineer. I build unglamorous robotics that make physical work less brutal on people's bodies. I prototype fast and badly, then fix it. Most of my week is user interviews on factory floors, which is where all the good ideas actually come from. I run to think.",
  },
  {
    emoji: '📮',
    title: 'The convener',
    text: 'I write a newsletter about climate finance that somehow turned into a four-thousand-person community. Honestly I care more about getting those people talking to each other than about the writing. Right now I am raising a small round and quietly terrified about it. Ask me about my sourdough.',
  },
];

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

/* --- rail ------------------------------------------------------- */
.yo-rail{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:18px 0 16px;flex:none;position:sticky;top:0;z-index:3;
  /* Glass rather than a flat fill: an opaque band would read as a hard
     rectangle against the frame's ambient glow in the desktop gutters. */
  background:linear-gradient(180deg,rgba(11,10,8,.9) 0%,rgba(11,10,8,.72) 55%,rgba(11,10,8,0) 100%);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
}
.yo-mark{display:flex;align-items:center;gap:7px}
.yo-dot{
  width:9px;height:9px;border-radius:999px;background:#FFD60A;
  box-shadow:0 0 12px rgba(255,214,10,.85);
}
.yo-wordmark{
  font-size:13.5px;font-weight:600;letter-spacing:-.02em;color:#FFF8E7;
}
.yo-steps{display:flex;align-items:center;gap:7px}
.yo-step{
  font-size:9px;letter-spacing:.2em;text-transform:uppercase;
  color:rgba(184,134,11,.45);transition:color 420ms ease;
}
.yo-step[data-state="done"]{color:rgba(184,134,11,.95)}
.yo-step[data-state="now"]{color:#FFD60A;text-shadow:0 0 14px rgba(255,214,10,.5)}
.yo-tick{width:9px;height:1px;background:rgba(184,134,11,.35)}

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
  animation:yo-rise 400ms cubic-bezier(.22,1,.36,1) backwards;
  transition:opacity ${STEP_SWAP_MS}ms ease, transform ${STEP_SWAP_MS}ms ease;
}
.yo-stage[data-phase="out"]{opacity:0;transform:translateY(-14px)}

/* --- type ------------------------------------------------------- */
.yo-eyebrow{
  font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:#B8860B;
  margin-bottom:14px;
}
.yo-h1{
  font-size:clamp(30px,8.4vw,41px);font-weight:600;letter-spacing:-.04em;
  line-height:1.03;color:#FFF8E7;margin:0;text-wrap:balance;
}
.yo-h1 em{font-style:normal;color:#FFD60A}
.yo-sub{
  font-size:14.5px;line-height:1.55;color:rgba(255,248,231,.55);
  margin:15px 0 0;max-width:34ch;text-wrap:pretty;
}

/* --- textarea --------------------------------------------------- */
.yo-field{
  position:relative;margin-top:26px;padding-left:14px;
  border-radius:4px 16px 16px 4px;background:rgba(255,248,231,.035);
  transition:background 260ms ease;
}
.yo-field::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:2px;border-radius:999px;
  background:rgba(184,134,11,.42);transition:background 260ms ease,box-shadow 260ms ease;
}
.yo-field:focus-within{background:rgba(255,214,10,.05)}
.yo-field:focus-within::before{
  background:#FFD60A;box-shadow:0 0 16px rgba(255,214,10,.75);
}
.yo-ta{
  display:block;width:100%;min-height:152px;resize:none;border:0;background:transparent;
  padding:16px 16px 16px 4px;
  color:#FFF8E7;font-size:15.5px;line-height:1.62;letter-spacing:-.011em;
}
.yo-ta:focus{outline:none}
.yo-ta::placeholder{color:rgba(255,248,231,.26)}

.yo-meter{
  display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  margin-top:11px;
}
.yo-hint{font-size:12.5px;color:rgba(255,248,231,.42);transition:color 300ms ease}
.yo-hint[data-ready="true"]{color:rgba(255,214,10,.82)}
.yo-num{
  font-size:10px;letter-spacing:.12em;color:rgba(184,134,11,.75);
  font-variant-numeric:tabular-nums;flex:none;
}

/* --- example blurbs --------------------------------------------- */
.yo-seclabel{
  display:flex;align-items:center;gap:10px;margin:30px 0 12px;
  font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:#B8860B;
}
.yo-seclabel::after{
  content:'';flex:1;height:1px;
  background:linear-gradient(90deg,rgba(184,134,11,.4),rgba(184,134,11,0));
}
.yo-ex{
  display:flex;align-items:flex-start;gap:12px;width:100%;text-align:left;
  padding:12px 14px;margin-bottom:8px;cursor:pointer;
  border:1px solid rgba(184,134,11,.24);border-radius:14px;background:transparent;
  transition:border-color 200ms ease,background 200ms ease,transform 200ms ease;
  -webkit-tap-highlight-color:transparent;
}
.yo-ex:hover{border-color:rgba(255,214,10,.6);background:rgba(255,214,10,.05)}
.yo-ex:active{transform:scale(.985)}
.yo-ex:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
.yo-ex-emoji{font-size:17px;line-height:1.35;flex:none}
.yo-ex-title{font-size:13.5px;font-weight:600;color:#FFF8E7;letter-spacing:-.012em}
.yo-ex-peek{
  font-size:12px;line-height:1.45;color:rgba(255,248,231,.4);margin-top:3px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}

/* --- reading step ----------------------------------------------- */
.yo-scan{
  position:relative;margin-top:30px;padding:20px 18px;overflow:hidden;
  border-radius:18px;border:1px solid rgba(184,134,11,.26);
  background:rgba(255,248,231,.03);
}
.yo-scan-text{
  font-size:13.5px;line-height:2.05;color:rgba(255,248,231,.42);
  letter-spacing:-.008em;margin:0;
  display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;
}
.yo-beam{
  position:absolute;left:0;right:0;top:0;height:64%;pointer-events:none;
  background:linear-gradient(180deg,
    rgba(255,214,10,0) 0%,
    rgba(255,214,10,.05) 34%,
    rgba(255,214,10,.16) 48%,
    rgba(255,214,10,.05) 62%,
    rgba(255,214,10,0) 100%);
  animation:yo-sweep 1.55s cubic-bezier(.55,0,.45,1) infinite;
}
.yo-beam::after{
  content:'';position:absolute;left:8%;right:8%;top:50%;height:1px;
  background:linear-gradient(90deg,rgba(255,214,10,0),rgba(255,214,10,.95),rgba(255,214,10,0));
  box-shadow:0 0 12px rgba(255,214,10,.8);
}
.yo-status{
  display:flex;align-items:center;gap:9px;margin-top:22px;
  font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#FFD60A;
}
.yo-pip{
  width:6px;height:6px;border-radius:999px;background:#FFD60A;flex:none;
  animation:yo-pip 1.15s ease-in-out infinite;
}
.yo-statusline{animation:yo-fade 360ms ease backwards}
.yo-ghosts{display:flex;flex-wrap:wrap;gap:7px;margin-top:26px}
.yo-ghost{
  height:31px;border-radius:999px;background:rgba(255,214,10,.09);
  animation:yo-breathe 1.5s ease-in-out infinite;animation-delay:var(--yo-d,0ms);
}

/* --- confirm step ----------------------------------------------- */
.yo-source{
  display:inline-flex;align-items:center;gap:6px;margin-top:16px;
  padding:4px 10px;border-radius:999px;border:1px solid rgba(184,134,11,.3);
  font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:rgba(184,134,11,.95);
}
.yo-divider{
  height:1px;margin:32px 0;
  background:linear-gradient(90deg,rgba(184,134,11,.34),rgba(184,134,11,0));
}
.yo-name{
  width:100%;height:48px;padding:0 16px;
  background:rgba(255,248,231,.045);border:1px solid rgba(184,134,11,.3);
  border-radius:14px;color:#FFF8E7;font-size:16px;letter-spacing:-.015em;font-weight:500;
  transition:border-color 220ms ease,background 220ms ease;
}
.yo-name::placeholder{color:rgba(255,248,231,.28);font-weight:400}
.yo-name:focus{outline:none;border-color:rgba(255,214,10,.75);background:rgba(255,214,10,.05)}

/* Capped so the tiles stay a consistent ~56-62px at every column width
   instead of ballooning into 80px slabs on desktop. */
.yo-faces{
  display:grid;grid-template-columns:repeat(6,1fr);gap:9px;margin-top:12px;max-width:404px;
}
.yo-face{
  aspect-ratio:1;display:flex;align-items:center;justify-content:center;
  border-radius:16px;border:1px solid rgba(184,134,11,.24);background:transparent;
  font-size:clamp(20px,4.6vw,26px);cursor:pointer;
  transition:border-color 200ms ease,background 200ms ease,transform 200ms cubic-bezier(.22,1,.36,1);
  -webkit-tap-highlight-color:transparent;
}
.yo-face:hover{border-color:rgba(255,214,10,.55);transform:translateY(-2px)}
.yo-face:active{transform:scale(.9)}
.yo-face:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}
.yo-face[aria-checked="true"]{
  border-color:#FFD60A;background:rgba(255,214,10,.15);
  box-shadow:0 0 0 1px #FFD60A inset,0 0 20px rgba(255,214,10,.3);
  transform:translateY(-2px) scale(1.04);
}
.yo-face-wrap{position:relative;aspect-ratio:1}
.yo-face-wrap .yo-face{width:100%;height:100%;aspect-ratio:auto;font-size:17px;overflow:hidden}
.yo-face-img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.yo-face-clear{
  position:absolute;top:-5px;right:-5px;width:18px;height:18px;padding:0;
  display:flex;align-items:center;justify-content:center;border-radius:999px;cursor:pointer;
  border:1px solid rgba(255,214,10,.5);background:#100E09;color:#FFF8E7;font-size:9px;
  -webkit-tap-highlight-color:transparent;
}
.yo-face-clear:hover{border-color:#FFD60A;color:#FFD60A}
.yo-photo-err{margin:8px 0 0;font-size:11.5px;color:#FFC300}

/* --- footer ----------------------------------------------------- */
.yo-foot{
  flex:none;position:sticky;bottom:0;z-index:2;
  padding:18px 0 calc(18px + env(safe-area-inset-bottom,0px));
  background:linear-gradient(180deg,rgba(11,10,8,0) 0%,rgba(11,10,8,.72) 38%,rgba(11,10,8,.9) 100%);
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
}
.yo-cta{
  display:flex;align-items:center;justify-content:center;gap:9px;
  width:100%;height:52px;border:0;border-radius:999px;cursor:pointer;
  background:linear-gradient(180deg,#FFDE3B,#FFC300);color:#0B0A08;
  font-size:15.5px;font-weight:650;letter-spacing:-.015em;
  box-shadow:0 6px 26px rgba(255,195,0,.3),inset 0 1px 0 rgba(255,255,255,.5);
  transition:transform 200ms cubic-bezier(.22,1,.36,1),box-shadow 200ms ease,opacity 200ms ease;
  -webkit-tap-highlight-color:transparent;
}
.yo-cta:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 34px rgba(255,195,0,.44),inset 0 1px 0 rgba(255,255,255,.5)}
.yo-cta:active:not(:disabled){transform:scale(.978)}
.yo-cta:focus-visible{outline:2px solid #FFD60A;outline-offset:3px}
.yo-cta:disabled{
  background:rgba(255,248,231,.07);color:rgba(255,248,231,.3);
  box-shadow:none;cursor:default;
}
.yo-footnote{
  margin:10px 0 0;text-align:center;font-size:11px;color:rgba(255,248,231,.34);
  min-height:1em;
}
.yo-back{
  border:0;background:transparent;cursor:pointer;padding:2px 0;
  font-size:9px;letter-spacing:.18em;text-transform:uppercase;
  color:rgba(184,134,11,.9);
  transition:color 180ms ease;
}
.yo-back:hover{color:#FFD60A}
.yo-back:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}

/* --- gate ------------------------------------------------------- */
.yo-gate{
  flex:1;display:flex;align-items:center;justify-content:center;
  font-size:10px;letter-spacing:.24em;text-transform:uppercase;
  color:rgba(184,134,11,.7);animation:yo-breathe 1.5s ease-in-out infinite;
}

/* --- keyframes --------------------------------------------------- */
@keyframes yo-rise{
  from{opacity:0;transform:translateY(16px)}
  to{opacity:1;transform:translateY(0)}
}
@keyframes yo-fade{from{opacity:0}to{opacity:1}}
@keyframes yo-sweep{
  0%{transform:translateY(-105%)}
  100%{transform:translateY(215%)}
}
@keyframes yo-pip{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.25;transform:scale(.7)}
}
@keyframes yo-breathe{
  0%,100%{opacity:.4}
  50%{opacity:.95}
}

@media (prefers-reduced-motion: reduce){
  .yo-stage,.yo-statusline{animation-duration:1ms}
  .yo-beam{animation:yo-breathe 1.8s ease-in-out infinite;transform:translateY(55%)}
  .yo-face:hover,.yo-cta:hover:not(:disabled),.yo-ex:active,.yo-cta:active:not(:disabled){transform:none}
  .yo-face[aria-checked="true"]{transform:none}
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
  const [emoji, setEmoji] = useState(AVATARS[0]);
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
      emoji: emoji || AVATARS[0],
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
    emoji,
    photoUrl,
    router,
    setProfile,
    submitting,
    tagline,
    tags.interests,
    tags.softSkills,
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

              <p className="yo-seclabel" style={{ fontFamily: MONO }}>
                Or borrow one
              </p>
              {EXAMPLES.map((example) => (
                <button
                  key={example.title}
                  type="button"
                  className="yo-ex"
                  onClick={() => setText(example.text)}
                >
                  <span
                    className="yo-ex-emoji"
                    aria-hidden="true"
                    style={{ fontFamily: EMOJI_FACE }}
                  >
                    {example.emoji}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="yo-ex-title">{example.title}</span>
                    <span className="yo-ex-peek">{example.text}</span>
                  </span>
                </button>
              ))}
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
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <p className="yo-eyebrow" style={{ fontFamily: MONO, margin: 0 }}>
                  What we heard
                </p>
                <button
                  type="button"
                  className="yo-back"
                  style={{ fontFamily: MONO }}
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

              <div
                role="radiogroup"
                aria-label="Pick an avatar"
                className="yo-faces"
              >
                {AVATARS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={!photoUrl && emoji === option}
                    aria-label={`Avatar ${option}`}
                    className="yo-face"
                    style={{ fontFamily: EMOJI_FACE }}
                    onClick={() => {
                      setEmoji(option);
                      setPhotoUrl(undefined);
                    }}
                  >
                    {option}
                  </button>
                ))}

                <div className="yo-face-wrap">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={Boolean(photoUrl)}
                    aria-label={photoUrl ? 'Your photo. Tap to replace.' : 'Upload a photo'}
                    className="yo-face"
                    disabled={photoBusy}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    {photoUrl ? (
                      <img src={photoUrl} alt="" className="yo-face-img" />
                    ) : photoBusy ? (
                      '…'
                    ) : (
                      '📷'
                    )}
                  </button>
                  {photoUrl ? (
                    <button
                      type="button"
                      className="yo-face-clear"
                      aria-label="Remove photo"
                      onClick={() => setPhotoUrl(undefined)}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>
              <p
                style={{
                  margin: '9px 0 0',
                  fontSize: 11.5,
                  lineHeight: 1.4,
                  color: 'rgba(255,248,231,.4)',
                }}
              >
                Tap the camera to add your own photo instead of an emoji.
              </p>
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
