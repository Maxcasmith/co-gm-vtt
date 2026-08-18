import { Router } from 'express';
import { logDebug } from '../logger.ts';

// ponytail: debug-only sink for the client's perf overlay (see client's drawScene.ts
// SHOW_PERF_OVERLAY) — the client can't hand its own console output back to whoever's debugging
// remotely, so on an attack-grade lag spike it POSTs the section breakdown here instead, landing
// in storage/logs/<date>.log where it can be read directly. Delete this route + its one call site
// in drawScene.ts once the lag is diagnosed.
export const debugPerfRouter = Router();

debugPerfRouter.post('/', (req, res) => {
  logDebug(`[perf] ${JSON.stringify(req.body)}`);
  res.sendStatus(204);
});
