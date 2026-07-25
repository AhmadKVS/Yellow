'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  AppState,
  Connection,
  ConnectionStage,
  Hub,
  Message,
  Profile,
  SeedPersona,
} from './types';
import {
  FALLBACK_PEOPLE,
  fetchPeople,
  publishProfile,
  resolveDirectoryId,
  resolveIdentity,
  type PeopleSource,
} from './people';
import { fetchPairs, type PairSummary } from './pair';
import { fetchIntro, type VoiceIntro } from './intro';

/* -------------------------------------------------------------------------- */
/* constants                                                                  */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'yellow:v1';

/** How long we sit on mutations before pushing them to DynamoDB. */
const CLOUD_DEBOUNCE_MS = 800;
/** Hard cap on the cloud read during hydration. */
const CLOUD_FETCH_TIMEOUT_MS = 2_500;
/** Absolute safety net — `hydrated` becomes true by this point no matter what. */
const HYDRATE_DEADLINE_MS = 3_500;
/** How often the open app re-reads the directory, so someone who signs up on
 *  another device shows up in your orbit without a reload. */
const PEOPLE_REFRESH_MS = 20_000;
/** How often we re-read the shared pairs. Drives notifications and unread. */
const PAIRS_REFRESH_MS = 8_000;
/** Per-person "how many messages had I seen". View state, never connection state. */
const SEEN_STORAGE_KEY = 'yellow:seen';

/* -------------------------------------------------------------------------- */
/* state shape                                                                */
/* -------------------------------------------------------------------------- */

export type CloudStatus = 'idle' | 'syncing' | 'synced' | 'error';

/**
 * What actually lands in localStorage / DynamoDB. `savedAt` is how we decide
 * whether the cloud copy is newer than the local one. `hydrated` is never
 * meaningful on disk — it is forced on load.
 */
type PersistedState = AppState & { savedAt: number };

interface StoreState {
  app: AppState;
  /** Timestamp of the most recent local mutation. */
  savedAt: number;
  /** Bumped only by real mutations. 0 means "nothing to persist yet". */
  revision: number;
}

export const EMPTY_APP_STATE: AppState = {
  hydrated: false,
  me: null,
  connections: {},
  messages: [],
  hubs: [],
  nudgeDismissed: false,
};

const initialStore: StoreState = {
  app: EMPTY_APP_STATE,
  savedAt: 0,
  revision: 0,
};

/* -------------------------------------------------------------------------- */
/* actions                                                                    */
/* -------------------------------------------------------------------------- */

export type Action =
  | { type: 'HYDRATE'; state: AppState; savedAt?: number }
  | { type: 'READY' }
  | { type: 'SET_PROFILE'; profile: Profile }
  | { type: 'ENSURE_CONNECTION'; personId: string }
  | { type: 'SET_STAGE'; personId: string; stage: ConnectionStage }
  | { type: 'SEND_MY_INTRO'; personId: string }
  | { type: 'RECEIVE_THEIR_INTRO'; personId: string }
  | { type: 'RECONCILE_PAIRS'; pairs: PairSummary[] }
  | { type: 'ADD_MESSAGE'; msg: Message }
  | { type: 'CREATE_HUB'; hub: Hub }
  | { type: 'ADD_HUB_MEMBER'; hubId: string; personId: string }
  | { type: 'REMOVE_HUB_MEMBER'; hubId: string; personId: string }
  | { type: 'DISMISS_NUDGE' }
  | { type: 'RESET' };

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function newConnection(personId: string): Connection {
  return { personId, stage: 'stranger', myIntroSent: false, theirIntroSent: false };
}

/** Returns the existing connection or a fresh 'stranger' one. */
function connectionFor(state: AppState, personId: string): Connection {
  return state.connections[personId] ?? newConnection(personId);
}

/**
 * Applies the "both intros exchanged => connected" promotion rule. If only one
 * side has sent, the pair is waiting on the other, so anything still pre-intro
 * moves to 'intro_pending'.
 */
