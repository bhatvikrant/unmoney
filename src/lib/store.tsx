/**
 * The local store: a replica of the user's documents that every screen renders from, a queue
 * of ops applied locally the moment the user acts, and a loop that sends them to Convex
 * whenever the connection is up. See shared/ops.ts for the model.
 *
 * The replica is loaded in full once (a new device, or one too far behind) and from then on kept
 * up to date by one subscription to what changed since the change number it is up to
 * (sync.changes, shared/changes.ts). Opening the app, or saving, reads only what changed.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConvex, useConvexConnectionState, useQuery, type ConvexReactClient } from "convex/react";
import { toast } from "sonner";
import { opLabel } from "./opLabel";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  TABLES, applyOp, emptySnapshot, isTmpId, rewriteIds, tmpIdsIn, type Op, type OpArgs, type OpKind, type OpResult, type Snapshot, type Table,
} from "../../shared/ops";
import { applyChanges } from "../../shared/changes";
import * as local from "./db";
import { SHARE_CACHE } from "./share";
import { clearSafetyCopies } from "./safetyCopy";
import type { Meta, Profile, QueuedOp } from "./db";

export type SyncStatus = {
  /** The websocket to Convex is up. */
  connected: boolean;
  /**
   * Worth telling the user: the browser says there is no network, or the websocket has been down
   * longer than a reconnect takes. False while the app is still connecting after it opens.
   */
  offline: boolean;
  /** The copy has caught up with the server in this session. */
  live: boolean;
  pending: number;
  syncing: boolean;
  lastError: string | null;
};

type Store = {
  ready: boolean;
  hasLocal: boolean;
  userId: string | null;
  user: Profile | null;
  view: Snapshot;
  status: SyncStatus;
  dispatch: <K extends OpKind>(kind: K, args: OpArgs<K>) => Promise<OpResult<K>>;
  /** Like dispatch, and also returns the op's id, for whenSynced. */
  dispatchTracked: <K extends OpKind>(kind: K, args: OpArgs<K>) => Promise<{ id: string; result: OpResult<K> }>;
  /** Resolves once the server has applied or rejected every one of these ops; lists the rejected ones. */
  whenSynced: (opIds: string[]) => Promise<{ rejected: { id: string; error: string }[] }>;
  enqueueUpload: (file: File) => Promise<Id<"_storage">>;
  photoUrl: (id: string) => string | undefined;
  rememberPhotoUrls: (urls: Record<string, string | null>) => void;
  resolveId: <T extends string>(id: T) => T;
  clearLocal: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

const BATCH = 25;
/** Entries per page when a device loads everything; each page is one bounded server read. */
const TX_PAGE = 1000;
/** How long after the last change from the server the local copy is written: one write covers a burst of them. */
const WRITE_DELAY_MS = 1000;
/** How long a sent batch waits for its changes to arrive before it leaves the queue anyway (the subscription may be reloading). */
const ARRIVE_WAIT_MS = 10_000;
/** Before trying a failed full load again. */
const LOAD_RETRY_MS = 5_000;
/** An import or a tidy-up can write hundreds of documents. */
const SEND_ALONE = new Set<OpKind>(["transactions.importRows", "categories.applyCleanup", "categories.undoCleanup", "drafts.acceptMany"]);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
/** An op that writes many documents is sent on its own, so one server transaction stays within Convex's limits. */
const isHeavy = (op: QueuedOp) =>
  SEND_ALONE.has(op.kind) || op.kind === "transactions.restoreRows" || ((op.args as { ids?: unknown[] }).ids?.length ?? 0) > 100;
/** Waits before sending again an op whose send threw (an overload or a deploy, not a rejection); dropped after the last. */
const RETRY_MS = [2_000, 15_000, 60_000];
const isAuthError = (e: unknown) => /not signed in|unauthenticated|authentication/i.test(e instanceof Error ? e.message : String(e));

/**
 * Everything of the signed-in user, read once, with the change number to follow `changes` from.
 * The number is read first: whatever changes while the pages load has a later one, so `changes`
 * brings it even when a page missed it. Null when signed out.
 */
async function loadEverything(convex: ConvexReactClient): Promise<{ rev: number; snapshot: Snapshot } | null> {
  const rev = await convex.query(api.sync.head, {});
  if (rev === null) return null;
  const snapshot = emptySnapshot();
  const rest = TABLES.filter((t) => t !== "transactions");
  const tables = await Promise.all(rest.map((table) => convex.query(api.sync.table, { table })));
  for (const [i, t] of rest.entries()) {
    if (!tables[i]) return null;
    (snapshot as Record<Table, unknown[]>)[t] = tables[i] as unknown[];
  }
  // An entry whose date changed between two pages can be on both: the later page has the newer copy.
  const entries = new Map<string, Doc<"transactions">>();
  let cursor: string | null = null;
  for (;;) {
    const res: { page: Doc<"transactions">[]; isDone: boolean; continueCursor: string } = await convex.query(api.sync.transactionsPage, { paginationOpts: { numItems: TX_PAGE, cursor } });
    for (const t of res.page) entries.set(t._id, t);
    if (res.isDone) break;
    cursor = res.continueCursor;
  }
  snapshot.transactions = [...entries.values()];
  return { rev, snapshot };
}

/** The base snapshot with every queued op replayed on top. Ops that no longer apply are skipped. */
/** How long the websocket may be down before it counts as offline: covers the connect on open and quick reconnects. */
const OFFLINE_GRACE_MS = 4000;

function useOffline(connected: boolean): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  useEffect(() => {
    setStale(false);
    if (connected) return;
    const t = setTimeout(() => setStale(true), OFFLINE_GRACE_MS);
    return () => clearTimeout(t);
  }, [connected]);
  return !connected && (!online || stale);
}

