/**
 * The local store: a replica of the user's documents that every screen renders from, a queue
 * of ops applied locally the moment the user acts, and a loop that sends them to Convex
 * whenever the connection is up. See shared/ops.ts for the model.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConvex, useConvexConnectionState, usePaginatedQuery, useQuery } from "convex/react";
import { toast } from "sonner";
import { opLabel } from "./opLabel";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  TABLES, applyOp, emptySnapshot, isTmpId, rewriteIds, tmpIdsIn, type Op, type OpArgs, type OpKind, type OpResult, type Snapshot, type Table,
} from "../../shared/ops";
import * as local from "./db";
import { SHARE_CACHE } from "./share";
import type { Meta, Profile, QueuedOp } from "./db";

export type SyncStatus = {
  /** The websocket to Convex is up. */
  connected: boolean;
  /** Every table has streamed from the server in this session. */
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
/** Entries per page of the transactions subscription; each page is one bounded server read. */
const TX_PAGE = 2000;
/** An import or a tidy-up can write hundreds of documents. */
const SEND_ALONE = new Set<OpKind>(["transactions.importRows", "categories.applyCleanup", "categories.undoCleanup"]);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
/** An op that writes many documents is sent on its own, so one server transaction stays within Convex's limits. */
const isHeavy = (op: QueuedOp) =>
  SEND_ALONE.has(op.kind) || op.kind === "transactions.restoreRows" || ((op.args as { ids?: unknown[] }).ids?.length ?? 0) > 100;
/** Waits before sending again an op whose send threw (an overload or a deploy, not a rejection); dropped after the last. */
const RETRY_MS = [2_000, 15_000, 60_000];
const isAuthError = (e: unknown) => /not signed in|unauthenticated|authentication/i.test(e instanceof Error ? e.message : String(e));

type Live = { [T in Table]: Doc<T>[] | null | undefined };

function useLiveTables(): Live {
  // One subscription per table, in a fixed order (hooks rule).
  const settings = useQuery(api.sync.table, { table: "settings" });
  const accountGroups = useQuery(api.sync.table, { table: "accountGroups" });
  const accounts = useQuery(api.sync.table, { table: "accounts" });
  const categories = useQuery(api.sync.table, { table: "categories" });
  const transactions = useAllTransactions();
  const repeats = useQuery(api.sync.table, { table: "repeats" });
  const bookmarks = useQuery(api.sync.table, { table: "bookmarks" });
  const budgets = useQuery(api.sync.table, { table: "budgets" });
  const notes = useQuery(api.sync.table, { table: "notes" });
  const currencies = useQuery(api.sync.table, { table: "currencies" });
  const categoryCleanups = useQuery(api.sync.table, { table: "categoryCleanups" });
  const history = useQuery(api.sync.table, { table: "history" });
  const drafts = useQuery(api.sync.table, { table: "drafts" });
  return { settings, accountGroups, accounts, categories, transactions, repeats, bookmarks, budgets, notes, currencies, categoryCleanups, history, drafts } as Live;
}

/** Every page of the user's entries, kept live; undefined until the last page has arrived. */
function useAllTransactions(): Doc<"transactions">[] | undefined {
  const { results, status, loadMore } = usePaginatedQuery(api.sync.transactionsPage, {}, { initialNumItems: TX_PAGE });
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(TX_PAGE);
  }, [status, loadMore]);
  return status === "Exhausted" ? results : undefined;
}