function promote(connection: Connection): Connection {
  if (connection.myIntroSent && connection.theirIntroSent) {
    return {
      ...connection,
      stage: 'connected',
      connectedAt: connection.connectedAt ?? Date.now(),
    };
  }
  if (connection.stage === 'stranger' || connection.stage === 'nudged') {
    return { ...connection, stage: 'intro_pending' };
  }
  return connection;
}

function withConnection(state: AppState, connection: Connection): AppState {
  return {
    ...state,
    connections: { ...state.connections, [connection.personId]: connection },
  };
}

/* -------------------------------------------------------------------------- */
/* seen-map — view state, deliberately outside the persisted store            */
/* -------------------------------------------------------------------------- */

type SeenMap = Record<string, number>;
type SeenAction =
  | { type: 'HYDRATE'; seen: SeenMap }
  | { type: 'MARK'; personId: string; count: number }
  | { type: 'CLEAR' };

/** Stable identity, so the persist effect can tell "never loaded" from "empty". */
const EMPTY_SEEN: SeenMap = {};

function seenReducer(state: SeenMap, action: SeenAction): SeenMap {
  switch (action.type) {
    case 'HYDRATE':
      return action.seen;
    case 'MARK':
      return state[action.personId] === action.count
        ? state
        : { ...state, [action.personId]: action.count };
    case 'CLEAR':
      return Object.keys(state).length === 0 ? state : {};
    default:
      return state;
  }
}

function sameConnection(one: Connection, two: Connection): boolean {
  return (
    one.stage === two.stage &&
    one.myIntroSent === two.myIntroSent &&
    one.theirIntroSent === two.theirIntroSent &&
    (one.connectedAt ?? 0) === (two.connectedAt ?? 0)
  );
}

/** What a server-side pair means for the local `Connection` mirror. */
function connectionFromSummary(
  summary: PairSummary,
  current: Connection | undefined,
): Connection {
  const stage: ConnectionStage = summary.connectedAt
    ? 'connected'
    : summary.myIntroSent || summary.theirIntroSent
      ? 'intro_pending'
      : // Nothing has happened on the server yet, so a local `nudged` is still
        // the most specific thing anyone knows.
        (current?.stage === 'nudged' ? 'nudged' : 'stranger');

  return {
    personId: summary.personId,
    stage,
    myIntroSent: summary.myIntroSent,
    theirIntroSent: summary.theirIntroSent,
    ...(summary.connectedAt ? { connectedAt: summary.connectedAt } : {}),
  };
}

function newId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through to the cheap id */
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/* -------------------------------------------------------------------------- */
/* reducer                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Pure app-level reducer. Returning the *same object* signals a no-op, which
 * the outer reducer uses to avoid marking the store dirty.
 */
