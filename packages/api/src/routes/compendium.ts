import { Router, type Response } from 'express';
import { runPipeline, requestPause, ExtractionPausedError } from '../compendium/parser.ts';
import {
  listCompendiumAdventures, deleteCompendiumAdventure,
  loadCompendiumMeta, loadCompendiumRaw,
} from '../compendium/storage.ts';
import { logError } from '../logger.ts';

export const compendiumRouter = Router();

compendiumRouter.get('/', async (_req, res) => {
  try {
    const adventures = await listCompendiumAdventures();
    res.json(adventures);
  } catch (err) {
    logError('routes/compendium:list', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

function sseHeaders(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

async function streamPipeline(
  res: Response,
  run: (onProgress: (msg: string) => void, onToken: (token: string) => void) => Promise<void>,
) {
  function send(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    await run(
      msg => send({ type: 'progress', message: msg }),
      token => send({ type: 'token', text: token }),
    );
    send({ type: 'complete' });
  } catch (err) {
    if (err instanceof ExtractionPausedError) {
      logError('routes/compendium:streamPipeline:paused', err);
      send({ type: 'paused', message: err.message });
    } else {
      logError('routes/compendium:streamPipeline', err);
      send({ type: 'error', message: (err as Error).message });
    }
  } finally {
    res.end();
  }
}

compendiumRouter.post('/upload', async (req, res) => {
  const { markdown, model, name } = req.body as {
    markdown?: string;
    model?: 'light' | 'thinking';
    name?: string;
  };

  if (!markdown || !name) {
    res.status(400).json({ error: 'markdown and name are required' });
    return;
  }

  const tierKey: 'light' | 'thinking' = model === 'thinking' ? 'thinking' : 'light';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  sseHeaders(res);
  await streamPipeline(res, (onProgress, onToken) => runPipeline(slug, name, name, markdown, tierKey, onProgress, onToken));
});

compendiumRouter.post('/:slug/resume', async (req, res) => {
  const { slug } = req.params;
  const meta = await loadCompendiumMeta(slug);
  if (!meta || meta.status !== 'draft') {
    res.status(400).json({ error: 'Adventure is not resumable' });
    return;
  }
  const raw = await loadCompendiumRaw(slug);
  if (!raw) {
    res.status(400).json({ error: 'No saved source markdown for this adventure' });
    return;
  }

  sseHeaders(res);
  await streamPipeline(res, (onProgress, onToken) =>
    runPipeline(slug, meta.name, meta.source, raw, meta.tierKey, onProgress, onToken, meta.resumeFromChunk));
});

compendiumRouter.post('/:slug/pause', (req, res) => {
  requestPause(req.params.slug);
  res.json({ ok: true });
});

compendiumRouter.delete('/:slug', async (req, res) => {
  try {
    await deleteCompendiumAdventure(req.params.slug);
    res.json({ ok: true });
  } catch (err) {
    logError('routes/compendium:delete', err);
    res.status(500).json({ error: (err as Error).message });
  }
});
