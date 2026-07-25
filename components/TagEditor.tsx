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

const DEFAULT_MAX = 8;
const MAX_TAG_LENGTH = 28;
const SUGGESTION_COUNT = 6;
/* Must stay in sync with the `.yt-chip` transition duration below —
   the DOM node is kept alive exactly long enough to play the collapse. */
const REMOVE_MS = 190;
const NOTICE_MS = 2600;

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
  /** Ceiling per group. Defaults to 8. */
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
  font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#B8860B;
}
.yt-count{
  font-size:10px;letter-spacing:.12em;color:rgba(184,134,11,.7);
  font-variant-numeric:tabular-nums;
}
.yt-rule{height:1px;background:linear-gradient(90deg,rgba(184,134,11,.42),rgba(184,134,11,0));margin:8px 0 12px}

.yt-chips{display:flex;flex-wrap:wrap;gap:7px;align-items:flex-start;list-style:none;margin:0;padding:0}

.yt-chip{
  display:inline-flex;align-items:center;overflow:hidden;
  height:31px;max-width:300px;padding-left:12px;border-radius:999px;
  background:#FFD60A;color:#0B0A08;
  font-size:13px;font-weight:600;letter-spacing:-.012em;white-space:nowrap;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.42), 0 2px 12px rgba(255,214,10,.16);
  /* 'backwards', not 'both' — once the entrance has played the chip must
     hand opacity/transform back so the removal transition can win. */
  animation:yt-pop 320ms cubic-bezier(.22,1,.36,1) backwards;
  animation-delay:var(--yt-d,0ms);
  transition:max-width ${REMOVE_MS}ms cubic-bezier(.4,0,1,1),
             opacity ${REMOVE_MS}ms ease,
             transform ${REMOVE_MS}ms cubic-bezier(.4,0,1,1),
             padding ${REMOVE_MS}ms cubic-bezier(.4,0,1,1),
             margin ${REMOVE_MS}ms cubic-bezier(.4,0,1,1);
}
.yt-chip[data-leaving="true"]{
  max-width:0;padding-left:0;opacity:0;transform:scale(.7);margin-right:-7px;
}
.yt-x{
  display:flex;align-items:center;justify-content:center;
  width:26px;height:31px;margin-left:1px;border:0;background:transparent;
  color:rgba(11,10,8,.5);cursor:pointer;flex:none;
  transition:color 160ms ease, transform 160ms ease;
  -webkit-tap-highlight-color:transparent;
}
.yt-x:hover{color:#0B0A08;transform:scale(1.18)}
.yt-x:focus-visible{outline:2px solid #0B0A08;outline-offset:-3px;border-radius:999px;color:#0B0A08}

.yt-empty{
  font-size:12.5px;color:rgba(255,248,231,.34);padding:5px 0 1px;
}

.yt-addrow{display:flex;align-items:center;gap:8px;margin-top:12px}
.yt-input{
  flex:1;min-width:0;height:34px;padding:0 12px;
  background:rgba(255,248,231,.045);
  border:1px solid rgba(184,134,11,.3);border-radius:999px;
  color:#FFF8E7;font-size:13.5px;letter-spacing:-.01em;
  transition:border-color 200ms ease, background 200ms ease;
}
.yt-input::placeholder{color:rgba(255,248,231,.3)}
.yt-input:focus{outline:none;border-color:rgba(255,214,10,.75);background:rgba(255,214,10,.05)}
.yt-add{
  flex:none;width:34px;height:34px;border-radius:999px;
  border:1px solid rgba(184,134,11,.4);background:transparent;color:#FFD60A;
  font-size:17px;line-height:1;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:background 180ms ease, border-color 180ms ease, transform 180ms ease;
  -webkit-tap-highlight-color:transparent;
}
.yt-add:hover:not(:disabled){background:rgba(255,214,10,.13);border-color:rgba(255,214,10,.7)}
.yt-add:active:not(:disabled){transform:scale(.9)}
.yt-add:disabled{opacity:.32;cursor:default}
.yt-add:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}

.yt-sugtitle{
  font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;
  color:rgba(184,134,11,.8);margin:13px 0 7px;
}
.yt-sugs{display:flex;flex-wrap:wrap;gap:6px}
.yt-sug{
  height:28px;padding:0 12px;border-radius:999px;cursor:pointer;
  border:1px dashed rgba(184,134,11,.55);background:transparent;
  color:rgba(255,248,231,.78);font-size:12.5px;font-weight:500;letter-spacing:-.008em;
  white-space:nowrap;
  animation:yt-pop 260ms cubic-bezier(.22,1,.36,1) backwards;
  transition:background 170ms ease,border-color 170ms ease,color 170ms ease,transform 170ms ease;
  -webkit-tap-highlight-color:transparent;
}
.yt-sug:hover{
  background:rgba(255,214,10,.12);border-color:rgba(255,214,10,.85);
  color:#FFD60A;border-style:solid;
}
.yt-sug:active{transform:scale(.93)}
.yt-sug:focus-visible{outline:2px solid #FFD60A;outline-offset:2px}

.yt-notice{
  font-size:12px;color:#FFC300;margin-top:9px;min-height:1em;
  animation:yt-fade 240ms ease backwards;
}

@keyframes yt-pop{
  from{opacity:0;transform:scale(.82) translateY(4px)}
  to{opacity:1;transform:scale(1) translateY(0)}
}
@keyframes yt-fade{from{opacity:0}to{opacity:1}}

@media (prefers-reduced-motion: reduce){
  .yt-chip,.yt-sug,.yt-notice{animation-duration:1ms;animation-delay:0ms}
  .yt-chip{transition-duration:1ms}
  .yt-x:hover,.yt-add:active,.yt-sug:active{transform:none}
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
            style={{ ['--yt-d' as string]: stagger ? `${index * 45}ms` : '0ms' }}
          >
            {tag}
            <button
              type="button"
              className="yt-x"
              aria-label={`Remove ${tag}`}
              onClick={() => removeTag(tag)}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 11 11"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1.5 1.5 L9.5 9.5 M9.5 1.5 L1.5 9.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
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
          +
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
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