function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_PROFILE':
      return { ...state, me: action.profile };

    case 'ENSURE_CONNECTION': {
      if (state.connections[action.personId]) return state;
      return withConnection(state, newConnection(action.personId));
    }

    case 'SET_STAGE': {
      const current = connectionFor(state, action.personId);
      if (state.connections[action.personId] && current.stage === action.stage) {
        return state;
      }
      const next: Connection = { ...current, stage: action.stage };
      if (action.stage === 'connected' && next.connectedAt === undefined) {
        next.connectedAt = Date.now();
      }
      return withConnection(state, next);
    }

    case 'SEND_MY_INTRO': {
      const current = connectionFor(state, action.personId);
      if (state.connections[action.personId] && current.myIntroSent) return state;
      return withConnection(state, promote({ ...current, myIntroSent: true }));
    }

    case 'RECEIVE_THEIR_INTRO': {
      const current = connectionFor(state, action.personId);
      if (state.connections[action.personId] && current.theirIntroSent) return state;
      return withConnection(state, promote({ ...current, theirIntroSent: true }));
    }

    case 'ADD_MESSAGE': {
      if (state.messages.some((m) => m.id === action.msg.id)) return state;
      return { ...state, messages: [...state.messages, action.msg] };
    }

    /**
     * Server truth wins for connection stage.
     *
     * Two directions. Every pair the server knows about overwrites its local
     * mirror. And every local connection the server has *never heard of* is
     * wound back to `stranger`: those are the fake ones, minted when the
     * connect screen told this browser that the other person had answered.
     * Their messages go with them — they were never delivered to anyone.
     *
     * Only ever called with a list the server actually returned. Reconciling
     * against a failed fetch would delete every real connection.
     */
    case 'RECONCILE_PAIRS': {
      const known = new Set(action.pairs.map((p) => p.personId));
      const connections = { ...state.connections };
      const dropped = new Set<string>();
      let changed = false;

      for (const summary of action.pairs) {
        const current = connections[summary.personId];
        const next = connectionFromSummary(summary, current);
        if (!current || !sameConnection(current, next)) {
          connections[summary.personId] = next;
          changed = true;
        }
      }

      for (const [personId, connection] of Object.entries(state.connections)) {
        if (known.has(personId)) continue;
        const claimsSomething =
          connection.stage === 'connected' ||
          connection.myIntroSent ||
          connection.theirIntroSent;
        if (!claimsSomething) continue;

        connections[personId] = {
          personId,
          stage: 'stranger',
          myIntroSent: false,
          theirIntroSent: false,
        };
        dropped.add(personId);
        changed = true;
      }

      if (!changed) return state;

      const messages = dropped.size
        ? state.messages.filter((m) => !dropped.has(m.personId))
        : state.messages;

      return { ...state, connections, messages };
    }

    case 'CREATE_HUB':
      return { ...state, hubs: [...state.hubs, action.hub] };

    case 'ADD_HUB_MEMBER': {
      let changed = false;
      const hubs = state.hubs.map((hub) => {
        if (hub.id !== action.hubId || hub.memberIds.includes(action.personId)) {
          return hub;
        }
        changed = true;
        return { ...hub, memberIds: [...hub.memberIds, action.personId] };
      });
      return changed ? { ...state, hubs } : state;
    }

    case 'REMOVE_HUB_MEMBER': {
      let changed = false;
      const hubs = state.hubs.map((hub) => {
        if (hub.id !== action.hubId || !hub.memberIds.includes(action.personId)) {
          return hub;
        }
        changed = true;
        return { ...hub, memberIds: hub.memberIds.filter((id) => id !== action.personId) };
      });
      return changed ? { ...state, hubs } : state;
    }

    case 'DISMISS_NUDGE':
      return state.nudgeDismissed ? state : { ...state, nudgeDismissed: true };

    case 'RESET':
      return { ...EMPTY_APP_STATE, hydrated: true };

    default:
      return state;
  }
}

function reducer(store: StoreState, action: Action): StoreState {
  // Lifecycle actions never dirty the store — otherwise a failed hydration
  // would immediately push empty state over a perfectly good cloud row.
  if (action.type === 'HYDRATE') {
    return {
      app: { ...action.state, hydrated: true },
      savedAt: action.savedAt ?? store.savedAt,
      revision: store.revision,
    };
  }

  if (action.type === 'READY') {
    if (store.app.hydrated) return store;
    return { ...store, app: { ...store.app, hydrated: true } };
  }

  const nextApp = appReducer(store.app, action);
  if (nextApp === store.app) return store;

  return { app: nextApp, savedAt: Date.now(), revision: store.revision + 1 };
}

/* -------------------------------------------------------------------------- */
/* storage io (all SSR-guarded)                                               */
/* -------------------------------------------------------------------------- */

function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.me === null || typeof v.me === 'object') &&
    typeof v.connections === 'object' &&
    v.connections !== null &&
    Array.isArray(v.messages) &&
    Array.isArray(v.hubs)
  );
}

