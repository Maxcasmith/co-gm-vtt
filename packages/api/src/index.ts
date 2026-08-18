import { configRouter } from './routes/config.ts';
import { campaignsRouter } from './routes/campaigns.ts';
import { compendiumRouter } from './routes/compendium.ts';
import { adventuresRouter } from './routes/adventures.ts';
import { mapsRouter } from './routes/maps.ts';
import { adminRouter } from './routes/admin.ts';
import { spellsRouter } from './routes/spells.ts';
import { tilesetsRouter } from './routes/tilesets.ts';
import { creaturesRouter } from './routes/creatures.ts';
import { debugPerfRouter } from './routes/debugPerf.ts';
import { app, httpServer } from './state.ts';
import { registerSocketHandlers } from './socketHandlers/index.ts';

app.use('/api/config', configRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/campaigns', mapsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/compendium', compendiumRouter);
app.use('/api/adventures', adventuresRouter);
app.use('/api/spells', spellsRouter);
app.use('/api/tilesets', tilesetsRouter);
app.use('/api/creatures', creaturesRouter);
app.use('/api/debug/perf-log', debugPerfRouter);

registerSocketHandlers();

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`api listening on :${PORT}`);
});
