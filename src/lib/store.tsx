/**
 * The local store: a replica of the user's documents that every screen renders from, a queue
 * of ops applied locally the moment the user acts, and a loop that sends them to Convex
 * whenever the connection is up. See shared/ops.ts for the model.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConvex, useConvexConnectionState, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  TABLES, applyOp, emptySnapshot, isTmpId, rewriteIds, tmpIdsIn, type Op, type OpArgs, type OpKind, type OpResult, type Snapshot, type Table,
} from "../../shared/ops";
import * as local from "./db";
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
  enqueueUpload: (file: File) => Promise<Id<"_storage">>;
  photoUrl: (id: string) => string | undefined;
  rememberPhotoUrls: (urls: Record<string, string | null>) => void;
  resolveId: <T extends string>(id: T) => T;
  clearLocal: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

const BATCH = 25;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const isAuthError = (e: unknown) => /not signed in|unauthenticated|authentication/i.test(e instanceof Error ? e.message : String(e));

type Live = { [T in Table]: Doc<T>[] | null | undefined };

function useLiveTables(): Live {
  // One subscription per table, in a fixed order (hooks rule).
  const settings = useQuery(api.sync.table, { table: "settings" });
  const accountGroups = useQuery(api.sync.table, { table: "accountGroups" });
  const accounts = useQuery(api.sync.table, { table: "accounts" });
  const categories = useQuery(api.sync.table, { table: "categories" });
  const transactions = useQuery(api.sync.table, { table: "transactions" });
  const repeats = useQuery(api.sync.table, { table: "repeats" });
  const bookmarks = useQuery(api.sync.table, { table: "bookmarks" });
  const budgets = useQuery(api.sync.table, { table: "budgets" });
  const notes = useQuery(api.sync.table, { table: "notes" });
  const currencies = useQuery(api.sync.table, { table: "currencies" });
  return { settings, accountGroups, accounts, categories, transactions, repeats, bookmarks, budgets, notes, currencies } as Live;
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

  // ---- boot from IndexedDB ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await local.readAll();
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

  // ---- adopt the live snapshot ----
  const allLive = ready && me != null && TABLES.every((t) => live[t] != null);
  const liveSnapshot = useMemo<Snapshot | null>(() => {
    if (!allLive) return null;
    const s = emptySnapshot();
    for (const t of TABLES) (s as Record<Table, unknown[]>)[t] = live[t] as unknown[];
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLive, live.settings, live.accountGroups, live.accounts, live.categories, live.transactions, live.repeats, live.bookmarks, live.budgets, live.notes, live.currencies]);

  liveRef.current = allLive;
  connectedRef.current = conn.isWebSocketConnected;

  useEffect(() => {
    if (!liveSnapshot || !me) return;
    (async () => {
      if (metaRef.current.userId && metaRef.current.userId !== me.userId) {
        // Someone else signed in on this device: their predecessor's queue must not be replayed.
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
  }, [liveSnapshot, me]);

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

  const dispatch = useCallback(async <K extends OpKind>(kind: K, args: OpArgs<K>): Promise<OpResult<K>> => {
    const op: Op = { id: uuid(), kind, args, at: Date.now() };
    const userId = metaRef.current.userId ?? "";
    const current = replay(effectiveBaseRef.current ?? emptySnapshot(), opsRef.current, metaRef.current.idMap, userId);
    const { result } = applyOp(current, { ...op, args: rewriteIds(args, metaRef.current.idMap) }, { userId: userId as Id<"users"> });
    const seq = await local.addOp(op);
    setQueue([...opsRef.current, { ...op, seq }]);
    return result as OpResult<K>;
  }, [setQueue]);

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
    if (pumping.current) return;
    pumping.current = true;
    setSyncing(true);
    let limit = BATCH;
    try {
      while (liveRef.current && connectedRef.current && opsRef.current.length) {
        const queue = opsRef.current;
        const first = queue[0];
        const drop = async (op: QueuedOp, error?: string) => {
          await local.removeOps([op.seq]);
          setQueue(opsRef.current.filter((o) => o.seq !== op.seq));
          if (error) {
            setLastError(error);
            toast.error(`A change could not be synced and was undone: ${error}`);
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
          batch.push(op);
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
          await drop(first, e instanceof Error ? e.message : "Rejected by the server");
          continue;
        }
        limit = BATCH;
        const idMap: Record<string, string> = {};
        const done: number[] = [];
        const errors: string[] = [];
        for (const r of results) {
          const op = batch.find((b) => b.id === r.id);
          if (!op) continue;
          done.push(op.seq);
          if (r.status === "applied") Object.assign(idMap, r.idMap);
          else errors.push(r.error);
        }
        await mergeIdMap(idMap);
        await local.removeOps(done);
        setQueue(opsRef.current.filter((o) => !done.includes(o.seq)));
        if (errors.length) {
          setLastError(errors[0]);
          toast.error(errors.length === 1 ? `A change could not be synced and was undone: ${errors[0]}` : `${errors.length} changes could not be synced and were undone. First: ${errors[0]}`);
        } else {
          setLastError(null);
        }
      }
    } finally {
      pumping.current = false;
      setSyncing(false);
    }
  }, [convex, mergeIdMap, setQueue]);

  useEffect(() => {
    if (allLive && conn.isWebSocketConnected && ops.length) void pump();
  }, [allLive, conn.isWebSocketConnected, ops.length, pump]);

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
    await local.wipe();
    setQueue([]);
    setBase(null);
    const fresh: Meta = { userId: null, user: null, hasSnapshot: false, idMap: {}, photoUrls: {} };
    metaRef.current = fresh;
    setMeta(fresh);
    setBlobUrls({});
  }, [setQueue]);

  const value = useMemo<Store>(() => ({
    ready,
    hasLocal: !!effectiveBase,
    userId: me?.userId ?? meta.userId,
    user: me?.user ?? meta.user,
    view,
    status: { connected: conn.isWebSocketConnected, live: allLive, pending: ops.length, syncing, lastError },
    dispatch,
    enqueueUpload,
    photoUrl: (id) => blobUrls[id] ?? blobUrls[meta.idMap[id] ?? ""] ?? meta.photoUrls[id],
    rememberPhotoUrls,
    resolveId: (id) => (meta.idMap[id] ?? id) as typeof id,
    clearLocal,
  }), [ready, effectiveBase, me, meta, view, conn.isWebSocketConnected, allLive, ops.length, syncing, lastError, dispatch, enqueueUpload, blobUrls, rememberPhotoUrls, clearLocal]);

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
