/** A documented data-quality index, not a calibrated probability or an impact estimate. */
export function dataConfidence(input: {
  quality: number;
  currentCount: number;
  historySamples: number;
  targetSamples: number;
  coefficientOfVariation: number;
  ageHours: number;
  freshnessHours: number;
}) {
  const quality = Math.max(0, Math.min(1, input.quality));
  const support = Math.min(1, input.currentCount / 50);
  const history = Math.min(1, input.historySamples / input.targetSamples);
  const stability = 1 / (1 + Math.max(0, input.coefficientOfVariation));
  const freshness = Math.max(0, 1 - input.ageHours / input.freshnessHours);
  let score =
    0.3 * quality +
    0.15 * support +
    0.3 * history +
    0.1 * stability +
    0.15 * freshness;
  if (input.historySamples < input.targetSamples * 0.5)
    score = Math.min(score, 0.55);
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}
export const CONFIDENCE_METHOD =
  "Data-quality index: 30% detection quality, 15% observation support (capped at 50), 30% historical window coverage, 10% reference stability (1/(1+CV)), 15% freshness. History below half the target caps the score at LOW. Not a probability of an incident or cause.";
