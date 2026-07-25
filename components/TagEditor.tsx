'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { TAG_VOCAB } from '@/lib/seed';

/* ------------------------------------------------------------------ */
/* Type stacks are set explicitly so chips never fall back to a system
   face if this component gets reused outside the onboarding column.   */
/* ------------------------------------------------------------------ */
const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

const DEFAULT_MAX = 10;
const MAX_TAG_LENGTH = 28;
const SUGGESTION_COUNT = 6;
/* Must stay in sync with the `.yt-chip` transition duration below —
   the DOM node is kept alive exactly long enough to play the collapse. */
const REMOVE_MS = 190;
const NOTICE_MS = 2600;
/** Entrances stagger over the first row only, per the motion spec. */
const STAGGER_LIMIT = 6;

export interface TagGroups {
  softSkills: string[];
  interests: string[];
}

export interface TagEditorProps {
  /** Current soft-skill tags. Controlled. */
  softSkills: string[];
  /** Current interest tags. Controlled. */
  interests: string[];
  /** Called with the complete next state whenever either group changes. */
  onChange: (next: TagGroups) => void;
  /** Suggestion source. Defaults to `TAG_VOCAB` from `@/lib/seed`. */
  vocab?: TagGroups;
  /** Ceiling per group. Defaults to 10. */
  maxPerGroup?: number;
}

/* ------------------------------------------------------------------ */

function normalize(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
}

/** Snap free text onto the canonical vocab casing when it matches —
 *  "storytelling" becoming "Storytelling" is what makes matching work. */
function canonicalize(value: string, vocab: string[]): string {
  const lower = value.toLowerCase();
  return vocab.find((entry) => entry.toLowerCase() === lower) ?? value;
}

function has(tags: string[], value: string): boolean {
  const lower = value.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === lower);
}

/* ------------------------------------------------------------------ */