/** Fills in anything an older/partial blob is missing. */
function normalize(value: PersistedState): { app: AppState; savedAt: number } {
  return {
    app: {
      hydrated: false,
      me: value.me ?? null,
      connections: value.connections ?? {},
      messages: Array.isArray(value.messages) ? value.messages : [],
      hubs: Array.isArray(value.hubs) ? value.hubs : [],
      nudgeDismissed: value.nudgeDismissed === true,
    },
    savedAt: typeof value.savedAt === 'number' ? value.savedAt : 0,
  };
}

function readLocal(): { app: AppState; savedAt: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedState(parsed)) return null;
    return normalize(parsed);
  } catch {
    return null;
  }
}

function writeLocal(blob: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // Quota exceeded / private mode / disabled storage — never fatal.
  }
}

function clearLocal(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function readCloud(
  userId: string,
  signal: AbortSignal,
): Promise<{ app: AppState; savedAt: number } | null> {
  const res = await fetch(`/api/state?userId=${encodeURIComponent(userId)}`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const body: unknown = await res.json();
  const state = (body as { state?: unknown } | null)?.state;
  if (!isPersistedState(state)) return null;
  return normalize(state);
}

function toBlob(app: AppState, savedAt: number): PersistedState {
  return { ...app, hydrated: false, savedAt };
}

/* -------------------------------------------------------------------------- */
/* context                                                                    */
/* -------------------------------------------------------------------------- */

export interface AppStateApi {
  state: AppState;
  /**
   * Everyone else on Yellow, read live from DynamoDB. Never persisted — see
   * the note on the fetch effect. Empty until the directory answers, and
   * legitimately empty when you are the only account.
   */
  people: SeedPersona[];
  peopleSource: PeopleSource | 'loading';
  setProfile(profile: Profile): void;
  ensureConnection(personId: string): void;
  setStage(personId: string, stage: ConnectionStage): void;
  sendMyIntro(personId: string): void;
  receiveTheirIntro(personId: string): void;
  addMessage(msg: Message): void;
  createHub(input: { name: string; emoji: string; oneLiner: string }): string;
  addHubMember(hubId: string, personId: string): void;
  removeHubMember(hubId: string, personId: string): void;
  dismissNudge(): void;
  resetAll(): void;
  cloudStatus: CloudStatus;

  /**
   * The shared connections, read live from the server. Like `people`, these
   * live outside the persisted store and are never written to localStorage or
   * the state row — the server is the only place they are true.
   */
  pairs: PairSummary[];
  pairsLoaded: boolean;
  /** My own recorded intro, reused for everyone who connects with me. */
  myIntro: VoiceIntro | null;
  setMyIntro(intro: VoiceIntro | null): void;
  refreshPairs(): Promise<void>;
  unreadFor(personId: string): number;
  unreadTotal: number;
  markThreadSeen(personId: string): void;
  /** What just happened that the user should be told about. */
  notice: Notice | null;
  dismissNotice(): void;
  /**
   * Suppress the next notice for this person. The screen that *caused* an
   * unlock shows its own celebration; a toast on top of it is noise.
   */
  suppressNotice(personId: string): void;

  /** Escape hatch. Prefer the named helpers above. */
  dispatch: Dispatch<Action>;
}

export interface Notice {
  personId: string;
  kind: 'connected' | 'message';
  at: number;
}

const AppStateContext = createContext<AppStateApi | undefined>(undefined);

/* -------------------------------------------------------------------------- */
/* provider                                                                   */
/* -------------------------------------------------------------------------- */

export function AppStateProvider({ children }: { children: ReactNode }): ReactElement {
  const [store, dispatch] = useReducer(reducer, initialStore);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('idle');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PersistedState | null>(null);
  /** Monotonic guard so a slow POST can't overwrite the status of a newer one. */
  const pushSeqRef = useRef(0);
  const mountedRef = useRef(true);

  /**
   * Who this session is. The Cognito `sub` once auth answers, this browser's
   * UUID otherwise — and it is the DynamoDB key for *this user's* state row,
   * so two accounts can never read or clobber each other's messages.
   * Mirrored into a ref so `pushCloud` can stay referentially stable.
   */
  const [identity, setIdentity] = useState<string | null>(null);
  const identityRef = useRef<string | null>(null);
  const adoptIdentity = useCallback((id: string) => {
    identityRef.current = id;
    setIdentity(id);
  }, []);
  /** Only ever called after identity is settled (writes need a mutation). */
  const currentUserId = useCallback(
    () => identityRef.current ?? resolveDirectoryId(),
    [],
  );

  /* ---------------------------------------------------------------------- */
  /* cloud push                                                             */
  /* ---------------------------------------------------------------------- */

  const pushCloud = useCallback(
    (blob: PersistedState, keepalive = false) => {
      pendingRef.current = null;
      const seq = ++pushSeqRef.current;
      if (mountedRef.current) setCloudStatus('syncing');

      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId(), state: blob }),
        keepalive,
      })
        .then((res) => {
          if (!mountedRef.current || seq !== pushSeqRef.current) return;
          setCloudStatus(res.ok ? 'synced' : 'error');
        })
        .catch(() => {
          // Cloud failures are silent and never block the UI.
          if (!mountedRef.current || seq !== pushSeqRef.current) return;
          setCloudStatus('error');
        });
    },
    [currentUserId],
  );

  /* ---------------------------------------------------------------------- */
  /* hydration — must ALWAYS end with hydrated: true                        */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    mountedRef.current = true;

    const controller = new AbortController();
    // Absolute safety net: whatever happens above, the app un-blocks.
    const deadline = setTimeout(() => {
      controller.abort();
      dispatch({ type: 'READY' });
    }, HYDRATE_DEADLINE_MS);
    const fetchTimeout = setTimeout(() => controller.abort(), CLOUD_FETCH_TIMEOUT_MS);

    // 1. Local first, dispatched synchronously so the UI paints with no flash.
    let localSavedAt = -1;
    try {
      const local = readLocal();
      if (local) {
        localSavedAt = local.savedAt;
        dispatch({ type: 'HYDRATE', state: local.app, savedAt: local.savedAt });
      }
    } catch {
      /* ignore — cloud may still save us, and READY always fires */
    }

    // 2. Identity, then that user's cloud row; adopt only if strictly newer
    //    than what we have. Identity has to come first — reading the wrong
    //    row would hand one account another account's messages.
    void (async () => {
      try {
        const id = await resolveIdentity();
        if (id) adoptIdentity(id);
        const cloud = await readCloud(id || resolveDirectoryId(), controller.signal);
        if (mountedRef.current && cloud && cloud.savedAt > localSavedAt) {
          dispatch({ type: 'HYDRATE', state: cloud.app, savedAt: cloud.savedAt });
        }
      } catch {
        // Offline / aborted / 500 — keep whatever local gave us, silently.
      } finally {
        // 3. Always.
        clearTimeout(fetchTimeout);
        clearTimeout(deadline);
        dispatch({ type: 'READY' });
      }
    })();

    return () => {
      mountedRef.current = false;
      clearTimeout(fetchTimeout);
      clearTimeout(deadline);
      controller.abort();
    };
  }, [adoptIdentity]);

  /* ---------------------------------------------------------------------- */
  /* people directory — live, and deliberately NOT persisted                */
  /*                                                                        */
  /* This lives in plain `useState`, entirely outside the `useReducer` store */
  /* that persistence reads from. `toBlob()` only ever serialises            */
  /* `store.app`, so the directory structurally cannot reach localStorage or */
  /* this user's state row — there is nothing to strip. It also can't        */
  /* trigger a write: the persistence effect below depends on                */
  /* `[store, pushCloud]`, neither of which these setters touch.             */
  /* ---------------------------------------------------------------------- */

  const [people, setPeople] = useState<SeedPersona[]>(FALLBACK_PEOPLE);
  const [peopleSource, setPeopleSource] = useState<PeopleSource | 'loading'>('loading');
  /** Change detector, so a poll returning the same roster doesn't hand out a
   *  fresh array and make every bubble in the field re-lay-out. */
  const peopleSigRef = useRef<string>(JSON.stringify(FALLBACK_PEOPLE));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const load = async (initial: boolean) => {
      // Identity first, every time: asking for the directory before we know
      // who we are would put the user's own bubble in their own orbit. The
      // result is cached module-side, so this costs one request per page.
      const myId = await resolveIdentity();
      if (!active) return;
      if (myId) adoptIdentity(myId);

      // fetchPeople never throws and never hangs past its own timeout.
      const result = await fetchPeople({
        excludeId: myId || resolveDirectoryId(),
        signal: controller.signal,
      });
      if (!active) return;
      // A failed refresh must never wipe a directory we already loaded.
      if (!initial && result.source !== 'dynamodb') return;

      const signature = JSON.stringify(result.people);
      if (signature !== peopleSigRef.current) {
        peopleSigRef.current = signature;
        setPeople(result.people);
      }
      setPeopleSource(result.source);
    };

    void load(true);

    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void load(false);
    };
    const poll = setInterval(refresh, PEOPLE_REFRESH_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      active = false;
      clearInterval(poll);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      controller.abort();
    };
  }, [adoptIdentity]);

  /* ---------------------------------------------------------------------- */
  /* shared pairs — live, and deliberately NOT persisted                    */
  /*                                                                        */
  /* Same treatment as `people` above, and for the same reason: `toBlob()`   */
  /* only serialises `store.app`, so nothing here can reach localStorage or  */
  /* the state row, and none of these setters can bump `revision`. The       */
  /* server is the only place a connection is true.                         */
  /* ---------------------------------------------------------------------- */

  const [pairs, setPairs] = useState<PairSummary[]>([]);
  const [pairsLoaded, setPairsLoaded] = useState(false);
  const [myIntro, setMyIntroState] = useState<VoiceIntro | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const pairsSigRef = useRef('');
  const previousPairsRef = useRef<Map<string, PairSummary> | null>(null);
  const suppressedRef = useRef<Set<string>>(new Set());

  /**
   * How many messages this person had seen per thread. A reducer rather than
   * `useState`, because it hydrates from localStorage inside an effect and a
   * bare `setState` there triggers a cascading render — `dispatch` doesn't.
   */
  const [seen, seenDispatch] = useReducer(seenReducer, EMPTY_SEEN);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        seenDispatch({ type: 'HYDRATE', seen: parsed as Record<string, number> });
      }
    } catch {
      /* an unreadable seen-map just means everything reads as unread */
    }
  }, []);

  useEffect(() => {
    if (seen === EMPTY_SEEN) return;
    try {
      window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(seen));
    } catch {
      /* quota or private mode — unread counts simply don't survive a reload */
    }
  }, [seen]);

  /**
   * Diffs one poll against the last and decides whether to interrupt the user.
   * Never fires on the first load: every existing connection would announce
   * itself as news.
   */
  const raiseNotices = useCallback((next: PairSummary[]) => {
    const previous = previousPairsRef.current;
    const map = new Map(next.map((p) => [p.personId, p]));
    previousPairsRef.current = map;

    if (!previous) return;

    for (const summary of next) {
      const before = previous.get(summary.personId);

      if (summary.connectedAt && !before?.connectedAt) {
        if (suppressedRef.current.delete(summary.personId)) continue;
        setNotice({ personId: summary.personId, kind: 'connected', at: Date.now() });
        return;
      }

      const grew = summary.messageCount > (before?.messageCount ?? 0);
      if (grew && !summary.lastSenderIsMe) {
        setNotice({ personId: summary.personId, kind: 'message', at: Date.now() });
        return;
      }
    }
  }, []);

  const refreshPairs = useCallback(async () => {
    const me = await resolveIdentity();
    const result = await fetchPairs(me || resolveDirectoryId());

    // A failed read is not permission to forget every connection this person
    // has. Only a genuine answer reconciles.
    if (!result.ok || !mountedRef.current) return;

    const signature = JSON.stringify(result.pairs);
    if (signature !== pairsSigRef.current) {
      pairsSigRef.current = signature;
      setPairs(result.pairs);
    }
    raiseNotices(result.pairs);
    dispatch({ type: 'RECONCILE_PAIRS', pairs: result.pairs });
    setPairsLoaded(true);
  }, [raiseNotices]);

  useEffect(() => {
    void refreshPairs();

    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      void refreshPairs();
    };
    const poll = setInterval(tick, PAIRS_REFRESH_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refreshPairs]);

  /* My own intro, so the connect screen can offer it instead of three empty
     recorders. Best-effort: not having it just means recording again. */
  useEffect(() => {
    let active = true;
    void (async () => {
      const me = await resolveIdentity();
      const intro = await fetchIntro(me || resolveDirectoryId());
      if (active && intro) setMyIntroState(intro);
    })();
    return () => {
      active = false;
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* persistence — local sync, cloud debounced                              */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    // revision 0 => nothing has been mutated locally, so there is nothing worth
    // writing. This is what stops a failed hydration from wiping DynamoDB.
    if (store.revision === 0) return;

    const blob = toBlob(store.app, store.savedAt);
    writeLocal(blob);

    // Supersede any in-flight debounce with the newer snapshot.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingRef.current = blob;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      pushCloud(blob);
    }, CLOUD_DEBOUNCE_MS);
  }, [store, pushCloud]);

  // Flush a pending write on unmount so a fast navigate-away still syncs.
  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending) pushCloud(pending, true);
    },
    [pushCloud],
  );

  /* ---------------------------------------------------------------------- */
  /* stable helpers                                                         */
  /* ---------------------------------------------------------------------- */

  const setProfile = useCallback(
    (profile: Profile) => {
      // Stamp our real id onto the profile. Onboarding writes a placeholder;
      // using the identity here is what makes `excludeId` and the connection
      // keys other people see line up with this account.
      const id = currentUserId();
      const owned: Profile = { ...profile, id };
      dispatch({ type: 'SET_PROFILE', profile: owned });

      // Publish into the shared directory so other browsers can discover this
      // person. Strictly fire-and-forget — it can never fail onboarding, and
      // it never touches the persisted state blob.
      try {
        void publishProfile(owned, id);
      } catch {
        /* discovery is best-effort */
      }
    },
    [currentUserId],
  );

  const ensureConnection = useCallback((personId: string) => {
    dispatch({ type: 'ENSURE_CONNECTION', personId });
  }, []);

  const setStage = useCallback((personId: string, stage: ConnectionStage) => {
    dispatch({ type: 'SET_STAGE', personId, stage });
  }, []);

  const sendMyIntro = useCallback((personId: string) => {
    dispatch({ type: 'SEND_MY_INTRO', personId });
  }, []);

  const receiveTheirIntro = useCallback((personId: string) => {
    dispatch({ type: 'RECEIVE_THEIR_INTRO', personId });
  }, []);

  const addMessage = useCallback((msg: Message) => {
    dispatch({ type: 'ADD_MESSAGE', msg });
  }, []);

  const createHub = useCallback(
    (input: { name: string; emoji: string; oneLiner: string }): string => {
      const hub: Hub = {
        id: newId('hub'),
        name: input.name,
        emoji: input.emoji,
        oneLiner: input.oneLiner,
        memberIds: [],
      };
      dispatch({ type: 'CREATE_HUB', hub });
      return hub.id;
    },
    [],
  );

  const addHubMember = useCallback((hubId: string, personId: string) => {
    dispatch({ type: 'ADD_HUB_MEMBER', hubId, personId });
  }, []);

  const removeHubMember = useCallback((hubId: string, personId: string) => {
    dispatch({ type: 'REMOVE_HUB_MEMBER', hubId, personId });
  }, []);

  const dismissNudge = useCallback(() => {
    dispatch({ type: 'DISMISS_NUDGE' });
  }, []);

  const setMyIntro = useCallback((intro: VoiceIntro | null) => {
    setMyIntroState(intro);
  }, []);

  const unreadFor = useCallback(
    (personId: string): number => {
      const summary = pairs.find((p) => p.personId === personId);
      if (!summary) return 0;
      return Math.max(0, summary.messageCount - (seen[personId] ?? 0));
    },
    [pairs, seen],
  );

  const unreadTotal = useMemo(
    () =>
      pairs.reduce(
        (total, p) => total + Math.max(0, p.messageCount - (seen[p.personId] ?? 0)),
        0,
      ),
    [pairs, seen],
  );

  const markThreadSeen = useCallback(
    (personId: string) => {
      const summary = pairs.find((p) => p.personId === personId);
      seenDispatch({ type: 'MARK', personId, count: summary?.messageCount ?? 0 });
    },
    [pairs],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  const suppressNotice = useCallback((personId: string) => {
    suppressedRef.current.add(personId);
  }, []);

  const resetAll = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingRef.current = null;
    clearLocal();
    // Unread is view state, so it resets with the view. Pair rows are not
    // touched: a connection is mutual, and one side clearing their browser
    // must not silently disconnect the other person.
    seenDispatch({ type: 'CLEAR' });
    // Stamp "now" so this empty state beats any stale DynamoDB row on reload.
    pushCloud(toBlob(EMPTY_APP_STATE, Date.now()));
    dispatch({ type: 'RESET' });
  }, [pushCloud]);

  /**
   * Last line of defence against seeing yourself in your own orbit. The route
   * already excludes us server-side, but a row published under an older id
   * (a pre-auth browser UUID, say) would slip through — so drop anything
   * matching either id we answer to.
   */
  const visiblePeople = useMemo(() => {
    const mine = new Set([identity, store.app.me?.id].filter(Boolean) as string[]);
    if (mine.size === 0) return people;
    const filtered = people.filter((p) => !mine.has(p.id));
    return filtered.length === people.length ? people : filtered;
  }, [people, identity, store.app.me?.id]);

  const value = useMemo<AppStateApi>(
    () => ({
      state: store.app,
      people: visiblePeople,
      peopleSource,
      setProfile,
      ensureConnection,
      setStage,
      sendMyIntro,
      receiveTheirIntro,
      addMessage,
      createHub,
      addHubMember,
      removeHubMember,
      dismissNudge,
      resetAll,
      cloudStatus,
      pairs,
      pairsLoaded,
      myIntro,
      setMyIntro,
      refreshPairs,
      unreadFor,
      unreadTotal,
      markThreadSeen,
      notice,
      dismissNotice,
      suppressNotice,
      dispatch,
    }),
    [
      store.app,
      visiblePeople,
      peopleSource,
      setProfile,
      ensureConnection,
      setStage,
      sendMyIntro,
      receiveTheirIntro,
      addMessage,
      createHub,
      addHubMember,
      removeHubMember,
      dismissNudge,
      resetAll,
      cloudStatus,
      pairs,
      pairsLoaded,
      myIntro,
      setMyIntro,
      refreshPairs,
      unreadFor,
      unreadTotal,
      markThreadSeen,
      notice,
      dismissNotice,
      suppressNotice,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateApi {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return ctx;
}
