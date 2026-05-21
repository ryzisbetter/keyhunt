/**
 * aggregator.js — Backend Aggregation Service (orchestrator)
 * ----------------------------------------------------------
 * Coordinates the full pipeline and emits progress events for the streaming
 * loading experience:
 *
 *   collecting → checking → reviews → ranking → finalizing
 *
 * Stages map to real work:
 *   collecting : query every allowed source in parallel (via providers)
 *   checking   : validate/normalize prices, drop out-of-stock/invalid
 *   reviews    : run the review analysis layer over the pooled listings
 *   ranking    : run the ranking engine, trim to requested amount
 *   finalizing : attach source metadata for the UI, assemble payload
 *
 * `onProgress(stage)` is invoked with { stage, label, pct, detail } so the
 * server can forward these as Server-Sent Events.
 */

import { activeSources, sourceById } from './sources.js';
import { fetchListings } from './sampleProvider.js';
import { analyzeListing } from './reviewAnalysis.js';
import { rankListings } from './ranking.js';

const STAGES = [
  { stage: 'collecting', label: 'Collecting listings', pct: 0.15 },
  { stage: 'checking', label: 'Checking prices', pct: 0.4 },
  { stage: 'reviews', label: 'Reading reviews', pct: 0.62 },
  { stage: 'ranking', label: 'Ranking results', pct: 0.84 },
  { stage: 'finalizing', label: 'Finalizing', pct: 1 },
];

export function getStages() {
  return STAGES.map((s) => ({ stage: s.stage, label: s.label }));
}

/**
 * Run the aggregation pipeline.
 * @param {object} p { game, kind, amount }
 * @param {(evt)=>void} onProgress optional progress callback
 */
export async function aggregate({ game, kind, amount }, onProgress = () => {}) {
  const emit = (stageKey, detail) => {
    const meta = STAGES.find((s) => s.stage === stageKey);
    onProgress({ stage: stageKey, label: meta.label, pct: meta.pct, detail });
  };

  const sources = activeSources(kind);

  // ---- Stage 1: collecting (parallel fan-out across allowed sources) -----
  emit('collecting', `Querying ${sources.length} supported sources`);
  const perSource = await Promise.all(
    sources.map(async (source) => {
      try {
        const listings = await fetchListings({ game, source, kind, want: amount });
        return listings;
      } catch (err) {
        // A single source failing must never break the whole search.
        return [];
      }
    })
  );
  let pooled = perSource.flat();

  // ---- Stage 2: checking prices (validate + normalize) -------------------
  emit('checking', `Validating ${pooled.length} listings`);
  await tick(180);
  pooled = pooled.filter(
    (l) =>
      typeof l.price === 'number' &&
      isFinite(l.price) &&
      l.price > 0 &&
      l.inStock !== false
  );

  // ---- Stage 3: reading reviews (review analysis layer) ------------------
  emit('reviews', `Analyzing seller reputation across ${pooled.length} listings`);
  await tick(220);
  const analyzed = pooled.map((l) => analyzeListing(l, sourceById(l.sourceId)));

  // ---- Stage 4: ranking --------------------------------------------------
  emit('ranking', 'Sorting by price and weighting seller trust');
  await tick(200);
  const ranked = rankListings(analyzed, { amount });

  // ---- Stage 5: finalizing (attach UI-facing source metadata) ------------
  emit('finalizing', 'Assembling results');
  await tick(150);
  const results = ranked.results.map((l) => {
    const src = sourceById(l.sourceId);
    return {
      id: l.id,
      title: l.title,
      price: l.price,
      currency: l.currency,
      url: l.url,
      kind: l.kind,
      ratingValue: l.ratingValue,
      ratingCount: l.ratingCount,
      deliveryMinutes: l.deliveryMinutes,
      sellerScore: l.sellerScore,
      trustTier: l.trustTier,
      sentimentLabel: l.sentimentLabel,
      reviewSummary: l.reviewSummary,
      valueScore: l.valueScore,
      isCheapest: l.id === ranked.cheapest,
      isBestValue: l.id === ranked.bestValue,
      source: {
        id: src.id,
        name: src.name,
        domain: src.domain,
        icon: src.icon,
        color: src.color,
        access: src.access,
      },
    };
  });

  return {
    query: { game, kind, amount },
    sourcesQueried: sources.map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
    totalDiscovered: pooled.length,
    returned: results.length,
    priceStats: ranked.priceStats,
    results,
    generatedAt: new Date().toISOString(),
  };
}

function tick(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