function TagEditorStyles() {
  return (
    <style href="yellow-tag-editor" precedence="high">{`
.yt-group{display:flex;flex-direction:column}
.yt-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.yt-label{
  margin:0;font-size:10.5px;font-weight:500;letter-spacing:.14em;
  text-transform:uppercase;color:#B8860B;
}
.yt-count{
  font-size:10.5px;font-weight:500;letter-spacing:.12em;
  color:rgba(255,248,231,.40);font-variant-numeric:tabular-nums;
}
.yt-rule{height:1px;background:rgba(255,255,255,.08);margin:10px 0 14px}

.yt-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;list-style:none;margin:0;padding:0}

/* Kept tags are yellow glass: a yellow tint over a white base, blurred,
   with a hairline and a top light. Filled yellow stays with the CTA. */
.yt-chip{
  display:inline-flex;align-items:center;overflow:hidden;
  height:44px;max-width:320px;padding-left:16px;border-radius:999px;
  background:linear-gradient(180deg,rgba(255,214,10,.16),rgba(255,214,10,.12)),rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.22);
  color:#FFD60A;
  font-size:13.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;
  /* 'backwards', not 'both' — once the entrance has played the chip must
     hand opacity/transform back so the removal transition can win. */
  animation:yt-pop 320ms cubic-bezier(.32,.72,0,1) backwards;
  animation-delay:var(--yt-d,0ms);
  transition:max-width ${REMOVE_MS}ms cubic-bezier(.4,0,1,1),
             opacity ${REMOVE_MS}ms ease,
             transform ${REMOVE_MS}ms cubic-bezier(.4,0,1,1),
             padding ${REMOVE_MS}ms cubic-bezier(.4,0,1,1),
             margin ${REMOVE_MS}ms cubic-bezier(.4,0,1,1);
}
.yt-chip[data-leaving="true"]{
  max-width:0;padding-left:0;opacity:0;transform:scale(.7);margin-right:-8px;
}
/* Full 44×44 target. The chip clips overflow for the collapse, so the
   focus ring is inset rather than offset — an outside ring would be cut. */
.yt-x{
  display:flex;align-items:center;justify-content:center;
  width:44px;height:44px;padding:0;border:0;background:transparent;
  color:rgba(255,214,10,.55);cursor:pointer;flex:none;
  transition:color 160ms ease, transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
.yt-x:hover{color:#FFD60A}
.yt-x:active{transform:scale(.88)}
.yt-x:focus-visible{outline:2px solid #FFD60A;outline-offset:-4px;border-radius:999px;color:#FFD60A}

.yt-empty{
  margin:0;font-size:12.5px;color:rgba(255,248,231,.40);padding:2px 0;
}

.yt-addrow{display:flex;align-items:center;gap:8px;margin-top:12px}
.yt-input{
  flex:1;min-width:0;height:44px;padding:0 16px;
  background:rgba(255,255,255,.045);border:0;border-radius:14px;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),inset 0 1px 0 rgba(255,255,255,.05);
  color:#FFF8E7;font-size:15px;letter-spacing:-.01em;
  transition:background 200ms cubic-bezier(.32,.72,0,1),
             box-shadow 200ms cubic-bezier(.32,.72,0,1);
}
.yt-input::placeholder{color:rgba(255,248,231,.26)}
.yt-input:focus{
  outline:none;background:rgba(255,214,10,.07);
  box-shadow:inset 0 0 0 1px rgba(255,214,10,.42),inset 0 1px 0 rgba(255,255,255,.05);
}
.yt-add{
  flex:none;width:44px;height:44px;border-radius:999px;border:0;
  background:linear-gradient(180deg,rgba(255,214,10,.16),rgba(255,214,10,.12)),rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.22);
  color:#FFD60A;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:background 180ms ease,box-shadow 180ms ease,
             transform 120ms cubic-bezier(.32,.72,0,1),opacity 180ms ease;
  -webkit-tap-highlight-color:transparent;
}
.yt-add:hover:not(:disabled){
  background:linear-gradient(180deg,rgba(255,214,10,.24),rgba(255,214,10,.18)),rgba(255,255,255,.07);
}
.yt-add:active:not(:disabled){transform:scale(.9)}
.yt-add:disabled{
  background:rgba(255,255,255,.045);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);
  -webkit-backdrop-filter:none;backdrop-filter:none;
  color:rgba(255,248,231,.26);cursor:default;
}
.yt-add:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}

.yt-sugtitle{
  font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(184,134,11,.85);margin:16px 0 8px;
}
.yt-sugs{display:flex;flex-wrap:wrap;gap:8px}
/* Cold state of the same grammar: quiet outline, no fill. ::after lifts
   the 40px pill to a 44px target without loosening the row rhythm. */
.yt-sug{
  position:relative;display:inline-flex;align-items:center;
  height:40px;padding:0 15px;border-radius:999px;cursor:pointer;
  border:0;background:transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);
  color:rgba(255,248,231,.62);font-size:13px;font-weight:500;letter-spacing:-.008em;
  white-space:nowrap;
  animation:yt-pop 260ms cubic-bezier(.32,.72,0,1) backwards;
  transition:background 170ms ease,box-shadow 170ms ease,color 170ms ease,
             transform 120ms cubic-bezier(.32,.72,0,1);
  -webkit-tap-highlight-color:transparent;
}
.yt-sug::after{content:'';position:absolute;inset:-2px 0}
/* Hover previews the material the chip will get once it's kept. */
.yt-sug:hover{
  background:linear-gradient(180deg,rgba(255,214,10,.16),rgba(255,214,10,.12)),rgba(255,255,255,.05);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.22);
  color:#FFD60A;
}
.yt-sug:active{transform:scale(.97)}
.yt-sug:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}

.yt-notice{
  font-size:12.5px;line-height:1.4;color:rgba(255,214,10,.9);margin:10px 0 0;min-height:1em;
  animation:yt-fade 240ms ease backwards;
}

@keyframes yt-pop{
  from{opacity:0;transform:scale(.82) translateY(4px)}
  to{opacity:1;transform:scale(1) translateY(0)}
}
@keyframes yt-fade{from{opacity:0}to{opacity:1}}

/* No backdrop-filter (older Firefox): raise the fill so nothing turns
   into see-through soup. */
@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){
  .yt-chip,.yt-add,.yt-sug:hover{background:rgba(60,48,10,.85)}
  .yt-add:hover:not(:disabled){background:rgba(76,61,14,.9)}
}

@media (prefers-reduced-motion: reduce){
  .yt-chip,.yt-sug,.yt-notice{animation-duration:1ms;animation-delay:0ms}
  .yt-chip{transition-duration:1ms}
  .yt-x:active,.yt-add:active:not(:disabled),.yt-sug:active{transform:none}
}
`}</style>
  );
}

/* ------------------------------------------------------------------ */

interface TagGroupProps {
  label: string;
  helper: string;
  placeholder: string;
  tags: string[];
  vocab: string[];
  max: number;
  stagger: boolean;
  onTagsChange: (next: string[]) => void;
}

