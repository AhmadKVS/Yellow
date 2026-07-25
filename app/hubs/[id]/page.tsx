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
import { initialsFor } from '@/lib/initials';
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
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconClose,
  IconPlus,
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

/** Left to right, the way the work actually travels. */
const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'doing', label: 'In progress' },
  { status: 'done', label: 'Done' },
];

/** An empty column still has to say which kind of empty it is. */
const EMPTY_COLUMN: Record<TaskStatus, string> = {
  todo: 'Nothing queued.',
  doing: 'Nothing in flight.',
  done: 'Nothing finished yet.',
};

/** The MIME type the board drags cards under. */
const CARD_MIME = 'application/x-yellow-card';

/** `<input type="date">` speaks local-midnight ISO; DynamoDB stores epoch ms. */
function dateToMs(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59`);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** A native select wearing quiet mono instrumentation, with an SVG caret. */
function QuietMenu({
  value,
  onChange,
  disabled,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="y-hb-menu-wrap">
      <select
        className="y-hb-menu"
        style={{ fontFamily: MONO }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
      >
        {children}
      </select>
      <i>
        <IconChevronDown />
      </i>
    </span>
  );
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
  /**
   * Optimistic column for a card that has been moved but whose write hasn't
   * come back around through the poll yet. An entry is cleared the moment a
   * fetch agrees with it — or immediately, snapping the card back, if the
   * PATCH failed. Without it the card would jump home for one poll cycle.
   */
  const [moving, setMoving] = useState<Record<string, TaskStatus>>({});
  const itemsSigRef = useRef('');
  const mountedRef = useRef(true);
  /** A refresh landing mid-drag must not yank the card out from under it. */
  const draggingRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);

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

      // Mid-drag, the board belongs to the pointer. The next poll picks it up.
      if (draggingRef.current) return;

      const signature = JSON.stringify(result.items);
      if (signature !== itemsSigRef.current) {
        itemsSigRef.current = signature;
        setItems(result.items);
      }
      // An optimistic column the server now agrees with has done its job.
      setMoving((prev) => {
        let next = prev;
        for (const item of result.items) {
          if (item.kind === 'task' && next[item.itemId] === item.status) {
            if (next === prev) next = { ...prev };
            delete next[item.itemId];
          }
        }
        return next;
      });
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

  /** Where each card sits right now — the optimistic column wins. */
  const columnOf = useCallback(
    (task: HubTask): TaskStatus => moving[task.itemId] ?? task.status,
    [moving],
  );

  const board = useMemo(() => {
    const cols: Record<TaskStatus, HubTask[]> = { todo: [], doing: [], done: [] };
    for (const task of taskList) cols[moving[task.itemId] ?? task.status].push(task);
    return cols;
  }, [taskList, moving]);

  const openTasks = board.todo.length + board.doing.length;

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

  const runTask = async (
    status: TaskStatus,
    input: { title: string; assigneeId?: string; dueAt?: number },
  ) => {
    setBusy(true);
    const created = await createHubTask(id, input);
    // The create endpoint always opens a card in "To do", so a card added to
    // another column is one existing call followed by another. If the second
    // one fails the card simply lands in To do — nothing is lost.
    if (created && created.kind === 'task' && status !== 'todo') {
      await updateHubItem(id, created.itemId, { status });
    }
    settle();
  };

  /**
   * Move a card between columns. Optimistic on purpose: a board that waits a
   * round trip before the card lands doesn't feel like a board. `busy` stays
   * untouched so the rest of the workspace keeps responding mid-move.
   */
  const move = async (task: HubTask, status: TaskStatus) => {
    if ((moving[task.itemId] ?? task.status) === status) return;
    setMoving((prev) => ({ ...prev, [task.itemId]: status }));

    const updated = await updateHubItem(id, task.itemId, { status });
    if (!mountedRef.current) return;

    if (!updated) {
      // Snap back. Fail-soft: the board reverts, nothing shouts.
      setMoving((prev) => {
        const next = { ...prev };
        delete next[task.itemId];
        return next;
      });
      return;
    }
    // The write is authoritative; a poll that hasn't caught up yet must not be
    // able to overwrite it, so the optimistic entry stays until one agrees.
    reload();
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
            width: 36,
            height: 36,
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
        <h1 className="y-hb-h2" style={{ fontFamily: SANS, maxWidth: 320 }}>
          {hubsSource === 'unavailable'
            ? "Can't reach your hubs right now"
            : "This hub isn't yours to open"}
        </h1>
        <p
          className="y-hb-body"
          style={{ fontFamily: SANS, margin: '10px 0 0', maxWidth: 300 }}
        >
          {hubsSource === 'unavailable'
            ? 'Nothing is lost — try again in a moment.'
            : 'It may have been deleted, or you may have left it.'}
        </p>
        <Link
          href="/hubs"
          className="y-hb-plain y-hb-plain-hair"
          style={{ fontFamily: SANS, marginTop: 22 }}
        >
          Back to hubs
        </Link>
      </div>
    );
  }

  const owner = personIndex.get(hub.ownerId);
  const ownerFirstName = owner ? owner.name.trim().split(/\s+/)[0] : null;

  return (
    <div className="flex w-full flex-col pb-12" style={{ minHeight: FILL_VIEWPORT }}>
      <HubStyles />

      {/* ---------------- Header ---------------- */}
      <header className="shrink-0 pb-6 pt-5">
        <Link
          href="/hubs"
          className="y-hb-plain"
          style={{
            fontFamily: SANS,
            marginLeft: -12,
            paddingLeft: 10,
            paddingRight: 14,
            fontSize: 14,
          }}
        >
          <IconChevronLeft size={14} />
          All hubs
        </Link>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            marginTop: 12,
          }}
        >
          <span className="y-hb-tile y-hb-tile-lg">
            <span
              aria-hidden
              style={{ fontFamily: EMOJI_FONT, fontSize: 25, lineHeight: 1 }}
            >
              {hub.emoji || '🚀'}
            </span>
          </span>

          <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
            <h1
              className="y-hb-title"
              style={{ fontFamily: SANS, fontSize: 25, letterSpacing: '-0.028em' }}
            >
              {hub.name}
            </h1>
            {hub.oneLiner ? (
              <p
                className="y-hb-sub"
                style={{ fontFamily: SANS, margin: '6px 0 0', color: 'rgba(255,248,231,.5)' }}
              >
                {hub.oneLiner}
              </p>
            ) : null}
            {!owned ? (
              <p style={{ margin: '9px 0 0' }}>
                <span className="y-hb-chip y-hb-chip-tint" style={{ fontFamily: SANS }}>
                  {ownerFirstName ? `Invited by ${ownerFirstName}` : 'You were invited'}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        {/* Who is in the room, and what they cover between them.
            "Just you so far" is exactly the moment someone wants to fix it,
            so the invite control sits right here rather than further down. */}
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <MemberStack members={members} />
            <span className="y-hb-mono" style={{ fontFamily: MONO }}>
              {hub.memberIds.length > 1
                ? `You + ${hub.memberIds.length - 1}`
                : 'Just you so far'}
              {openTasks > 0 ? ` · ${openTasks} open` : ''}
            </span>

            <span style={{ flex: 1 }} />

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
            <div style={{ marginTop: 12 }}>
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
      <section>
        <p style={{ margin: '0 0 10px', paddingLeft: 2 }}>
          <Eyebrow>Updates</Eyebrow>
        </p>
        <Composer disabled={busy} onSubmit={runPost} />

        {!itemsReady ? (
          <p style={{ margin: '18px 0 0', paddingLeft: 2 }}>
            <Eyebrow>Reading the room</Eyebrow>
          </p>
        ) : !itemsOk ? (
          <p
            className="y-hb-sub"
            style={{ fontFamily: SANS, margin: '18px 0 0', paddingLeft: 2 }}
          >
            Couldn&rsquo;t load this hub&rsquo;s updates just now. Nothing is lost —
            it&rsquo;ll reappear on the next refresh.
          </p>
        ) : feed.length === 0 ? (
          <p
            className="y-hb-sub"
            style={{ fontFamily: SANS, margin: '18px 0 0', paddingLeft: 2 }}
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
              gap: 10,
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

      {/* ---------------- Board ---------------- */}
      <section style={{ marginTop: 34 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
            margin: '0 0 11px',
            paddingLeft: 2,
          }}
        >
          <Eyebrow>Board</Eyebrow>
          <span className="y-hb-mono" style={{ fontFamily: MONO }}>
            {taskList.length === 0
              ? 'No cards yet'
              : `${openTasks} open of ${taskList.length}`}
          </span>
        </div>

        <div className="y-hb-board">
          <div className="y-hb-cols">
            {COLUMNS.map((column) => (
              <Column
                key={column.status}
                status={column.status}
                label={column.label}
                tasks={board[column.status]}
                members={members}
                personIndex={personIndex}
                mine={mine}
                owned={owned}
                disabled={busy}
                dragId={dragId}
                over={overColumn === column.status}
                onDragStart={(itemId) => {
                  draggingRef.current = itemId;
                  setDragId(itemId);
                }}
                onDragEnd={() => {
                  draggingRef.current = null;
                  setDragId(null);
                  setOverColumn(null);
                }}
                onDragOver={() => setOverColumn(column.status)}
                onDragLeave={() =>
                  setOverColumn((current) =>
                    current === column.status ? null : current,
                  )
                }
                onDrop={(itemId) => {
                  draggingRef.current = null;
                  setDragId(null);
                  setOverColumn(null);
                  const task = taskList.find((t) => t.itemId === itemId);
                  if (task) void move(task, column.status);
                }}
                columnOf={columnOf}
                onAdvance={(task) =>
                  void move(task, NEXT_STATUS[columnOf(task)])
                }
                onAssign={(task, value) => void assign(task, value)}
                onDelete={(task) => void removeItem(task)}
                onAdd={(input) => runTask(column.status, input)}
              />
            ))}
          </div>
        </div>

        {taskList.length === 0 ? (
          <p
            className="y-hb-sub"
            style={{ fontFamily: SANS, margin: '14px 0 0', paddingLeft: 2 }}
          >
            No cards yet. Anyone in the hub can add one and move it along.
          </p>
        ) : null}
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
/* Deliberately quiet: a tinted pill inline with the avatars rather     */
/* than a full-width CTA, so it doesn't compete with Post and Add task. */
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
        className="y-hb-pill y-hb-pill-sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ fontFamily: SANS }}
      >
        {open ? null : <IconPlus size={13} />}
        {open ? 'Done' : 'Add people'}
      </button>

      {open ? (
        <div
          className="y-hb-panel y-hb-rise"
          style={{ flexBasis: '100%', marginTop: 6 }}
        >
          {/* Every empty case says something. A blank picker reads as broken,
             and on a fresh account blank is the state you actually hit. */}
          {roomEmpty ? (
            <p className="y-hb-sub" style={{ fontFamily: SANS, lineHeight: 1.55 }}>
              Nobody else has joined Yellow yet. The room is yours for now — as
              people sign up and you trade intros, they&rsquo;ll be addable here.
            </p>
          ) : connectedCount === 0 ? (
            <p className="y-hb-sub" style={{ fontFamily: SANS, lineHeight: 1.55 }}>
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
            <p className="y-hb-sub" style={{ fontFamily: SANS, lineHeight: 1.55 }}>
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
                  marginTop: 11,
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
                      size={28}
                      prominence={0.45}
                      interactive={false}
                      showLabel={false}
                    />
                    {p.name}
                    <i>
                      <IconPlus size={13} />
                    </i>
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
    <form onSubmit={submit}>
      <div className="y-hb-field">
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
          className="y-hb-field-split"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '10px 10px 10px 12px',
          }}
        >
          <span className="y-hb-seg" data-at={kind === 'question' ? '1' : '0'}>
            <span className="y-hb-seg-thumb" aria-hidden />
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
            className="y-hb-pill y-hb-pill-sm"
            disabled={!valid || disabled}
            style={{ fontFamily: SANS, minWidth: 74 }}
          >
            {kind === 'question' ? 'Ask' : 'Post'}
          </button>
        </div>
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
              background: 'rgba(255,255,255,.08)',
              display: 'inline-block',
            }}
          />
        )}

        <span
          style={{
            fontFamily: SANS,
            fontSize: 13.5,
            fontWeight: 600,
            letterSpacing: '-0.012em',
            color: '#FFF8E7',
          }}
        >
          {isMine ? 'You' : (author?.name ?? 'Someone in this hub')}
        </span>

        {question ? (
          <span className="y-hb-chip y-hb-chip-tint" style={{ fontFamily: SANS }}>
            Question
          </span>
        ) : null}

        <span style={{ flex: 1 }} />

        <span
          className="y-hb-mono"
          style={{ fontFamily: MONO, whiteSpace: 'nowrap', fontSize: 10.5 }}
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
            <IconClose size={10} />
          </button>
        ) : null}
      </div>

      <p
        style={{
          fontFamily: SANS,
          fontSize: 15,
          lineHeight: 1.5,
          letterSpacing: '-0.006em',
          color: question ? '#FFF8E7' : 'rgba(255,248,231,.84)',
          margin: '10px 0 0',
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
/* A face on a card — photo, or the initials that stand in for one      */
/* ------------------------------------------------------------------ */
function Face({ person, size = 20 }: { person: Profile; size?: number }) {
  /* A 20px disc is decoration, so the photo is a background rather than an
     `<img>`: `cover` crops it exactly like `object-fit` would, and it can't
     be dragged out of the card mid-drag. Quotes are stripped because the URL
     is being interpolated into CSS, not into an attribute. */
  const photo = person.photoUrl?.trim().replace(/["'()\\\s]/g, '');
  const letters = initialsFor(person.name);
  const [from, to] = person.gradient ?? ['#FFD860', '#B8860B'];

  return (
    <span
      aria-hidden
      className="y-hb-face"
      style={{
        width: size,
        height: size,
        backgroundImage: photo
          ? `url("${photo}")`
          : `radial-gradient(circle at 34% 26%, rgba(255,255,255,.45) 0%, rgba(255,255,255,0) 52%), linear-gradient(150deg, ${from}, ${to})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {photo ? null : (
        <span
          style={{
            fontFamily: SANS,
            fontSize: Math.round(size * (letters.length > 1 ? 0.32 : 0.4)),
            fontWeight: 600,
            letterSpacing: '0.02em',
            lineHeight: 1,
            color: '#FFF8E7',
            textShadow: '0 1px 2px rgba(0,0,0,.3)',
          }}
        >
          {letters}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* One board column                                                     */
/*                                                                     */
/* Trello's shape, Yellow's material: a near-opaque surface panel, not  */
/* glass. Glass is for chrome — a stack of task titles is something you */
/* read, and nothing legible sits on a blur.                            */
/*                                                                     */
/* Two ways to move a card, on purpose. Drag is the pointer path and    */
/* the one that feels like a board; the status control on every card is */
/* the one that works on a phone, from a keyboard, and in a screen      */
/* reader. Neither is a fallback for the other.                         */
/* ------------------------------------------------------------------ */
function Column({
  status,
  label,
  tasks,
  members,
  personIndex,
  mine,
  owned,
  disabled,
  dragId,
  over,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  columnOf,
  onAdvance,
  onAssign,
  onDelete,
  onAdd,
}: {
  status: TaskStatus;
  label: string;
  tasks: HubTask[];
  members: Profile[];
  personIndex: PersonIndex;
  mine: ReadonlySet<string>;
  owned: boolean;
  disabled: boolean;
  /** The card currently under the pointer, if any. */
  dragId: string | null;
  /** True while a drag is hovering this column. */
  over: boolean;
  onDragStart: (itemId: string) => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (itemId: string) => void;
  columnOf: (task: HubTask) => TaskStatus;
  onAdvance: (task: HubTask) => void;
  onAssign: (task: HubTask, assigneeId: string) => void;
  onDelete: (task: HubTask) => void;
  onAdd: (input: {
    title: string;
    assigneeId?: string;
    dueAt?: number;
  }) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);

  /* A card dragged onto the column it already lives in would be a no-op, so
     it gets no landing strip and no tint — the board never promises a move
     it isn't going to make. */
  const landing =
    over && dragId !== null && !tasks.some((t) => t.itemId === dragId);

  /** Only our own cards are droppable, and saying so sets the cursor. */
  const accept = (e: React.DragEvent): boolean => {
    if (!Array.from(e.dataTransfer.types).includes(CARD_MIME)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return true;
  };

  return (
    <section
      className="y-hb-col"
      data-over={landing}
      aria-label={`${label}, ${tasks.length} ${tasks.length === 1 ? 'card' : 'cards'}`}
      onDragEnter={(e) => {
        if (accept(e)) onDragOver();
      }}
      onDragOver={(e) => {
        if (accept(e)) onDragOver();
      }}
      onDragLeave={(e) => {
        // Crossing into a child of this column is not leaving it.
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        onDragLeave();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const moved =
          e.dataTransfer.getData(CARD_MIME) || e.dataTransfer.getData('text/plain');
        if (moved) onDrop(moved);
        else onDragEnd();
      }}
    >
      <div className="y-hb-colhead">
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <Eyebrow tone={status === 'doing' ? 'gold' : 'dim'}>{label}</Eyebrow>
          <span
            className="y-hb-count"
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: 'rgba(255,248,231,.3)',
            }}
          >
            · {tasks.length}
          </span>
        </span>
      </div>

      {tasks.map((task) => (
        <TaskCard
          key={task.itemId}
          task={task}
          status={columnOf(task)}
          members={members}
          assignee={task.assigneeId ? (personIndex.get(task.assigneeId) ?? null) : null}
          /* The API lets the creator or the hub owner delete a card; a × that
             always 403s is worse than no ×. */
          canRemove={mine.has(task.createdBy) || owned}
          disabled={disabled}
          dragging={dragId === task.itemId}
          onDragStart={() => onDragStart(task.itemId)}
          onDragEnd={onDragEnd}
          onAdvance={() => onAdvance(task)}
          onAssign={(value) => onAssign(task, value)}
          onDelete={() => onDelete(task)}
        />
      ))}

      {landing ? <div className="y-hb-kdrop" aria-hidden /> : null}

      {tasks.length === 0 && !landing && !adding ? (
        <p className="y-hb-kempty" style={{ fontFamily: SANS }}>
          {EMPTY_COLUMN[status]}
        </p>
      ) : null}

      {adding ? (
        <ColumnComposer
          label={label}
          members={members}
          disabled={disabled}
          onCancel={() => setAdding(false)}
          onSubmit={onAdd}
        />
      ) : (
        <button
          type="button"
          className="y-hb-kadd"
          disabled={disabled}
          onClick={() => setAdding(true)}
          style={{ fontFamily: SANS }}
          aria-label={`Add a card to ${label}`}
        >
          <IconPlus size={13} />
          Add a card
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One card                                                             */
/* ------------------------------------------------------------------ */
function TaskCard({
  task,
  status,
  members,
  assignee,
  canRemove,
  disabled,
  dragging,
  onDragStart,
  onDragEnd,
  onAdvance,
  onAssign,
  onDelete,
}: {
  task: HubTask;
  /** Where the card sits right now — the optimistic column, mid-move. */
  status: TaskStatus;
  members: Profile[];
  assignee: Profile | null;
  canRemove: boolean;
  disabled: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onAdvance: () => void;
  onAssign: (assigneeId: string) => void;
  onDelete: () => void;
}) {
  const done = status === 'done';
  const due = typeof task.dueAt === 'number' ? dueLabel(task.dueAt) : null;
  const late = !done && due?.tone === 'overdue';
  const next = NEXT_STATUS[status];

  /**
   * A pointer that went down on a control is operating that control, not
   * picking the card up. Without this, opening the assignee menu or pressing
   * the status button while the finger moves a pixel starts a drag instead.
   */
  const onControl = useRef(false);

  return (
    <article
      className="y-hb-kcard"
      data-done={done}
      data-dragging={dragging}
      draggable={!disabled}
      onPointerDownCapture={(e) => {
        const target = e.target as HTMLElement | null;
        onControl.current = Boolean(target?.closest('button, select, input, a'));
      }}
      onDragStart={(e) => {
        if (onControl.current || disabled) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(CARD_MIME, task.itemId);
        // Some browsers refuse a drag that carries no standard type.
        e.dataTransfer.setData('text/plain', task.itemId);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      style={{ fontFamily: SANS }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        {/* The keyboard and touch path, and the only one that exists on a
            phone. Never hidden behind a hover. */}
        <button
          type="button"
          className={`y-hb-check${
            done ? ' y-hb-check-done' : status === 'doing' ? ' y-hb-check-doing' : ''
          }`}
          disabled={disabled}
          onClick={onAdvance}
          aria-label={`${task.title} — in ${STATUS_LABEL[status]}. Move to ${STATUS_LABEL[next]}.`}
          title={`Move to ${STATUS_LABEL[next]}`}
        >
          {done ? <IconCheck size={13} /> : null}
        </button>

        <p className="y-hb-ktitle" style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
          {task.title}
        </p>

        {canRemove ? (
          <button
            type="button"
            className="y-hb-x"
            aria-label={`Delete ${task.title}`}
            disabled={disabled}
            onClick={onDelete}
            style={{ marginTop: -1, marginRight: -3 }}
          >
            <IconClose size={10} />
          </button>
        ) : null}
      </div>

      <div className="y-hb-kmeta">
        {assignee ? <Face person={assignee} size={20} /> : null}

        <QuietMenu
          value={task.assigneeId ?? ''}
          onChange={onAssign}
          disabled={disabled}
          label={`Assignee for ${task.title}`}
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </QuietMenu>

        {/* Overdue reads as weight, not hue: the same warm yellow, filled.
            Red would be the only alarm colour in the whole app. */}
        {due && late ? (
          <span
            className="y-hb-chip y-hb-chip-late"
            style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.04em' }}
          >
            {due.text}
          </span>
        ) : due ? (
          <span
            className={`y-hb-mono${!done && due.tone === 'soon' ? ' y-hb-soon' : ''}`}
            style={{ fontFamily: MONO, fontSize: 10.5 }}
          >
            {due.text}
          </span>
        ) : null}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Add a card, in the column you're looking at                          */
/*                                                                     */
/* `POST /api/hubs/[id]/items` always opens a card in To do — that's a  */
/* server rule, not something to work around here. The page turns a     */
/* non-To-do add into create-then-move; if the move fails the card is   */
/* still on the board, one column to the left. Nothing is ever lost to  */
/* a half-finished write.                                               */
/* ------------------------------------------------------------------ */
function ColumnComposer({
  label,
  members,
  disabled,
  onCancel,
  onSubmit,
}: {
  label: string;
  members: Profile[];
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    title: string;
    assigneeId?: string;
    dueAt?: number;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const titleRef = useRef<HTMLInputElement | null>(null);

  const valid = title.trim().length > 0;

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

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
    // Stay open: adding one card is almost never adding only one card. The
    // focus waits a tick because the write leaves the field disabled until
    // React has committed `busy: false`, and a disabled input can't take it.
    setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 0);
  };

  return (
    <form onSubmit={submit} className="y-hb-rise">
      <div className="y-hb-field">
        <input
          ref={titleRef}
          className="y-hb-input"
          style={{ fontFamily: SANS, height: 42, fontSize: 14 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
          disabled={disabled}
          maxLength={120}
          placeholder="What needs doing?"
          aria-label={`New card in ${label}`}
          autoComplete="off"
        />

        <div
          className="y-hb-field-split"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 7,
            padding: '8px 8px 8px 6px',
          }}
        >
          <QuietMenu
            value={assignee}
            onChange={setAssignee}
            disabled={disabled}
            label="Assign to"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </QuietMenu>

          <input
            type="date"
            className="y-hb-date"
            style={{ fontFamily: MONO }}
            value={due}
            onChange={(e) => setDue(e.target.value)}
            disabled={disabled}
            aria-label="Due date"
          />

          <span style={{ flex: 1 }} />

          <button
            type="button"
            className="y-hb-plain y-hb-plain-sm"
            onClick={onCancel}
            style={{ fontFamily: SANS }}
          >
            Done
          </button>
          <button
            type="submit"
            className="y-hb-pill y-hb-pill-sm"
            disabled={!valid || disabled}
            style={{ fontFamily: SANS }}
          >
            Add
          </button>
        </div>
      </div>
    </form>
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
    <section style={{ marginTop: 34 }}>
      <p style={{ margin: '0 0 10px', paddingLeft: 2 }}>
        <Eyebrow>In this hub</Eyebrow>
      </p>

      <ul className="y-hb-group">
        {members.map((p) => {
          const isMe = mine.has(p.id);
          const score = overlap.get(p.id) ?? 0;
          return (
            <li
              key={p.id}
              className="y-hb-row"
              style={{ '--sep': '60px', fontFamily: SANS } as React.CSSProperties}
            >
              <Bubble
                profile={p}
                size={34}
                prominence={0.55}
                interactive={false}
                showLabel={false}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontFamily: SANS,
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: '-0.012em',
                    color: '#FFF8E7',
                  }}
                >
                  {isMe ? 'You' : p.name}
                </span>
                <span
                  className="y-hb-sub y-hb-clip"
                  style={{
                    display: 'block',
                    marginTop: 2,
                    fontSize: 12.5,
                    color: 'rgba(255,248,231,.4)',
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
                  <IconClose size={11} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Exit. Destructive stays quiet — plain text, never an alarm. */}
      <div
        style={{
          marginTop: 18,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {owned ? (
          confirmDelete ? (
            <>
              <button
                type="button"
                className="y-hb-plain y-hb-plain-hair"
                disabled={disabled}
                onClick={() => void onDelete()}
                style={{ fontFamily: SANS }}
              >
                Delete for everyone
              </button>
              <button
                type="button"
                className="y-hb-plain"
                onClick={() => setConfirmDelete(false)}
                style={{ fontFamily: SANS }}
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              className="y-hb-plain"
              onClick={() => setConfirmDelete(true)}
              style={{ fontFamily: SANS, marginLeft: -14 }}
            >
              Delete hub
            </button>
          )
        ) : (
          <button
            type="button"
            className="y-hb-plain"
            disabled={disabled}
            onClick={() => void onLeave()}
            style={{ fontFamily: SANS, marginLeft: -14 }}
          >
            Leave hub
          </button>
        )}
      </div>
    </section>
  );
}