/** The base snapshot with every queued op replayed on top. Ops that no longer apply are skipped. */
function replay(base: Snapshot, ops: QueuedOp[], idMap: Record<string, string>, userId: string): Snapshot {
  let snap = base;
  for (const op of ops) {
    if (op.kind === "files.upload") continue;
    try {
      snap = applyOp(snap, { ...op, args: rewriteIds(op.args, idMap) }, { userId: userId as Id<"users"> }).snap;
    } catch {
      // the server will reject it too; leave the view consistent
    }
  }
  return snap;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const conn = useConvexConnectionState();
  const live = useLiveTables();
  const me = useQuery(api.sync.me);

  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<Snapshot | null>(null);
  const [meta, setMeta] = useState<Meta>({ userId: null, user: null, hasSnapshot: false, idMap: {}, photoUrls: {} });
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

  // ---- adopt the live snapshot ----
  const allLive = ready && me != null && TABLES.every((t) => live[t] != null);
  const liveSnapshot = useMemo<Snapshot | null>(() => {
    if (!allLive) return null;
    const s = emptySnapshot();
    for (const t of TABLES) (s as Record<Table, unknown[]>)[t] = live[t] as unknown[];
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLive, live.settings, live.accountGroups, live.accounts, live.categories, live.transactions, live.repeats, live.bookmarks, live.budgets, live.notes, live.currencies, live.categoryCleanups, live.history, live.drafts]);

  liveRef.current = allLive;
  connectedRef.current = conn.isWebSocketConnected;

  useEffect(() => {
    if (!liveSnapshot || !me) return;
    (async () => {
      if (metaRef.current.userId && metaRef.current.userId !== me.userId) {
        // Someone else signed in on this device: their predecessor's queue must not be replayed.
        for (const op of opsRef.current) settle(op.id, "Discarded: someone else signed in");
        await local.wipe();
        opsRef.current = [];
        setOps([]);
        setBlobUrls({});
        const fresh: Meta = { userId: me.userId, user: me.user, hasSnapshot: true, idMap: {}, photoUrls: {} };
        metaRef.current = fresh;
        setMeta(fresh);
      }
      await local.writeSnapshot(liveSnapshot);
      setBase(liveSnapshot);
      if (metaRef.current.userId !== me.userId || JSON.stringify(metaRef.current.user) !== JSON.stringify(me.user)) {
        const next = { ...metaRef.current, userId: me.userId, user: me.user, hasSnapshot: true };
        metaRef.current = next;
        setMeta(next);
        await local.writeMeta("userId", me.userId);
        await local.writeMeta("user", me.user);
      }
    })();
  }, [liveSnapshot, me, settle]);

  const effectiveBase = liveSnapshot ?? base;
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
        await mergeIdMap(idMap);
        await local.removeOps(done);
        setQueue(opsRef.current.filter((o) => !done.includes(o.seq)));
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
  }, [convex, mergeIdMap, setQueue, settle]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;
  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  useEffect(() => {
    if (allLive && conn.isWebSocketConnected && ops.length && meta.userId === me?.userId) void pump();
  }, [allLive, conn.isWebSocketConnected, ops.length, meta.userId, me?.userId, pump]);

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
    // anyone waiting on these changes (an import, a restore) hears that they will not arrive
    for (const op of opsRef.current) settle(op.id, "Discarded: signed out");
    await local.wipe();
    // what else this device keeps of the user: cached receipt photos, a file shared in, and preferences
    if ("caches" in window) await Promise.all([caches.delete("photos"), caches.delete(SHARE_CACHE)]).catch(() => {});
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("unmoney")) localStorage.removeItem(k);
    } catch {
      // storage blocked: nothing was kept there either
    }
    setQueue([]);
    setBase(null);
    const fresh: Meta = { userId: null, user: null, hasSnapshot: false, idMap: {}, photoUrls: {} };
    metaRef.current = fresh;
    setMeta(fresh);
    setBlobUrls({});
  }, [setQueue, settle]);

  const value = useMemo<Store>(() => ({
    ready,
    hasLocal: !!effectiveBase,
    userId: me?.userId ?? meta.userId,
    user: me?.user ?? meta.user,
    view,
    status: { connected: conn.isWebSocketConnected, live: allLive, pending: ops.length, syncing, lastError },
    dispatch,
    dispatchTracked,
    whenSynced,
    enqueueUpload,
    photoUrl: (id) => blobUrls[id] ?? blobUrls[meta.idMap[id] ?? ""] ?? meta.photoUrls[id],
    rememberPhotoUrls,
    resolveId: (id) => (meta.idMap[id] ?? id) as typeof id,
    clearLocal,
  }), [ready, effectiveBase, me, meta, view, conn.isWebSocketConnected, allLive, ops.length, syncing, lastError, dispatch, dispatchTracked, whenSynced, enqueueUpload, blobUrls, rememberPhotoUrls, clearLocal]);

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
