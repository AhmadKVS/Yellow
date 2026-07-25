'use client';

/**
 * One hub — the shared workspace.
 *
 * The list screen answers "which projects am I in"; this answers "what is
 * happening in this one". A feed of updates and questions, a task list with
 * deadlines, and the roster that decides who can see any of it.
 *
 * Next 16: `params` is a Promise, read with React's `use()`.
 *
 * Fail-soft throughout. Every loader returns instead of throwing, an
 * unreachable table renders an honest empty state, and no fetch here can block
 * the store's `hydrated` flag or the rest of the app.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Bubble from '@/components/Bubble';
import { rankMatches } from '@/lib/match';
import { useAppState } from '@/lib/store';
import {
  createHubPost,
  createHubTask,
  deleteHubItem,
  dueLabel,
  fetchHubItems,
  posts as sortPosts,
  relativeTime,
  tasks as sortTasks,
  updateHubItem,
  type HubItem,
  type HubPost,
  type HubTask,
  type PostKind,
  type TaskStatus,
} from '@/lib/hubs';
import type { Profile, SeedPersona } from '@/lib/types';
import {
  CoverageRow,
  EMOJI_FONT,
  Eyebrow,
  FILL_VIEWPORT,
  HubStyles,
  MemberStack,
  MONO,
  SANS,
} from '../_ui';

/** How often an open hub re-reads its workspace. */
const ITEMS_POLL_MS = 6_000;

type PersonIndex = ReadonlyMap<string, Profile>;

/** todo → doing → done → todo. One control, no dropdown. */
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: 'doing',
  doing: 'done',
  done: 'todo',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};