function TagGroup({
  label,
  helper,
  placeholder,
  tags,
  vocab,
  max,
  stagger,
  onTagsChange,
}: TagGroupProps) {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [leaving, setLeaving] = useState<string[]>([]);

  /* Removal is deferred by REMOVE_MS so the collapse can play, which means
     the commit must read the *latest* tags rather than the ones captured
     when the × was clicked — otherwise removing two chips inside one
     animation window resurrects the first. */
  const tagsRef = useRef(tags);
  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  const timers = useRef<number[]>([]);
  const track = useCallback((id: number) => {
    timers.current.push(id);
  }, []);
  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    },
    [],
  );

  const say = useCallback(
    (message: string) => {
      setNotice(message);
      track(
        window.setTimeout(
          () => setNotice((current) => (current === message ? '' : current)),
          NOTICE_MS,
        ),
      );
    },
    [track],
  );

  const full = tags.length >= max;

  const addTag = useCallback(
    (raw: string) => {
      const value = canonicalize(normalize(raw), vocab);
      if (!value) return;
      const current = tagsRef.current;
      if (has(current, value)) {
        setDraft('');
        say(`You already have ${value}.`);
        return;
      }
      if (current.length >= max) {
        say(`${max} is the max here — remove one to make room.`);
        return;
      }
      setDraft('');
      setNotice('');
      onTagsChange([...current, value]);
    },
    [max, onTagsChange, say, vocab],
  );

  const removeTag = useCallback(
    (tag: string) => {
      setNotice('');
      setLeaving((current) =>
        current.includes(tag) ? current : [...current, tag],
      );
      track(
        window.setTimeout(() => {
          onTagsChange(tagsRef.current.filter((entry) => entry !== tag));
          setLeaving((current) => current.filter((entry) => entry !== tag));
        }, REMOVE_MS),
      );
    },
    [onTagsChange, track],
  );

  /* Suggestions stay visible by default (not only while typing) so the
     canonical vocabulary is the path of least resistance. */
  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    return vocab
      .filter((entry) => !has(tags, entry))
      .filter((entry) => !query || entry.toLowerCase().includes(query))
      .slice(0, SUGGESTION_COUNT);
  }, [draft, tags, vocab]);

  const canAddDraft = normalize(draft).length > 0;

  return (
    <section className="yt-group" style={{ fontFamily: SANS }}>
      <div className="yt-head">
        <h3 className="yt-label" style={{ fontFamily: MONO }}>
          {label}
        </h3>
        <span className="yt-count" style={{ fontFamily: MONO }}>
          {tags.length}/{max}
        </span>
      </div>
      <div className="yt-rule" aria-hidden="true" />

      <ul className="yt-chips">
        {tags.map((tag, index) => (
          <li
            key={tag}
            className="yt-chip"
            data-leaving={leaving.includes(tag)}
            style={{
              ['--yt-d' as string]:
                stagger && index < STAGGER_LIMIT ? `${index * 45}ms` : '0ms',
            }}
          >
            {tag}
            <button
              type="button"
              className="yt-x"
              aria-label={`Remove ${tag}`}
              onClick={() => removeTag(tag)}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1.9 1.9 10.1 10.1 M10.1 1.9 1.9 10.1"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {tags.length === 0 ? (
        <p className="yt-empty">Nothing here yet. Add at least one below.</p>
      ) : null}

      <div className="yt-addrow">
        <label htmlFor={inputId} style={srOnly}>
          {helper}
        </label>
        <input
          id={inputId}
          className="yt-input"
          type="text"
          value={draft}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={MAX_TAG_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addTag(draft);
          }}
        />
        <button
          type="button"
          className="yt-add"
          disabled={!canAddDraft}
          aria-label={`Add ${label.toLowerCase()} tag`}
          onClick={() => addTag(draft)}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 3.4v11.2M3.4 9h11.2"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {suggestions.length > 0 && !full ? (
        <>
          <p className="yt-sugtitle" style={{ fontFamily: MONO }}>
            {draft.trim() ? 'Matching' : 'Popular'}
          </p>
          <div className="yt-sugs">
            {suggestions.map((entry) => (
              <button
                key={entry}
                type="button"
                className="yt-sug"
                onClick={() => addTag(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p className="yt-notice" role="status" aria-live="polite">
        {notice}
      </p>
    </section>
  );
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

export default function TagEditor({
  softSkills,
  interests,
  onChange,
  vocab = TAG_VOCAB,
  maxPerGroup = DEFAULT_MAX,
}: TagEditorProps) {
  /* Chips fan in on first paint. Once that's played out, tags added by
     hand should appear immediately rather than waiting their turn. */
  const [stagger, setStagger] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setStagger(false), 900);
    return () => window.clearTimeout(id);
  }, []);

  const max = Math.max(1, maxPerGroup);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <TagEditorStyles />

      <TagGroup
        label="Soft skills"
        helper="Add a soft skill"
        placeholder="Add a soft skill…"
        tags={softSkills}
        vocab={vocab.softSkills ?? []}
        max={max}
        stagger={stagger}
        onTagsChange={(next) => onChange({ softSkills: next, interests })}
      />

      <TagGroup
        label="Interests"
        helper="Add an interest"
        placeholder="Add an interest…"
        tags={interests}
        vocab={vocab.interests ?? []}
        max={max}
        stagger={stagger}
        onTagsChange={(next) => onChange({ softSkills, interests: next })}
      />
    </div>
  );
}

export { TagEditor };
