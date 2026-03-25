/**
 * RGBA buffer for empty canvas areas before compositing tiles.
 * Subtle per-pixel noise avoids flat gray that image models treat as "preserve / mask"
 * and reduces one-sided edits (only painting where photo pixels existed).
 */
export function makeContextBaseRgba(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  const baseR = 240;
  const baseG = 240;
  const baseB = 240;
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const h = Math.imul(i, 2654435761) >>> 0;
    const jr = (h & 255) % 25;
    const jg = (h >>> 8) % 25;
    const jb = (h >>> 16) % 25;
    buf[idx] = Math.min(255, Math.max(0, baseR + jr - 12));
    buf[idx + 1] = Math.min(255, Math.max(0, baseG + jg - 12));
    buf[idx + 2] = Math.min(255, Math.max(0, baseB + jb - 12));
    buf[idx + 3] = 255;
  }
  return buf;
}
