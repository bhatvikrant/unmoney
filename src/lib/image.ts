/** Longest side kept for photos: a 12 MP phone shot (4032×3024) comes down to 2560×1920, still sharp enough to read a receipt. */
const MAX_EDGE = 2560;
/** WebP at this quality is visually indistinguishable from the original photo at a fraction of the size. */
const QUALITY = 0.85;

// GIFs may be animated and SVGs are vectors: re-encoding either would lose something, so they go up as they are.
const COMPRESSIBLE = /^image\/(jpeg|png|webp|avif|heic|heif|bmp|tiff)$/;

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/**
 * Shrinks a photo before it is queued for upload: corrects its orientation, caps its size and re-encodes it as WebP
 * (JPEG where the browser can't write WebP). Hands back the original whenever that would not make it smaller,
 * or when the browser can't decode it.
 */
export async function compressImage(file: File): Promise<File> {
  if (!COMPRESSIBLE.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let blob = await encode(canvas, "image/webp");
    // Safari can't write WebP and quietly hands back a PNG instead
    if (blob?.type !== "image/webp") {
      // JPEG has no transparency: paint it white rather than black
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      blob = await encode(canvas, "image/jpeg");
    }
    if (!blob || blob.size >= file.size) return file;
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], file.name.replace(/\.[^.]*$/, "") + `.${ext}`, { type: blob.type, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
