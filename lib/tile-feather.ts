import sharp from 'sharp';

/** Edge fade 0 at border → 255 at center, over `radius` pixels (Manhattan min distance). */
export function createFeatherMask(
  width: number,
  height: number,
  radius: number
): Buffer {
  const buf = Buffer.alloc(width * height);
  const r = Math.max(1, radius);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dL = x;
      const dR = width - 1 - x;
      const dT = y;
      const dB = height - 1 - y;
      const minDist = Math.min(dL, dR, dT, dB);
      const alpha = Math.min(1, minDist / r);
      buf[y * width + x] = Math.round(alpha * 255);
    }
  }
  return buf;
}

/** Fraction of min(w,h) used as feather radius — softer blend on busy neighbors (8%). */
export const TILE_EDGE_FEATHER_FRAC = 0.08;

/**
 * Apply edge alpha so the tile blends into underlying canvas (complex BGs read through at borders).
 */
export async function applyEdgeFeatherPng(
  rgbPngBuffer: Buffer,
  width: number,
  height: number,
  radiusFraction: number = TILE_EDGE_FEATHER_FRAC
): Promise<Buffer> {
  const featherRadius = Math.max(
    2,
    Math.round(Math.min(width, height) * radiusFraction)
  );
  const maskRaw = createFeatherMask(width, height, featherRadius);
  const maskPng = await sharp(maskRaw, {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();
  const rgbBuffer = await sharp(rgbPngBuffer).removeAlpha().toBuffer();
  return sharp(rgbBuffer)
    .joinChannel(maskPng)
    .png({ compressionLevel: 6 })
    .toBuffer();
}
