/**
 * reviewAnalysis.js — Review Analysis Layer
 * -----------------------------------------
 * Turns raw review text + rating signals into:
 *   - a sentiment score (-1 .. +1)
 *   - a human-readable review summary
 *   - a composite seller score (0 .. 100)
 *
 * The sentiment engine is a transparent lexicon-based scorer. It is
 * intentionally simple and explainable (no opaque model), which suits a
 * comparison tool where users want to understand WHY a seller ranks well.
 */

const POSITIVE_LEXICON = new Set([
  'perfect', 'perfectly', 'great', 'smooth', 'fast', 'instant', 'trusted',
  'legit', 'responsive', 'reliable', 'recommend', 'easy', 'worked', 'works',
  'excellent', 'quick', 'good', 'happy', 'flawless', 'genuine', 'no complaints',
]);

const NEGATIVE_LEXICON = new Set([
  'slow', 'wait', 'waited', 'late', 'tedious', 'issue', 'issues', 'problem',
  'problems', 'restriction', 'restrictions', 'refund', 'failed', 'fail',
  'scam', 'fake', 'broken', 'delay', 'delayed', 'hours', 'longer',
]);

const INTENSIFIERS = new Set(['very', 'really', 'extremely', 'super']);
const NEGATORS = new Set(['not', 'no', "didn't", 'never', "wasn't", "couldn't"]);

/** Score a single review string in [-1, 1]. */
function scoreText(text) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let score = 0;
  let hits = 0;
  let intensity = 1;
  let negate = false;

  for (const tok of tokens) {
    if (INTENSIFIERS.has(tok)) {
      intensity = 1.5;
      continue;
    }
    if (NEGATORS.has(tok)) {
      negate = true;
      continue;
    }
    let val = 0;
    if (POSITIVE_LEXICON.has(tok)) val = 1;
    else if (NEGATIVE_LEXICON.has(tok)) val = -1;

    if (val !== 0) {
      if (negate) val *= -1;
      score += val * intensity;
      hits++;
    }
    intensity = 1;
    negate = false;
  }

  if (hits === 0) return 0;
  return Math.max(-1, Math.min(1, score / hits));
}

const LABELS = [
  { min: 0.6, label: 'Overwhelmingly Positive' },
  { min: 0.3, label: 'Mostly Positive' },
  { min: 0.1, label: 'Generally Positive' },
  { min: -0.1, label: 'Mixed' },
  { min: -0.4, label: 'Mostly Negative' },
  { min: -1.1, label: 'Negative' },
];

function sentimentLabel(score) {
  return LABELS.find((l) => score >= l.min).label;
}

/**
 * Analyze a single listing's review/rating data.
 * @returns enriched listing fields: sentimentScore, sentimentLabel,
 *          reviewSummary, sellerScore (0-100), trustTier
 */
export function analyzeListing(listing, source) {
  const reviewScores = (listing.reviews || []).map(scoreText);
  const avgSentiment =
    reviewScores.length > 0
      ? reviewScores.reduce((a, b) => a + b, 0) / reviewScores.length
      : 0;

  // Normalize the star rating to [-1, 1] (3.0 stars = neutral).
  const ratingNorm = (listing.ratingValue - 3) / 2;

  // Confidence from review volume — many ratings = more trustworthy signal.
  const volumeConfidence = Math.min(1, Math.log10(listing.ratingCount + 1) / 3.5);

  // Composite sentiment blends text sentiment + star rating.
  const blendedSentiment = avgSentiment * 0.45 + ratingNorm * 0.55;

  /**
   * Seller score (0-100) blends:
   *   - blended sentiment (quality of feedback)
   *   - review volume confidence (how much we can trust it)
   *   - source base reputation (platform-level trust)
   */
  const sellerScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        50 + // neutral baseline
          blendedSentiment * 28 +
          volumeConfidence * 12 +
          (source.baseReputation - 0.75) * 40
      )
    )
  );

  let trustTier = 'standard';
  if (sellerScore >= 85) trustTier = 'elite';
  else if (sellerScore >= 72) trustTier = 'trusted';
  else if (sellerScore < 55) trustTier = 'caution';

  // Build a short, human summary.
  const positive = reviewScores.filter((s) => s > 0.1).length;
  const negative = reviewScores.filter((s) => s < -0.1).length;
  const total = reviewScores.length || 0;
  let reviewSummary;
  if (total === 0) {
    reviewSummary = `No written reviews yet · ${listing.ratingValue.toFixed(
      1
    )}★ from ${listing.ratingCount.toLocaleString()} ratings`;
  } else {
    // "Favorable" = positive or neutral text, so the headline % aligns with
    // the star-weighted sentiment label rather than contradicting it.
    const favorable = reviewScores.filter((s) => s >= -0.1).length;
    const pct = Math.round((favorable / total) * 100);
    reviewSummary = `${sentimentLabel(
      blendedSentiment
    )} · ${listing.ratingValue.toFixed(1)}★ · ${pct}% favorable of ${total} sampled (${listing.ratingCount.toLocaleString()} ratings)`;
  }

  return {
    ...listing,
    sentimentScore: +blendedSentiment.toFixed(3),
    sentimentLabel: sentimentLabel(blendedSentiment),
    reviewSummary,
    positiveReviewCount: positive,
    negativeReviewCount: negative,
    sellerScore,
    trustTier,
  };
}
