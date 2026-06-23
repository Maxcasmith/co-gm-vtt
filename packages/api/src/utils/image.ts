import sharp from 'sharp';

const TOKEN_SIZE = 256;
const BORDER_PX = 2;
const r = TOKEN_SIZE / 2;
const innerR = r - BORDER_PX;

// Pre-built SVG buffers — same every call, no need to recreate
const CIRCLE_MASK = Buffer.from(
  `<svg width="${TOKEN_SIZE}" height="${TOKEN_SIZE}"><circle cx="${r}" cy="${r}" r="${innerR}" fill="white"/></svg>`
);
const CIRCLE_BORDER = Buffer.from(
  `<svg width="${TOKEN_SIZE}" height="${TOKEN_SIZE}"><circle cx="${r}" cy="${r}" r="${innerR}" fill="none" stroke="silver" stroke-width="${BORDER_PX}"/></svg>`
);

export async function processPortrait(input: Buffer): Promise<{ portrait: Buffer; token: Buffer }> {
  // Center-crop to 1:1, save as JPEG portrait
  const portrait = await sharp(input)
    .resize(512, 512, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 90 })
    .toBuffer();

  // Center-crop to 256×256, punch circular mask, overlay silver ring
  const token = await sharp(input)
    .resize(TOKEN_SIZE, TOKEN_SIZE, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .composite([
      { input: CIRCLE_MASK,   blend: 'dest-in' },
      { input: CIRCLE_BORDER, blend: 'over'    },
    ])
    .png()
    .toBuffer();

  return { portrait, token };
}