/**
 * The last replay. When the same queue has only grown since (another change made while earlier
 * ones wait to sync, an import's chunks), only the new ops are applied on top of it, instead of
 * every queued op from the base again.
 */
let lastReplay: { base: Snapshot; ops: QueuedOp[]; idMap: Record<string, string>; userId: string; snap: Snapshot } | null = null;

function replay(base: Snapshot, ops: QueuedOp[], idMap: Record<string, string>, userId: string): Snapshot {
  const prev = lastReplay;
  const grown = !!prev && prev.base === base && prev.idMap === idMap && prev.userId === userId && prev.ops.length <= ops.length && prev.ops.every((op, i) => op === ops[i]);
  let snap = grown ? prev.snap : base;
  for (const op of grown ? ops.slice(prev.ops.length) : ops) {
    if (op.kind === "files.upload") continue;
    try {
      snap = applyOp(snap, { ...op, args: rewriteIds(op.args, idMap) }, { userId: userId as Id<"users"> }).snap;
    } catch {
      // the server will reject it too; leave the view consistent
    }
  }
  lastReplay = { base, ops, idMap, userId, snap };
  return snap;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const conn = useConvexConnectionState();
  const offline = useOffline(conn.isWebSocketConnected);
  const me = useQuery(api.sync.me);

  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<Snapshot | null>(null);
  const [meta, setMeta] = useState<Meta>({ userId: null, user: null, hasSnapshot: false, idMap: {}, photoUrls: {}, rev: null });
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});

  const opsRef = useRef<QueuedOp[]>([]);
  const metaRef = useRef(meta);
  const viewRef = useRef<Snapshot>(emptySnapshot());
  const pumping = useRef(false);
  const liveRef = useRef(false);
  const connectedRef = useRef(false);
  const meRef = useRef<typeof me>(undefined);
  meRef.current = me;
  const attempts = useRef(new Map<string, number>());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- boot from IndexedDB ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let r: Awaited<ReturnType<typeof local.readAll>>;
      try {
        r = await local.readAll();
      } catch {
        // storage blocked or broken: run from memory, online only, rather than load forever
        local.runInMemory();
        if (!cancelled) {
          setReady(true);
          toast.warning("This browser won't let UnMoney save data on this device, so it works online only for now.");
        }
        return;
      }
      if (cancelled) return;
      setBase(r.snapshot);
      setMeta(r.meta);
      metaRef.current = r.meta;
      opsRef.current = r.ops;
      setOps(r.ops);
      const urls: Record<string, string> = {};
      for (const op of r.ops) {
        if (op.kind !== "files.upload") continue;
        const b = await local.getBlob(op.id);
        if (b) urls[`tmp_${op.id}_1`] = URL.createObjectURL(b);
      }
      if (!cancelled) {
        setBlobUrls(urls);
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- outcomes, for callers that wait for the server (imports, restores) ----
  const settled = useRef(new Map<string, string | null>()); // op id -> null when applied, else the error
  const waiters = useRef(new Set<() => void>());
  const settle = useCallback((id: string, error: string | null) => {
    settled.current.set(id, error);
    for (const w of [...waiters.current]) w();
  }, []);
  const whenSynced = useCallback((opIds: string[]) => new Promise<{ rejected: { id: string; error: string }[] }>((resolve) => {
    const check = () => {
      if (!opIds.every((id) => settled.current.has(id))) return;
      waiters.current.delete(check);
      const rejected = opIds.flatMap((id) => { const error = settled.current.get(id); return error ? [{ id, error }] : []; });
      for (const id of opIds) settled.current.delete(id);
      resolve({ rejected });
    };
    waiters.current.add(check);
    check();
  }), []);

  // ---- the local copy ----
  // Written a moment after the last change from the server rather than once per change, only the
  // tables that changed, with the change number they are now up to.
  const pendingWrite = useRef<Partial<Snapshot>>({});
  const pendingRev = useRef<number | undefined>(undefined);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushWrite = useCallback(() => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = null;
    const tables = pendingWrite.current;
    const rev = pendingRev.current;
    pendingWrite.current = {};
    pendingRev.current = undefined;
    if (Object.keys(tables).length || rev !== undefined) void local.writeTables(tables, rev);
  }, []);
  const queueWrite = useCallback((tables: Partial<Snapshot>, rev: number) => {
    Object.assign(pendingWrite.current, tables);
    pendingRev.current = rev;
    writeTimer.current ??= setTimeout(flushWrite, WRITE_DELAY_MS);
  }, [flushWrite]);
  /** Before the copy is wiped: nothing waiting goes after the wipe. */
  const forgetWritten = useCallback(() => {
    pendingWrite.current = {};
    pendingRev.current = undefined;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = null;
  }, []);
  // a tab sent to the background may be killed before the timer fires: write what is waiting now
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushWrite(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushWrite);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushWrite);
      flushWrite();
    };
  }, [flushWrite]);

  /** Sent batches waiting for what they wrote to arrive (pump), checked whenever the copy moves on. */
  const arrivals = useRef(new Set<() => void>());

  // ---- loading everything: a new device, another user, or a copy too far behind ----
  const [reload, setReload] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loading = useRef(false);
  /** The user whose copy was just cleared (signing out): nothing of theirs is loaded again until they are signed out. */
  const [clearedFor, setClearedFor] = useState<string | null>(null);
  /** Moves on when the copy is cleared, so a load that started before does not land after it. */
  const generation = useRef(0);
  // signed out now: whoever signs in next is loaded as usual
  if (me === null && clearedFor !== null) setClearedFor(null);
  const mustLoad = ready && me != null && me.userId !== clearedFor && conn.isWebSocketConnected && (!base || meta.rev === null || meta.userId !== me.userId || reload);
  useEffect(() => {
    if (!mustLoad || !me || loading.current) return;
    loading.current = true;
    const userId = me.userId;
    const gen = generation.current;
    let discarded = false;
    (async () => {
      let got: Awaited<ReturnType<typeof loadEverything>>;
      try {
        got = await loadEverything(convex);
      } catch {
        setTimeout(() => setLoadAttempt((n) => n + 1), LOAD_RETRY_MS);
        return;
      }
      // signed out or cleared meanwhile, or someone else signed in: whoever is signed in now is loaded next
      if (!got || meRef.current?.userId !== userId || gen !== generation.current) {
        discarded = true;
        return;
      }
      if (metaRef.current.userId && metaRef.current.userId !== userId) {
        // Someone else signed in on this device: their predecessor's queue must not be replayed.
        for (const op of opsRef.current) settle(op.id, "Discarded: someone else signed in");
        forgetWritten();
        await local.wipe();
        opsRef.current = [];
        setOps([]);
        setBlobUrls({});
        const fresh: Meta = { userId, user: meRef.current.user, hasSnapshot: true, idMap: {}, photoUrls: {}, rev: null };
        metaRef.current = fresh;
        setMeta(fresh);
      }
      setBase(got.snapshot);
      queueWrite(got.snapshot, got.rev);
      const next = { ...metaRef.current, userId, user: meRef.current.user, hasSnapshot: true, rev: got.rev };
      metaRef.current = next;
      setMeta(next);
      setReload(false);
      for (const check of [...arrivals.current]) check();
      await local.writeMeta("userId", userId);
      await local.writeMeta("user", next.user);
    })().finally(() => {
      loading.current = false;
      if (discarded) setLoadAttempt((n) => n + 1);
    });
  }, [mustLoad, me, loadAttempt, convex, settle, forgetWritten, queueWrite]);

  // the profile (name, picture) as the server has it now
  useEffect(() => {
    if (!me || metaRef.current.userId !== me.userId || JSON.stringify(metaRef.current.user) === JSON.stringify(me.user)) return;
    const next = { ...metaRef.current, user: me.user };
    metaRef.current = next;
    setMeta(next);
    void local.writeMeta("user", me.user);
  }, [me]);

  // ---- following what changes ----
  const following = ready && me != null && !!base && meta.rev !== null && meta.userId === me.userId && !reload;
  const changes = useQuery(api.sync.changes, following ? { since: meta.rev! } : "skip");
  const merged = useMemo(() => (base && following && changes && changes.rev > (meta.rev ?? 0) ? applyChanges(base, changes) : base), [base, following, changes, meta.rev]);
  /** The user whose copy has caught up with the server in this session. */
  const [caughtUpFor, setCaughtUpFor] = useState<string | null>(null);
  useEffect(() => {
    if (!following || !changes || !merged) return;
    if (changes.reset) {
      setReload(true);
      setCaughtUpFor(null);
      return;
    }
    setCaughtUpFor(metaRef.current.userId);
    if (changes.rev <= (metaRef.current.rev ?? -1)) {
      for (const check of [...arrivals.current]) check();
      return;
    }
    // the copy moves on to this number: the next subscription asks only for what comes after it
    const touched: Partial<Snapshot> = {};
    for (const t of TABLES) if (merged[t] !== base![t]) (touched as Record<Table, unknown[]>)[t] = merged[t];
    setBase(merged);
    queueWrite(touched, changes.rev);
    const next = { ...metaRef.current, rev: changes.rev };
    metaRef.current = next;
    setMeta(next);
    for (const check of [...arrivals.current]) check();
  }, [following, changes, merged, base, queueWrite]);
  /** Resolves once the copy is up to change number `rev` (or after a while regardless). */
  const arrived = useCallback((rev: number) => new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); arrivals.current.delete(check); resolve(); };
    const check = () => { if ((metaRef.current.rev ?? -1) >= rev) done(); };
    const timer = setTimeout(done, ARRIVE_WAIT_MS);
    arrivals.current.add(check);
    check();
  }), []);

  const live = following && caughtUpFor === meta.userId;
  liveRef.current = live;
  connectedRef.current = conn.isWebSocketConnected;

  const effectiveBase = merged;
  const view = useMemo(() => (effectiveBase ? replay(effectiveBase, ops, meta.idMap, meta.userId ?? "") : emptySnapshot()), [effectiveBase, ops, meta.idMap, meta.userId]);
  viewRef.current = view;

  // ---- queue ----
  const setQueue = useCallback((next: QueuedOp[]) => {
    opsRef.current = next;
    setOps(next);
  }, []);

  const mergeIdMap = useCallback(async (extra: Record<string, string>) => {
    if (!Object.keys(extra).length) return;
    const next = { ...metaRef.current, idMap: { ...metaRef.current.idMap, ...extra } };
    metaRef.current = next;
    setMeta(next);
    await local.writeMeta("idMap", next.idMap);
  }, []);

  const effectiveBaseRef = useRef<Snapshot | null>(null);
  effectiveBaseRef.current = effectiveBase;

  const dispatchTracked = useCallback(async <K extends OpKind>(kind: K, args: OpArgs<K>): Promise<{ id: string; result: OpResult<K> }> => {
    const op: Op = { id: uuid(), kind, args, at: Date.now() };
    const userId = metaRef.current.userId ?? "";
    const current = replay(effectiveBaseRef.current ?? emptySnapshot(), opsRef.current, metaRef.current.idMap, userId);
    const { result } = applyOp(current, { ...op, args: rewriteIds(args, metaRef.current.idMap) }, { userId: userId as Id<"users"> });
    const seq = await local.addOp(op);
    setQueue([...opsRef.current, { ...op, seq }]);
    return { id: op.id, result: result as OpResult<K> };
  }, [setQueue]);

  const dispatch = useCallback(async <K extends OpKind>(kind: K, args: OpArgs<K>): Promise<OpResult<K>> => (await dispatchTracked(kind, args)).result, [dispatchTracked]);

  const enqueueUpload = useCallback(async (file: File): Promise<Id<"_storage">> => {
    const op: Op = { id: uuid(), kind: "files.upload", args: { name: file.name, type: file.type, size: file.size }, at: Date.now() };
    await local.putBlob(op.id, file);
    const seq = await local.addOp(op);
    const tmp = `tmp_${op.id}_1`;
    setBlobUrls((u) => ({ ...u, [tmp]: URL.createObjectURL(file) }));
    setQueue([...opsRef.current, { ...op, seq }]);
    return tmp as Id<"_storage">;
  }, [setQueue]);

  // ---- sync loop ----
  const pump = useCallback(async () => {
    if (pumping.current || retryTimer.current) return; // a send that threw is retried on its timer
    pumping.current = true;
    setSyncing(true);
    let limit = BATCH;
    try {
      // the queue belongs to metaRef's user; until the adopt effect has wiped another user's queue, send nothing
      while (liveRef.current && connectedRef.current && opsRef.current.length && metaRef.current.userId === meRef.current?.userId) {
        const queue = opsRef.current;
        const first = queue[0];
        const drop = async (op: QueuedOp, error?: string) => {
          await local.removeOps([op.seq]);
          setQueue(opsRef.current.filter((o) => o.seq !== op.seq));
          settle(op.id, error ?? null);
          if (error) {
            setLastError(error);
            toast.error(`${opLabel(op.kind, op.args)} couldn't be synced and was undone: ${error}`);
          }
        };

        if (first.kind === "files.upload") {
          const blob = await local.getBlob(first.id);
          if (!blob) { await drop(first); continue; }
          let storageId: string | null = null;
          try {
            const url = await convex.mutation(api.files.generateUploadUrl, {});
            const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
            if (!res.ok) throw new Error(`Upload failed (${res.status})`);
            storageId = (await res.json()).storageId;
            // the server serves and deletes a file only for the user who claimed it
            await convex.mutation(api.files.claim, { storageId: storageId as Id<"_storage"> });
          } catch (e) {
            if (e instanceof TypeError || isAuthError(e)) break; // network: try again later
            await drop(first, e instanceof Error ? e.message : "Upload failed");
            continue;
          }
          const tmp = `tmp_${first.id}_1`;
          await mergeIdMap({ [tmp]: storageId! });
          setBlobUrls((u) => (u[tmp] ? { ...u, [storageId!]: u[tmp] } : u));
          await local.deleteBlob(first.id);
          await drop(first);
          continue;
        }

        const batch: QueuedOp[] = [];
        for (const op of queue) {
          if (op.kind === "files.upload" || batch.length >= limit) break;
          if (isHeavy(op) && batch.length) break;
          batch.push(op);
          if (isHeavy(op)) break;
        }
        const sent: Op[] = [];
        let skipped = false;
        for (const op of batch) {
          let args = rewriteIds(op.args, metaRef.current.idMap) as Record<string, unknown>;
          if (args && typeof args === "object" && Array.isArray(args.photoIds)) args = { ...args, photoIds: (args.photoIds as string[]).filter((p) => !isTmpId(p)) };
          const unresolved = [...tmpIdsIn(args)].filter((t) => !batch.some((b) => t.startsWith(`tmp_${b.id}_`)));
          if (unresolved.length) {
            await drop(op, "it depends on an earlier change that failed");
            skipped = true;
            break;
          }
          sent.push({ id: op.id, kind: op.kind, args, at: op.at });
        }
        if (skipped) continue;

        let results: Awaited<ReturnType<typeof convex.mutation<typeof api.sync.apply>>>;
        try {
          results = await convex.mutation(api.sync.apply, { ops: sent });
        } catch (e) {
          if (isAuthError(e)) break;
          if (batch.length > 1) { limit = 1; continue; }
          const tries = attempts.current.get(first.id) ?? 0;
          if (tries < RETRY_MS.length) {
            // the reducer's own rejections come back as results, so this is the server being unavailable
            attempts.current.set(first.id, tries + 1);
            retryTimer.current = setTimeout(() => { retryTimer.current = null; void pumpRef.current(); }, RETRY_MS[tries]);
            break;
          }
          attempts.current.delete(first.id);
          await drop(first, e instanceof Error ? e.message : "Rejected by the server");
          continue;
        }
        limit = BATCH;
        for (const b of batch) attempts.current.delete(b.id);
        // what the batch wrote comes back through `changes`: once it is in the copy, the ops can leave the queue without a flicker
        await arrived(Math.max(0, ...results.map((r) => ("rev" in r ? r.rev : 0))));
        const idMap: Record<string, string> = {};
        const done: number[] = [];
        const errors: string[] = [];
        let firstFailed: QueuedOp | undefined;
        for (const r of results) {
          const op = batch.find((b) => b.id === r.id);
          if (!op) continue;
          done.push(op.seq);
          if (r.status === "applied") Object.assign(idMap, r.idMap);
          else { errors.push(r.error); firstFailed ??= op; }
          settle(op.id, r.status === "applied" ? null : r.error);
        }
        // in memory first, so no render shows the server's copy and the queued op both; then on disk
        const idWrite = mergeIdMap(idMap);
        setQueue(opsRef.current.filter((o) => !done.includes(o.seq)));
        await Promise.all([idWrite, local.removeOps(done)]);
        if (errors.length) {
          setLastError(errors[0]);
          const what = firstFailed ? opLabel(firstFailed.kind, firstFailed.args) : "A change";
          toast.error(errors.length === 1 ? `${what} couldn't be synced and was undone: ${errors[0]}` : `${errors.length} changes couldn't be synced and were undone. First: ${what}: ${errors[0]}`);
        } else {
          setLastError(null);
        }
      }
    } finally {
      pumping.current = false;
      setSyncing(false);
    }
  }, [convex, mergeIdMap, setQueue, settle, arrived]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;
  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  useEffect(() => {
    if (live && conn.isWebSocketConnected && ops.length && meta.userId === me?.userId) void pump();
  }, [live, conn.isWebSocketConnected, ops.length, meta.userId, me?.userId, pump]);

  // ---- misc ----
  const rememberPhotoUrls = useCallback((urls: Record<string, string | null>) => {
    const add: Record<string, string> = {};
    for (const [k, v] of Object.entries(urls)) if (v && metaRef.current.photoUrls[k] !== v) add[k] = v;
    if (!Object.keys(add).length) return;
    const next = { ...metaRef.current, photoUrls: { ...metaRef.current.photoUrls, ...add } };
    metaRef.current = next;
    setMeta(next);
    void local.writeMeta("photoUrls", next.photoUrls);
  }, []);

  const clearLocal = useCallback(async () => {
    generation.current++;
    setClearedFor(metaRef.current.userId ?? meRef.current?.userId ?? null);
    // anyone waiting on these changes (an import, a restore) hears that they will not arrive
    for (const op of opsRef.current) settle(op.id, "Discarded: signed out");
    // the copy goes first, before anything waits: no change from the server lands in it, or on disk, after this
    forgetWritten();
    setQueue([]);
    setBase(null);
    const fresh: Meta = { userId: null, user: null, hasSnapshot: false, idMap: {}, photoUrls: {}, rev: null };
    metaRef.current = fresh;
    setMeta(fresh);
    setBlobUrls({});
    await local.wipe();
    await clearSafetyCopies().catch(() => {});
    // what else this device keeps of the user: cached receipt photos, a file shared in, and preferences
    if ("caches" in window) await Promise.all([caches.delete("photos"), caches.delete(SHARE_CACHE)]).catch(() => {});
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("unmoney")) localStorage.removeItem(k);
    } catch {
      // storage blocked: nothing was kept there either
    }
  }, [setQueue, settle, forgetWritten]);

  const value = useMemo<Store>(() => ({
    ready,
    hasLocal: !!effectiveBase,
    userId: me?.userId ?? meta.userId,
    user: me?.user ?? meta.user,
    view,
    status: { connected: conn.isWebSocketConnected, offline, live, pending: ops.length, syncing, lastError },
    dispatch,
    dispatchTracked,
    whenSynced,
    enqueueUpload,
    photoUrl: (id) => blobUrls[id] ?? blobUrls[meta.idMap[id] ?? ""] ?? meta.photoUrls[id],
    rememberPhotoUrls,
    resolveId: (id) => (meta.idMap[id] ?? id) as typeof id,
    clearLocal,
  }), [ready, effectiveBase, me, meta, view, conn.isWebSocketConnected, offline, live, ops.length, syncing, lastError, dispatch, dispatchTracked, whenSynced, enqueueUpload, blobUrls, rememberPhotoUrls, clearLocal]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside OfflineProvider");
  return v;
}

/** The local replica with every queued change applied. */
export function useView(): Snapshot {
  return useStore().view;
}

/** A write, applied locally right away and synced later. Resolves (or throws) immediately. */
export function useOp<K extends OpKind>(kind: K): (args: OpArgs<K>) => Promise<OpResult<K>> {
  const { dispatch } = useStore();
  return useCallback((args: OpArgs<K>) => dispatch(kind, args), [dispatch, kind]);
}
