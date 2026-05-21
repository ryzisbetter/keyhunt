/**
 * ranking.js — Result Ranking Engine
 * ----------------------------------
 * Combines price competitiveness with seller trust so the results aren't a
 * naive "cheapest first" list that surfaces sketchy sellers. The engine
 * produces TWO useful orderings:
 *
 *   1. priceSorted   — strict low→high price (what the spec asks the list to
 *                      ultimately be sorted by), used as the default view.
 *   2. valueScore    — a composite "best value" signal (price + trust +
 *                      delivery) attached to every listing so the UI can offer
 *                      "Highest rated" / "Trusted only" / "Fastest delivery"
 *                      filters and a recommended pick without re-querying.
 *
 * Every listing carries its computed scores, so ranking is transparent.
 */

/**
 * @param {Listing[]} listings  analyzed listings (already have sellerScore)
 * @param {object} opts { amount }
 */
export function rankListings(listings, { amount }) {
  if (listings.length === 0) {
    return { results: [], cheapest: null, bestValue: null, priceStats: null };
  }

  const prices = listings.map((l) => l.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = Math.max(0.01, maxPrice - minPrice);

  const maxDelivery = Math.max(...listings.map((l) => l.deliveryMinutes), 1);

  // Compute a composite value score for every listing.
  const scored = listings.map((l) => {
    // Cheaper = higher (1 best). Normalized within result set.
    const priceScore = 1 - (l.price - minPrice) / priceRange;
    // Seller trust normalized 0..1.
    const trustScore = l.sellerScore / 100;
    // Faster delivery = higher.
    const deliveryScore = 1 - l.deliveryMinutes / maxDelivery;

    // Weighted blend: trust slightly outweighs raw price so a marginally
    // pricier-but-far-safer seller can edge out a cheap risky one.
    const valueScore = +(
      priceScore * 0.45 +
      trustScore * 0.4 +
      deliveryScore * 0.15
    ).toFixed(4);

    return { ...l, priceScore: +priceScore.toFixed(3), valueScore };
  });

  // Default ordering required by spec: lowest price → highest price.
  // Tie-break by seller score so equally-priced listings favor trust.
  const priceSorted = [...scored].sort(
    (a, b) => a.price - b.price || b.sellerScore - a.sellerScore
  );

  // Trim to requested amount AFTER ranking across the full pool.
  const results = priceSorted.slice(0, amount);

  const cheapest = results.reduce((m, l) => (l.price < m.price ? l : m), results[0]);
  const bestValue = [...results].sort((a, b) => b.valueScore - a.valueScore)[0];

  return {
    results,
    cheapest: cheapest?.id ?? null,
    bestValue: bestValue?.id ?? null,
    priceStats: {
      min: minPrice,
      max: maxPrice,
      median: median(prices),
      avgSellerScore: Math.round(
        scored.reduce((a, l) => a + l.sellerScore, 0) / scored.length
      ),
    },
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(2);
}