/** `<input type="date">` speaks local-midnight ISO; DynamoDB stores epoch ms. */
function dateToMs(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59`);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export default function HubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const {
    state,
    people,
    peopleSource,
    hubs,
    hubsSource,
    myId,
    addHubMember,
    removeHubMember,
    leaveHub,
    deleteHub,
  } = useAppState();

  const [items, setItems] = useState<HubItem[]>([]);
  const [itemsReady, setItemsReady] = useState(false);
  const [itemsOk, setItemsOk] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Bumped by a mutation to make the workspace effect re-read immediately. */
  const [reloadKey, setReloadKey] = useState(0);
  const itemsSigRef = useRef('');
  const mountedRef = useRef(true);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const me = state.me ?? null;
  const mine = useMemo(
    () => new Set([myId, me?.id].filter(Boolean) as string[]),
    [myId, me?.id],
  );

  const hub = useMemo(() => hubs.find((h) => h.hubId === id) ?? null, [hubs, id]);
  const owned = Boolean(hub && mine.has(hub.ownerId));

  const personIndex: PersonIndex = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of people) map.set(p.id, p);
    if (me) {
      for (const own of mine) map.set(own, me);
    }
    return map;
  }, [people, me, mine]);

  const members = useMemo(
    () =>
      (hub?.memberIds ?? [])
        .map((memberId) => personIndex.get(memberId))
        .filter((p): p is Profile => Boolean(p)),
    [hub?.memberIds, personIndex],
  );

  /* Only people you've actually unlocked can join a hub. */
  const connectedPeople = useMemo(() => {
    const entries = Object.entries(state.connections ?? {});
    return entries
      .filter(([, c]) => c?.stage === 'connected')
      .map(([personId]) => people.find((p) => p.id === personId))
      .filter((p): p is SeedPersona => Boolean(p));
  }, [state.connections, people]);

  const memberSet = useMemo(
    () => new Set(hub?.memberIds ?? []),
    [hub?.memberIds],
  );
  const addable = connectedPeople.filter((p) => !memberSet.has(p.id));

  /* ---------------------------------------------------------------- */
  /* Workspace — polled, and never allowed to throw                    */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let active = true;

    const load = async () => {
      // Never throws, never hangs past its own timeout.
      const result = await fetchHubItems(id);
      if (!active || !mountedRef.current) return;

      if (!result.ok) {
        // A failed read is not permission to forget the whole workspace —
        // keep whatever is on screen and say so quietly.
        setItemsOk(false);
        setItemsReady(true);
        return;
      }

      const signature = JSON.stringify(result.items);
      if (signature !== itemsSigRef.current) {
        itemsSigRef.current = signature;
        setItems(result.items);
      }
      setItemsOk(true);
      setItemsReady(true);
    };

    void load();

    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      void load();
    };
    const poll = setInterval(tick, ITEMS_POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);

    return () => {
      active = false;
      clearInterval(poll);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
    // `reloadKey` is the point: a mutation bumps it so the workspace re-reads
    // straight away instead of waiting out the poll.
  }, [id, reloadKey]);

  const feed = useMemo(() => sortPosts(items), [items]);
  const taskList = useMemo(() => sortTasks(items), [items]);
  const openTasks = taskList.filter((t) => t.status !== 'done').length;

  /* ---------------------------------------------------------------- */
  /* Mutations — write through, then re-read. Never optimistic: a hub  */
  /* is shared, so the row is the only place it is true.               */
  /* ---------------------------------------------------------------- */

  const settle = () => {
    if (mountedRef.current) setBusy(false);
    reload();
  };

  const runPost = async (text: string, postKind: PostKind) => {
    setBusy(true);
    await createHubPost(id, { text, postKind });
    settle();
  };

  const runTask = async (input: {
    title: string;
    assigneeId?: string;
    dueAt?: number;
  }) => {
    setBusy(true);
    await createHubTask(id, input);
    settle();
  };

  const advance = async (task: HubTask) => {
    setBusy(true);
    await updateHubItem(id, task.itemId, { status: NEXT_STATUS[task.status] });
    settle();
  };

  const assign = async (task: HubTask, assigneeId: string) => {
    setBusy(true);
    await updateHubItem(id, task.itemId, { assigneeId: assigneeId || null });
    settle();
  };

  const removeItem = async (item: HubItem) => {
    setBusy(true);
    await deleteHubItem(id, item.itemId);
    settle();
  };

  /* ---------------------------------------------------------------- */
  /* Loading + not-found                                               */
  /* ---------------------------------------------------------------- */

  if (!state.hydrated || peopleSource === 'loading' || hubsSource === 'loading') {
    return (
      <div
        className="flex w-full flex-col items-center justify-center"
        style={{ minHeight: FILL_VIEWPORT }}
      >
        <HubStyles />
        <span
          aria-hidden
          className="animate-pulse"
          style={{
            width: 40,
            height: 40,
            borderRadius: 9999,
            background: 'radial-gradient(circle at 34% 26%, #FFE45C 0%, #FFC300 76%)',
            boxShadow: '0 0 28px rgba(255,214,10,.4)',
            opacity: 0.55,
          }}
        />
        <p style={{ marginTop: 18 }}>
          <Eyebrow>Opening the hub</Eyebrow>
        </p>
      </div>
    );
  }

  if (!hub) {
    return (
      <div
        className="flex w-full flex-col items-center justify-center text-center"
        style={{ minHeight: FILL_VIEWPORT }}
      >
        <HubStyles />
        <h1
          style={{
            fontFamily: SANS,
            fontSize: 21,
            fontWeight: 620,
            letterSpacing: '-0.026em',
            color: '#FFF8E7',
            margin: 0,
          }}
        >
          {hubsSource === 'unavailable'
            ? "Can't reach your hubs right now"
            : "This hub isn't yours to open"}
        </h1>
        <p
          style={{
            fontFamily: SANS,
            fontSize: 14,
            lineHeight: 1.55,
            color: 'rgba(255,248,231,.5)',
            margin: '10px 0 0',
            maxWidth: 300,
          }}
        >
          {hubsSource === 'unavailable'
            ? 'Nothing is lost — try again in a moment.'
            : 'It may have been deleted, or you may have left it.'}
        </p>
        <Link
          href="/hubs"
          className="y-hb-pill y-hb-quiet"
          style={{ fontFamily: SANS, marginTop: 22, textDecoration: 'none' }}
        >
          Back to hubs
        </Link>
      </div>
    );
  }

  const owner = personIndex.get(hub.ownerId);
  const ownerFirstName = owner ? owner.name.trim().split(/\s+/)[0] : null;

  return (
    <div className="flex w-full flex-col pb-10" style={{ minHeight: FILL_VIEWPORT }}>
      <HubStyles />

      {/* ---------------- Header ---------------- */}
      <header className="shrink-0 pb-5 pt-6">
        <Link
          href="/hubs"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'rgba(255,248,231,.4)',
            textDecoration: 'none',
          }}
        >
          <span aria-hidden>←</span> All hubs
        </Link>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13, marginTop: 14 }}>
          <span className="y-hb-tile">
            <span aria-hidden style={{ fontFamily: EMOJI_FONT, fontSize: 22, lineHeight: 1 }}>
              {hub.emoji || '🚀'}
            </span>
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            {!owned ? (
              <p style={{ margin: '0 0 4px' }}>
                <Eyebrow tone="gold">
                  {ownerFirstName ? `${ownerFirstName} added you` : 'You were added to this'}
                </Eyebrow>
              </p>
            ) : null}
            <h1
              style={{
                fontFamily: SANS,
                fontSize: 23,
                fontWeight: 660,
                letterSpacing: '-0.028em',
                lineHeight: 1.16,
                color: '#FFF8E7',
                margin: 0,
              }}
            >
              {hub.name}
            </h1>
            {hub.oneLiner ? (
              <p
                style={{
                  fontFamily: SANS,
                  fontSize: 13.5,
                  lineHeight: 1.45,
                  color: 'rgba(255,248,231,.5)',
                  margin: '5px 0 0',
                }}
              >
                {hub.oneLiner}
              </p>
            ) : null}
          </div>
        </div>

        {/* Who is in the room, and what they cover between them.
            "Just you so far" is exactly the moment someone wants to fix it,
            so the invite control sits right here rather than further down. */}
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 9,
            }}
          >
            <MemberStack members={members} />
            <Eyebrow tone={hub.memberIds.length > 1 ? 'gold' : 'dim'}>
              {hub.memberIds.length > 1
                ? `You + ${hub.memberIds.length - 1}`
                : 'Just you so far'}
              {openTasks > 0 ? ` · ${openTasks} open` : ''}
            </Eyebrow>

            {/* Owner-only: the API enforces the same rule, so a control here
                for anyone else would just be a button that 403s. */}
            {owned ? (
              <AddPeople
                hubName={hub.name}
                addable={addable}
                connectedCount={connectedPeople.length}
                roomEmpty={people.length === 0}
                disabled={busy}
                onAdd={async (personId) => {
                  setBusy(true);
                  // Refreshes the shared hub, so the avatars, the count and
                  // the coverage line all move together with no reload.
                  await addHubMember(id, personId);
                  if (mountedRef.current) setBusy(false);
                }}
              />
            ) : null}
          </div>

          {members.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <CoverageRow
                members={members}
                limit={6}
                total={hub.memberIds.length}
              />
            </div>
          ) : null}
        </div>
      </header>

      {/* ---------------- Feed ---------------- */}
      <section style={{ marginTop: 4 }}>
        <Eyebrow>Updates</Eyebrow>
        <Composer disabled={busy} onSubmit={runPost} />

        {!itemsReady ? (
          <p style={{ margin: '16px 0 0' }}>
            <Eyebrow>Reading the room</Eyebrow>
          </p>
        ) : !itemsOk ? (
          <p
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: 'rgba(255,248,231,.44)',
              margin: '16px 0 0',
            }}
          >
            Couldn&rsquo;t load this hub&rsquo;s updates just now. Nothing is
            lost — it&rsquo;ll reappear on the next refresh.
          </p>
        ) : feed.length === 0 ? (
          <p
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: 'rgba(255,248,231,.44)',
              margin: '16px 0 0',
            }}
          >
            Nothing posted yet. Say where the project stands, or ask the room
            something you&rsquo;re stuck on.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: '16px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
            }}
          >
            {feed.map((post) => (
              <li key={post.itemId}>
                <PostRow
                  post={post}
                  author={personIndex.get(post.authorId) ?? null}
                  isMine={mine.has(post.authorId)}
                  canRemove={mine.has(post.authorId) || owned}
                  disabled={busy}
                  onDelete={() => void removeItem(post)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- Tasks ---------------- */}
      <section style={{ marginTop: 30 }}>
        <Eyebrow>Tasks &amp; deadlines</Eyebrow>
        <TaskComposer disabled={busy} members={members} onSubmit={runTask} />

        {taskList.length === 0 ? (
          <p
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: 'rgba(255,248,231,.44)',
              margin: '14px 0 0',
            }}
          >
            No tasks yet. Anyone in the hub can add one and move it along.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: '14px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            {taskList.map((task) => (
              <li key={task.itemId}>
                <TaskRow
                  task={task}
                  members={members}
                  assignee={
                    task.assigneeId ? (personIndex.get(task.assigneeId) ?? null) : null
                  }
                  canRemove={mine.has(task.createdBy) || owned}
                  disabled={busy}
                  onAdvance={() => void advance(task)}
                  onAssign={(value) => void assign(task, value)}
                  onDelete={() => void removeItem(task)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- Roster ---------------- */}
      <Roster
        hubName={hub.name}
        owned={owned}
        me={me}
        mine={mine}
        members={members}
        disabled={busy}
        onRemove={async (personId) => {
          setBusy(true);
          await removeHubMember(id, personId);
          if (mountedRef.current) setBusy(false);
        }}
        onLeave={async () => {
          setBusy(true);
          await leaveHub(id);
          router.push('/hubs');
        }}
        onDelete={async () => {
          setBusy(true);
          await deleteHub(id);
          router.push('/hubs');
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Invite — sits in the members row, where "just you so far" is         */
/*                                                                     */
/* Deliberately quiet: a small pill inline with the avatars rather than */
/* a full-width CTA, so it doesn't compete with Post and Add task.      */
/* Owner-only, matching the API rule — a control that always 403s is    */
/* worse than no control.                                              */
/* ------------------------------------------------------------------ */
function AddPeople({
  hubName,
  addable,
  connectedCount,
  roomEmpty,
  disabled,
  onAdd,
}: {
  hubName: string;
  /** Connected people not already in the hub. */
  addable: SeedPersona[];
  connectedCount: number;
  /** Nobody else has signed up yet — a different problem to "not connected". */
  roomEmpty: boolean;
  disabled: boolean;
  onAdd: (personId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="y-hb-pill"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ fontFamily: SANS, height: 28, padding: '0 11px', fontSize: 12 }}
      >
        <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
          +
        </span>
        {open ? 'Done' : 'Add people'}
      </button>

      {open ? (
        <div
          className="y-hb-rise"
          style={{
            flexBasis: '100%',
            marginTop: 4,
            padding: '12px 13px',
            borderRadius: 14,
            border: '1px solid rgba(255,214,10,.18)',
            background: 'rgba(255,214,10,.035)',
          }}
        >
          {/* Every empty case says something. A blank picker reads as broken,
             and on a fresh account blank is the state you actually hit. */}
          {roomEmpty ? (
            <p
              style={{
                fontFamily: SANS,
                fontSize: 13,
                lineHeight: 1.55,
                color: 'rgba(255,248,231,.5)',
                margin: 0,
              }}
            >
              Nobody else has joined Yellow yet. The room is yours for now — as
              people sign up and you trade intros, they&rsquo;ll be addable here.
            </p>
          ) : connectedCount === 0 ? (
            <p
              style={{
                fontFamily: SANS,
                fontSize: 13,
                lineHeight: 1.55,
                color: 'rgba(255,248,231,.5)',
                margin: 0,
              }}
            >
              You can only add people you&rsquo;ve unlocked with a mutual intro.{' '}
              <Link
                href="/home"
                style={{
                  color: '#FFD60A',
                  textDecoration: 'none',
                  fontWeight: 600,
                  borderBottom: '1px solid rgba(255,214,10,.35)',
                }}
              >
                Go make a connection
              </Link>{' '}
              and they&rsquo;ll show up here.
            </p>
          ) : addable.length === 0 ? (
            <p
              style={{
                fontFamily: SANS,
                fontSize: 13,
                lineHeight: 1.55,
                color: 'rgba(255,248,231,.5)',
                margin: 0,
              }}
            >
              Everyone you&rsquo;re connected to is already in this hub.{' '}
              <Link
                href="/home"
                style={{
                  color: '#FFD60A',
                  textDecoration: 'none',
                  fontWeight: 600,
                  borderBottom: '1px solid rgba(255,214,10,.35)',
                }}
              >
                Meet someone new
              </Link>
              .
            </p>
          ) : (
            <>
              <Eyebrow>Connected people</Eyebrow>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 9,
                }}
              >
                {addable.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="y-hb-add"
                    disabled={disabled}
                    onClick={() => void onAdd(p.id)}
                    style={{ fontFamily: SANS }}
                    aria-label={`Add ${p.name} to ${hubName}`}
                  >
                    <Bubble
                      profile={p}
                      size={26}
                      prominence={0.45}
                      interactive={false}
                      showLabel={false}
                    />
                    {p.name}
                    <span
                      aria-hidden
                      style={{
                        fontSize: 14,
                        lineHeight: 1,
                        color: '#FFD60A',
                        marginLeft: 1,
                      }}
                    >
                      +
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Composer — an update, or a question                                  */
/* ------------------------------------------------------------------ */
function Composer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string, kind: PostKind) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<PostKind>('update');

  const valid = text.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || disabled) return;
    const value = text.trim();
    setText('');
    await onSubmit(value, kind);
  };

  return (
    <form onSubmit={submit} style={{ marginTop: 9 }}>
      <textarea
        className="y-hb-area"
        style={{ fontFamily: SANS }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        maxLength={1000}
        placeholder={
          kind === 'question'
            ? 'What are you stuck on?'
            : 'Where does the project stand today?'
        }
        aria-label={kind === 'question' ? 'Ask the hub a question' : 'Post an update'}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginTop: 9,
        }}
      >
        <span className="y-hb-seg">
          <button
            type="button"
            aria-pressed={kind === 'update'}
            onClick={() => setKind('update')}
            style={{ fontFamily: SANS }}
          >
            Update
          </button>
          <button
            type="button"
            aria-pressed={kind === 'question'}
            onClick={() => setKind('question')}
            style={{ fontFamily: SANS }}
          >
            Question
          </button>
        </span>

        <button
          type="submit"
          className="y-hb-pill"
          disabled={!valid || disabled}
          style={{ fontFamily: SANS }}
        >
          {kind === 'question' ? 'Ask' : 'Post'}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* One post                                                             */
/* ------------------------------------------------------------------ */
function PostRow({
  post,
  author,
  isMine,
  canRemove,
  disabled,
  onDelete,
}: {
  post: HubPost;
  author: Profile | null;
  isMine: boolean;
  canRemove: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  const question = post.postKind === 'question';

  return (
    <article className={`y-hb-post${question ? ' y-hb-post-q' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {author ? (
          <Bubble
            profile={author}
            size={26}
            prominence={0.5}
            interactive={false}
            showLabel={false}
          />
        ) : (
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              borderRadius: 9999,
              background: 'rgba(255,248,231,.1)',
              display: 'inline-block',
            }}
          />
        )}

        <span
          style={{
            fontFamily: SANS,
            fontSize: 13.5,
            fontWeight: 620,
            letterSpacing: '-0.012em',
            color: 'rgba(255,248,231,.92)',
          }}
        >
          {isMine ? 'You' : (author?.name ?? 'Someone in this hub')}
        </span>

        {question ? (
          <span
            className="y-hb-chip y-hb-chip-shared"
            style={{ fontFamily: SANS, height: 20, fontSize: 10.5 }}
          >
            Question
          </span>
        ) : null}

        <span style={{ flex: 1 }} />

        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            color: 'rgba(255,248,231,.3)',
            whiteSpace: 'nowrap',
          }}
        >
          {relativeTime(post.createdAt)}
        </span>

        {canRemove ? (
          <button
            type="button"
            className="y-hb-x"
            aria-label="Delete this post"
            disabled={disabled}
            onClick={onDelete}
            style={{ width: 24, height: 24 }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M1 1l8 8M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
      </div>

      <p
        style={{
          fontFamily: SANS,
          fontSize: 14,
          lineHeight: 1.55,
          letterSpacing: '-0.006em',
          color: question ? '#FFF8E7' : 'rgba(255,248,231,.82)',
          margin: '9px 0 0',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {post.text}
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Task composer                                                        */
/* ------------------------------------------------------------------ */
function TaskComposer({
  disabled,
  members,
  onSubmit,
}: {
  disabled: boolean;
  members: Profile[];
  onSubmit: (input: {
    title: string;
    assigneeId?: string;
    dueAt?: number;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');

  const valid = title.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || disabled) return;
    const dueAt = dateToMs(due);
    const payload = {
      title: title.trim(),
      ...(assignee ? { assigneeId: assignee } : {}),
      ...(dueAt !== null ? { dueAt } : {}),
    };
    setTitle('');
    setAssignee('');
    setDue('');
    await onSubmit(payload);
  };

  return (
    <form onSubmit={submit} style={{ marginTop: 9 }}>
      <input
        className="y-hb-input"
        style={{ fontFamily: SANS }}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={disabled}
        maxLength={120}
        placeholder="Add a task — what needs doing?"
        aria-label="Task title"
        autoComplete="off"
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginTop: 9,
        }}
      >
        <select
          className="y-hb-select"
          style={{ fontFamily: SANS }}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          disabled={disabled}
          aria-label="Assign to"
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          className="y-hb-date"
          style={{ fontFamily: SANS }}
          value={due}
          onChange={(e) => setDue(e.target.value)}
          disabled={disabled}
          aria-label="Due date"
        />

        <span style={{ flex: 1 }} />

        <button
          type="submit"
          className="y-hb-pill"
          disabled={!valid || disabled}
          style={{ fontFamily: SANS }}
        >
          Add task
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* One task                                                             */
/* ------------------------------------------------------------------ */
function TaskRow({
  task,
  members,
  assignee,
  canRemove,
  disabled,
  onAdvance,
  onAssign,
  onDelete,
}: {
  task: HubTask;
  members: Profile[];
  assignee: Profile | null;
  canRemove: boolean;
  disabled: boolean;
  onAdvance: () => void;
  onAssign: (assigneeId: string) => void;
  onDelete: () => void;
}) {
  const due = typeof task.dueAt === 'number' ? dueLabel(task.dueAt) : null;
  const late = task.status !== 'done' && due?.tone === 'overdue';

  const cls = [
    'y-hb-task',
    task.status === 'done' ? 'y-hb-task-done' : '',
    task.status === 'doing' ? 'y-hb-task-doing' : '',
    late ? 'y-hb-task-late' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <button
        type="button"
        className={`y-hb-check${
          task.status === 'done'
            ? ' y-hb-check-done'
            : task.status === 'doing'
              ? ' y-hb-check-doing'
              : ''
        }`}
        disabled={disabled}
        onClick={onAdvance}
        aria-label={`${STATUS_LABEL[task.status]} — mark as ${
          STATUS_LABEL[NEXT_STATUS[task.status]]
        }`}
        title={`${STATUS_LABEL[task.status]} → ${STATUS_LABEL[NEXT_STATUS[task.status]]}`}
      >
        {task.status === 'done' ? (
          <svg width="11" height="9" viewBox="0 0 11 9" aria-hidden>
            <path
              d="M1 4.6L4 7.6L10 1.4"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : null}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontFamily: SANS,
            fontSize: 14,
            lineHeight: 1.4,
            letterSpacing: '-0.008em',
            color: 'rgba(255,248,231,.9)',
            margin: 0,
            textDecoration: task.status === 'done' ? 'line-through' : 'none',
            overflowWrap: 'anywhere',
          }}
        >
          {task.title}
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            marginTop: 7,
          }}
        >
          <select
            className="y-hb-select"
            style={{ fontFamily: SANS, height: 28, fontSize: 12 }}
            value={task.assigneeId ?? ''}
            onChange={(e) => onAssign(e.target.value)}
            disabled={disabled}
            aria-label={`Assignee for ${task.title}`}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          {assignee ? (
            <Bubble
              profile={assignee}
              size={20}
              prominence={0.45}
              interactive={false}
              showLabel={false}
            />
          ) : null}

          {due ? (
            <span
              className={
                task.status === 'done'
                  ? ''
                  : due.tone === 'overdue'
                    ? 'y-hb-warn'
                    : due.tone === 'soon'
                      ? 'y-hb-soon'
                      : ''
              }
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color:
                  task.status === 'done' || due.tone === 'calm'
                    ? 'rgba(255,248,231,.36)'
                    : undefined,
              }}
            >
              {due.text}
            </span>
          ) : null}

          <span
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,248,231,.28)',
            }}
          >
            {STATUS_LABEL[task.status]}
          </span>
        </div>
      </div>

      {canRemove ? (
        <button
          type="button"
          className="y-hb-x"
          aria-label={`Delete ${task.title}`}
          disabled={disabled}
          onClick={onDelete}
          style={{ width: 24, height: 24 }}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M1 1l8 8M9 1L1 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roster — who can see any of this                                     */
/* ------------------------------------------------------------------ */
function Roster({
  hubName,
  owned,
  me,
  mine,
  members,
  disabled,
  onRemove,
  onLeave,
  onDelete,
}: {
  hubName: string;
  owned: boolean;
  me: Profile | null;
  mine: ReadonlySet<string>;
  members: Profile[];
  disabled: boolean;
  onRemove: (personId: string) => Promise<void>;
  onLeave: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* How much each member overlaps with you — the same scoring the bubble map
     uses, so the hub agrees with the orbit that put you two together. */
  const overlap = useMemo(() => {
    if (!me) return new Map<string, number>();
    const others = members.filter((m) => !mine.has(m.id));
    if (others.length === 0) return new Map<string, number>();
    const ranked = rankMatches(me, others as SeedPersona[]);
    return new Map(ranked.map((r) => [r.person.id, r.score]));
  }, [me, members, mine]);

  return (
    <section style={{ marginTop: 30 }}>
      <Eyebrow>In this hub</Eyebrow>

      <ul
        style={{
          listStyle: 'none',
          margin: '10px 0 0',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {members.map((p) => {
          const isMe = mine.has(p.id);
          const score = overlap.get(p.id) ?? 0;
          return (
            <li
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '5px 0',
              }}
            >
              <Bubble
                profile={p}
                size={32}
                prominence={0.55}
                interactive={false}
                showLabel={false}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontFamily: SANS,
                    fontSize: 14,
                    fontWeight: 600,
                    letterSpacing: '-0.012em',
                    color: 'rgba(255,248,231,.92)',
                  }}
                >
                  {isMe ? 'You' : p.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontFamily: SANS,
                    fontSize: 12,
                    lineHeight: 1.35,
                    color: 'rgba(255,248,231,.38)',
                    marginTop: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {!isMe && score > 0
                    ? `${p.tagline} · you overlap ${score}`
                    : p.tagline}
                </span>
              </span>

              {owned && !isMe ? (
                <button
                  type="button"
                  className="y-hb-x"
                  aria-label={`Remove ${p.name} from ${hubName}`}
                  disabled={disabled}
                  onClick={() => void onRemove(p.id)}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    <path
                      d="M1 1l8 8M9 1L1 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Exit */}
      <div style={{ marginTop: 26, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {owned ? (
          confirmDelete ? (
            <>
              <button
                type="button"
                className="y-hb-pill y-hb-danger"
                disabled={disabled}
                onClick={() => void onDelete()}
                style={{ fontFamily: SANS }}
              >
                Delete for everyone
              </button>
              <button
                type="button"
                className="y-hb-pill y-hb-quiet"
                onClick={() => setConfirmDelete(false)}
                style={{ fontFamily: SANS }}
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              className="y-hb-pill y-hb-quiet"
              onClick={() => setConfirmDelete(true)}
              style={{ fontFamily: SANS }}
            >
              Delete hub
            </button>
          )
        ) : (
          <button
            type="button"
            className="y-hb-pill y-hb-quiet"
            disabled={disabled}
            onClick={() => void onLeave()}
            style={{ fontFamily: SANS }}
          >
            Leave hub
          </button>
        )}
      </div>
    </section>
  );
}
