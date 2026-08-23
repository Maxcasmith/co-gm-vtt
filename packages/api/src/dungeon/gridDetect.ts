import sharp from 'sharp';

// Shared by props.ts and creaturePortraits.ts — both prompt the model to draw a thin black line on
// every internal cell boundary (never the outer edge) as a visual fence, then crop between whatever
// lines actually got drawn instead of trusting a uniform division. Confirmed live (props) that the
// model doesn't reliably draw the exact requested row/column count, or draws the grid inset from the
// atlas edge with a plain-background gutter around it — a fixed division or a windowed search around
// the "expected" position both silently mis-crop in those cases. This scans each whole axis with no
// assumption about how many lines there should be.
const BLACK_LUMA = 90; // a pixel this dark or darker on all three channels counts as part of the drawn grid line
const LINE_ALPHA_MIN = 200; // the grid line must also be this opaque — on a real-alpha atlas, transparent background commonly exports as (0,0,0) with alpha 0, which is RGB-identical to the opaque black line
const DARK_BAND_THRESHOLD = 0.85; // a row/col must be at least this dark edge-to-edge to count as part of a line — an object's own dark pixels only ever cover a fraction of a row/col, never nearly all of it
const MIN_BAND_THICKNESS = 2; // ignore single stray dark pixels/rows that aren't a real drawn line
const MIN_CONTENT_PIXELS = 50; // a region needs at least this many non-background pixels to count as real object content, not stray border-corner anti-aliasing
const AA_EDGE_MARGIN = 6; // pixels of anti-aliasing blend to skip right past a detected line's edge before scanning for content

interface DarkBand { start: number; end: number; }

function findDarkBands(darkFractionAt: (pos: number) => number, axisLength: number): DarkBand[] {
  const bands: DarkBand[] = [];
  let start = -1;
  for (let p = 0; p < axisLength; p++) {
    const dark = darkFractionAt(p) > DARK_BAND_THRESHOLD;
    if (dark && start === -1) start = p;
    if (!dark && start !== -1) { bands.push({ start, end: p - 1 }); start = -1; }
  }
  if (start !== -1) bands.push({ start, end: axisLength - 1 });
  return bands.filter(b => b.end - b.start + 1 >= MIN_BAND_THICKNESS);
}

// Turns raw dark bands into cell-boundary positions. The atlas's own outer border (unwanted — the
// prompt explicitly bans a line there) is always the first/last band found, but isn't always flush
// against pixel 0/axisLength — the model sometimes draws the whole grid as a smaller square with a
// plain-background gutter around it. `hasContentBefore`/`hasContentAfter` settle it: if there's no
// real object content between the axis start and a leading band, that band is the border and gets
// skipped past (its far edge becomes the boundary). Every other band is a real internal divider; its
// center is the split point between the two cells.
function boundariesFromBands(bands: DarkBand[], axisLength: number, hasContentBefore: (pos: number) => boolean, hasContentAfter: (pos: number) => boolean): number[] {
  let internal = bands;
  const boundaries: number[] = [];

  if (internal.length && !hasContentBefore(internal[0]!.start)) {
    boundaries.push(internal[0]!.end + 1);
    internal = internal.slice(1);
  } else {
    boundaries.push(0);
  }

  let trailing = axisLength;
  if (internal.length && !hasContentAfter(internal[internal.length - 1]!.end + 1)) {
    trailing = internal[internal.length - 1]!.start;
    internal = internal.slice(0, -1);
  }

  for (const band of internal) boundaries.push(Math.round((band.start + band.end) / 2));
  boundaries.push(trailing);
  return boundaries;
}

export interface GridBoundaries { rows: number[]; cols: number[]; }

// `isKeyColor` distinguishes the flat background color (magenta chroma-key for props, red for
// portraits) from real object content — every caller's background is a different flat color, so
// that check is the one thing callers must supply.
export async function detectGridBoundaries(atlas: Buffer, width: number, height: number, isKeyColor: (r: number, g: number, b: number) => boolean): Promise<GridBoundaries> {
  const { data } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const isDark = (i: number) => data[i]! < BLACK_LUMA && data[i + 1]! < BLACK_LUMA && data[i + 2]! < BLACK_LUMA && data[i + 3]! >= LINE_ALPHA_MIN;

  function isBackgroundPixel(i: number): boolean {
    if (data[i + 3]! === 0) return true;
    if (isDark(i)) return true;
    return isKeyColor(data[i]!, data[i + 1]!, data[i + 2]!);
  }

  function rowDarkFraction(y: number): number {
    let dark = 0;
    const base = y * width * 4;
    for (let x = 0; x < width; x++) if (isDark(base + x * 4)) dark++;
    return dark / width;
  }
  function colDarkFraction(x: number): number {
    let dark = 0;
    for (let y = 0; y < height; y++) if (isDark((y * width + x) * 4)) dark++;
    return dark / height;
  }

  function rowsHaveContent(y0: number, y1: number): boolean {
    let count = 0;
    for (let y = y0; y < y1; y++) {
      const base = y * width * 4;
      for (let x = 0; x < width; x++) if (!isBackgroundPixel(base + x * 4) && ++count >= MIN_CONTENT_PIXELS) return true;
    }
    return false;
  }
  function colsHaveContent(x0: number, x1: number): boolean {
    let count = 0;
    for (let y = 0; y < height; y++) {
      const base = y * width * 4;
      for (let x = x0; x < x1; x++) if (!isBackgroundPixel(base + x * 4) && ++count >= MIN_CONTENT_PIXELS) return true;
    }
    return false;
  }

  return {
    rows: boundariesFromBands(findDarkBands(rowDarkFraction, height), height,
      pos => rowsHaveContent(0, Math.max(0, pos - AA_EDGE_MARGIN)),
      pos => rowsHaveContent(Math.min(height, pos + AA_EDGE_MARGIN), height)),
    cols: boundariesFromBands(findDarkBands(colDarkFraction, width), width,
      pos => colsHaveContent(0, Math.max(0, pos - AA_EDGE_MARGIN)),
      pos => colsHaveContent(Math.min(width, pos + AA_EDGE_MARGIN), width)),
  };
}
