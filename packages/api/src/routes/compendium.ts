import { Router } from 'express';
import { runPipeline } from '../compendium/parser.ts';
import { listCompendiumAdventures, deleteCompendiumAdventure } from '../compendium/storage.ts';

export const compendiumRouter = Router();

compendiumRouter.get('/', async (_req, res) => {
  try {
    const adventures = await listCompendiumAdventures();
    res.json(adventures);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function send(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    await runPipeline(slug, name, name, markdown, tierKey, msg => {
      send({ type: 'progress', message: msg });
    });
    send({ type: 'complete', slug });
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  } finally {
    res.end();
  }
});

compendiumRouter.delete('/:slug', async (req, res) => {
  try {
    await deleteCompendiumAdventure(req.params.slug);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
