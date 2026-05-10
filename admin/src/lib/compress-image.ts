/**
 * Compresses an image client-side using canvas.
 *
 * - Downscales to at most `maxWidth` pixels wide (default 1920) while
 *   preserving aspect ratio.
 * - Re-encodes as WebP at `quality` (default 0.85).
 * - SVG and GIF are returned unchanged — canvas can't compress them.
 */
export async function compressImage(
  source: File | Blob,
  maxWidth = 1920,
  quality = 0.85,
): Promise<File> {
  const mime = source.type;

  if (mime === 'image/svg+xml' || mime === 'image/gif') {
    return source instanceof File ? source : new File([source], 'image.bin', { type: mime });
  }

  const url = URL.createObjectURL(source);

  return new Promise<File>((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
          const base = (source instanceof File ? source.name : 'image').replace(/\.[^.]+$/, '');
          resolve(new File([blob], `${base}.webp`, { type: 'image/webp' }));
        },
        'image/webp',
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image failed to load for compression'));
    };

    img.src = url;
  });
}
