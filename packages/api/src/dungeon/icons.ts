import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { iconSlug } from 'shared';
import { ICONS_DIR } from '../storage.ts';
import { getMediaStore } from '../storage/index.ts';
import { generateTilesetAtlas, describeImage } from '../providers/openai.ts';
import { buildIconAtlasPrompt } from '../session-processor/imagePrompts.ts';
import { computeGridRects } from './tilesets.ts';
import { logError } from '../logger.ts';

const GRID = 4;
// Every shipped icon (packages/client/src/assets/icons/*) is 120x120 — matched exactly so a
// generated icon can drop straight into Item.iconPath/AbilityDef alongside the hand-made ones.
const CELL_SIZE = 120;
const ATLAS_SIZE = GRID * CELL_SIZE; // 480 — the atlas gets force-resized to this before cropping,
// regardless of what size the model actually returns (the request `size` param is a request, not a
// guarantee) — this is what makes the per-cell size a hard, code-enforced 120x120 rather than a
// soft "hopefully" from prompt text alone. Same technique as dungeon/tilesets.ts.
const REAL_CAP = GRID * GRID; // 16 — one atlas per batch

const __dir = path.dirname(fileURLToPath(import.meta.url));
// The real, currently-shipped default icon frame — read from disk so the prompt describes the
// actual thing, not a guessed-at description of what a "default frame" might look like.
const DEFAULT_FRAME_PATH = path.resolve(__dir, '../../../client/src/assets/icons/Icon-Frame-Blue.jpg');

export interface PendingIcon {
  name: string;
  description: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// No `/images/edits` (image-conditioned generation) precedent exists anywhere in this codebase —
// every image call here is text-to-image only. The established idiom for "feed a real image's
// styling into a later prompt" is storyboard.ts's describeImage()-then-splice pattern (a vision
// pass turns the reference into a text description, which then goes into the next prompt). Reused
// here rather than adding new multipart/edit-endpoint infrastructure for a single caller.
async function describeDefaultFrame(apiKey: string): Promise<string> {
  const buffer = await readFile(DEFAULT_FRAME_PATH);
  const instruction = 'This is a game UI icon frame, currently empty. Describe its exact visual style in detail — border shape and colour, background colour/texture, any bevel, glow, or ornament — so another artist could redraw this identical frame from your description alone. 2-3 sentences only.';
  return describeImage(buffer.toString('base64'), apiKey, instruction);
}

// One atlas, up to 16 icons. Always overwrites icon.jpg for every item in `batch` — same
// "caller decides scope" contract as generatePropSpriteBatch. Folder name is iconSlug(name), the
// exact same convention every display spot uses to predict the URL — see storage/icons layout note
// on ICONS_DIR.
async function generateIconBatch(batch: PendingIcon[], frameDescription: string, apiKey: string, model: string, onProgress?: (message: string) => void): Promise<void> {
  function report(message: string) {
    console.log(`[icons] ${message}`);
    onProgress?.(message);
  }
  report(`generating icons for: ${batch.map(b => b.name).join(', ')}`);

  const prompt = buildIconAtlasPrompt(batch, frameDescription, CELL_SIZE);
  report(`requesting atlas from ${model}…`);
  const rawAtlas = await generateTilesetAtlas(prompt, apiKey, model, '1024x1024');

  const rawMeta = await sharp(rawAtlas).metadata();
  report(`atlas received (${rawMeta.width}x${rawMeta.height})`);

  // Saved unmodified, before the hard resize below — same review purpose as tilesets/props' source
  // saves. Icons have no per-batch slug to nest under, so these collect flat under _source.
  const sourceExt = rawMeta.format === 'png' ? 'png' : 'jpg';
  const sourceDir = path.join(ICONS_DIR, '_source');
  const sourceFile = `icons_${Date.now()}.${sourceExt}`;
  await getMediaStore().put(path.join(sourceDir, sourceFile), rawAtlas);
  report(`saved source atlas for review: /api/icons/_source/${sourceFile}`);

  report(`resizing atlas to ${ATLAS_SIZE}x${ATLAS_SIZE} (${CELL_SIZE}x${CELL_SIZE} icons)…`);
  const atlas = await sharp(rawAtlas).resize(ATLAS_SIZE, ATLAS_SIZE, { fit: 'fill' }).toBuffer();
  const { width, height } = await sharp(atlas).metadata();
  if (!width || !height) throw new Error('Resized icon atlas has no dimensions');

  const { rects, warning } = computeGridRects(width, height, GRID, GRID, batch.map(b => iconSlug(b.name)));
  if (warning) report(`warning: ${warning}`);
  report(`cropping into ${rects.length} icons…`);

  await Promise.all(rects.map(async rect => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const dir = path.join(ICONS_DIR, rect.material);
    const icon = await sharp(atlas).extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).jpeg({ quality: 90 }).toBuffer();
    await getMediaStore().put(path.join(dir, 'icon.jpg'), icon);
  }));
  report(`wrote ${rects.length} icons to storage/icons/`);
}

// Entry point for the admin "Create Icons" modal. Chunks into 16-icon batches (one atlas each,
// same REAL_CAP as tilesets' 4x4 grid) and runs them sequentially so progress reads as one
// continuous stream rather than parallel/interleaved atlases.
export async function generateIconsForItems(items: PendingIcon[], apiKey: string, model: string, onProgress?: (message: string) => void): Promise<void> {
  function report(message: string) {
    console.log(`[icons] ${message}`);
    onProgress?.(message);
  }
  if (!items.length) return;

  report('describing the default icon frame…');
  let frameDescription: string;
  try {
    frameDescription = await describeDefaultFrame(apiKey);
  } catch (err) {
    logError('dungeon/icons:describeDefaultFrame', err);
    frameDescription = 'A square icon frame with a beveled dark border and a deep blue-black background.';
    report('warning: could not describe the default frame — using a fallback description.');
  }

  const batches = chunk(items, REAL_CAP);
  for (let i = 0; i < batches.length; i++) {
    if (batches.length > 1) report(`batch ${i + 1} of ${batches.length}…`);
    await generateIconBatch(batches[i]!, frameDescription, apiKey, model, onProgress);
  }
}
