/**
 * server.js — API Gateway
 * -----------------------
 * Thin HTTP layer over the aggregation pipeline. Two ways to search:
 *
 *   GET /api/search        → one-shot JSON (used when result is cached / for API consumers)
 *   GET /api/search/stream → Server-Sent Events: streams progress stages then
 *                            the final payload. Powers the live loading UI.
 *
 * Also serves the static frontend from /public.
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { aggregate, getStages } from './services/aggregator.js';
import { resultCache } from './services/cache.js';
import { SOURCES } from './services/sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors());
app.use(express.json());
app.use(
  '/api',
  rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false })
);

// ---- helpers ------------------------------------------------------------
function parseParams(q) {
  const game = String(q.game || '').trim();
  const kindRaw = String(q.kind || 'both').toLowerCase();
  const kind = ['account', 'key', 'both'].includes(kindRaw) ? kindRaw : 'both';
  let amount = parseInt(q.amount, 10);
  if (isNaN(amount)) amount = 10;
  amount = Math.max(5, Math.min(25, amount)); // enforce 5–25
  return { game, kind, amount };
}

// ---- metadata endpoints -------------------------------------------------
app.get('/api/sources', (req, res) => {
  res.json(
    SOURCES.filter((s) => s.enabled).map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      icon: s.icon,
      color: s.color,
      access: s.access,
      sells: s.sells,
    }))
  );
});

app.get('/api/stages', (req, res) => res.json(getStages()));

app.get('/api/cache/stats', (req, res) => res.json(resultCache.stats()));

// ---- one-shot search ----------------------------------------------------
app.get('/api/search', async (req, res) => {
  const { game, kind, amount } = parseParams(req.query);
  if (!game) return res.status(400).json({ error: 'Missing "game" parameter.' });

  const key = resultCache.constructor.key({ game, kind, amount });
  const cached = resultCache.get(key);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const payload = await aggregate({ game, kind, amount });
    resultCache.set(key, payload);
    res.json({ ...payload, cached: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Aggregation failed.' });
  }
});

// ---- streaming search (SSE) --------------------------------------------
app.get('/api/search/stream', async (req, res) => {
  const { game, kind, amount } = parseParams(req.query);
  if (!game) return res.status(400).json({ error: 'Missing "game" parameter.' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const key = resultCache.constructor.key({ game, kind, amount });
  const cached = resultCache.get(key);

  try {
    if (cached) {
      // Replay stages quickly for a consistent UX, then deliver cached data.
      for (const s of getStages()) {
        send('progress', { ...s, pct: undefined, detail: 'From cache' });
        await new Promise((r) => setTimeout(r, 90));
      }
      send('result', { ...cached, cached: true });
      return res.end();
    }

    const payload = await aggregate({ game, kind, amount }, (evt) =>
      send('progress', evt)
    );
    resultCache.set(key, payload);
    send('result', { ...payload, cached: false });
    res.end();
  } catch (err) {
    console.error(err);
    send('error', { error: 'Aggregation failed.' });
    res.end();
  }
});

// ---- static frontend ----------------------------------------------------
app.use(express.static(join(__dirname, '..', 'frontend')));
app.get('*', (req, res) =>
  res.sendFile(join(__dirname, '..', 'frontend', 'index.html'))
);

app.listen(PORT, () => {
  console.log(`KeyHunt running → http://localhost:${PORT}`);
});
