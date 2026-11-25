import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "convex/react";
import { Camera, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { compressImage } from "@/lib/image";
import { isTmpId } from "../../../shared/ops";
import { PhotoViewer } from "@/components/PhotoViewer";

/**
 * Photos are queued locally and uploaded when online; the entry keeps a temporary id until then.
 * With onAmountRead, newly attached photos are read on the device for the amount paid, and it is
 * handed over only when the reading is clear (see src/lib/receiptAmount.ts).
 */
export function PhotoField({ photoIds, onChange, onAmountRead }: {
  photoIds: Id<"_storage">[];
  onChange: (ids: Id<"_storage">[]) => void;
  onAmountRead?: (major: number) => void;
}) {
  const { enqueueUpload, photoUrl, rememberPhotoUrls, resolveId, status } = useStore();
  const realIds = useMemo(() => photoIds.map((id) => resolveId(id)).filter((id) => !isTmpId(id)), [photoIds, resolveId]);
  const fetched = useQuery(api.files.urls, realIds.length && status.connected ? { ids: realIds } : "skip");
  useEffect(() => { if (fetched) rememberPhotoUrls(fetched); }, [fetched, rememberPhotoUrls]);
  const urlOf = (id: string) => photoUrl(id) ?? fetched?.[resolveId(id)] ?? undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  /** Which photo is open full screen. */
  const [viewing, setViewing] = useState<number | null>(null);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const room = 3 - photoIds.length;
    const list = [...files].slice(0, room);
    if (!list.length) return toast.error("At most 3 photos per entry");
    setBusy(true);
    try {
      const ids: Id<"_storage">[] = [];
      const added: File[] = [];
      for (const f of list) {
        const small = await compressImage(f);
        if (small.size > 5 * 1024 * 1024) { toast.error(`${f.name} is over 5 MB`); continue; }
        ids.push(await enqueueUpload(small));
        added.push(small);
      }
      onChange([...photoIds, ...ids]);
      if (onAmountRead && added.length) void readFirst(added, onAmountRead);
    } catch {
      toast.error("Could not attach the photo");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  /** The first photo with a clear amount wins; the rest aren't read. */
  async function readFirst(files: File[], done: (major: number) => void) {
    setReading(true);
    try {
      // loaded only once a photo is attached: the editor itself carries none of the OCR code
      const { readAmount } = await import("@/lib/ocr");
      for (const f of files) {
        const n = await readAmount(f);
        if (n !== null) return done(n);
      }
    } catch {
      // the chunk couldn't load (offline): no amount, as with an unclear photo
    } finally {
      setReading(false);
    }
  }
  return (
    <div className="flex gap-2 flex-wrap items-center">
      {photoIds.map((id, i) => (
        <div key={id} className="relative size-20 rounded-md overflow-hidden bg-muted">
          {urlOf(id) ? (
            <button type="button" aria-label="View photo" className="size-full" onClick={() => setViewing(i)}><img src={urlOf(id)} alt="" decoding="async" className="size-full object-cover" /></button>
          ) : <div className="size-full flex items-center justify-center text-[10px] text-muted-foreground">{status.offline ? "offline" : "…"}</div>}
          <button type="button" aria-label="Remove photo" onClick={() => onChange(photoIds.filter((x) => x !== id))} className="absolute top-1 right-1 rounded-full bg-black/60 text-white p-0.5 after:absolute after:-inset-2 after:content-['']"><X className="size-3" /></button>
        </div>
      ))}
      {photoIds.length < 3 ? (
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={cn("size-20 rounded-md border border-dashed flex items-center justify-center text-muted-foreground hover:bg-accent", busy && "opacity-50")} aria-label="Add photo">
          <Camera className="size-5" />
        </button>
      ) : null}
      {reading ? <span className="text-xs text-muted-foreground animate-pulse">Reading the amount…</span> : null}
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      <PhotoViewer
        urls={photoIds.map(urlOf)}
        index={viewing !== null && viewing < photoIds.length ? viewing : null}
        onIndexChange={setViewing}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

export function TagInput({ tags, onChange, suggestions }: { tags: string[]; onChange: (t: string[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => {
    const clean = t.trim().replace(/^#/, "");
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); add(draft); }
    if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
  };
  const sug = (suggestions ?? []).filter((s) => !tags.includes(s) && (!draft || s.toLowerCase().includes(draft.toLowerCase()))).slice(0, 6);
  return (
    <div>
      <div className="flex flex-wrap gap-1 items-center">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">#{t}<button type="button" aria-label={`Remove ${t}`} className="relative after:absolute after:-inset-2 after:content-['']" onClick={() => onChange(tags.filter((x) => x !== t))}><X className="size-3" /></button></span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => draft && add(draft)} placeholder={tags.length ? "" : "Add tags"} aria-label="Tags" className="flex-1 min-w-24 rounded-sm bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring text-base md:text-sm py-1" />
      </div>
      {draft && sug.length ? (
        <div className="flex gap-1 flex-wrap mt-1">{sug.map((s) => <button key={s} type="button" className="text-xs rounded-full border px-2 py-0.5 hover:bg-accent" onMouseDown={(e) => e.preventDefault() /* keep focus, so blur does not add the half-typed draft first */} onClick={() => add(s)}>#{s}</button>)}</div>
      ) : null}
    </div>
  );
}
