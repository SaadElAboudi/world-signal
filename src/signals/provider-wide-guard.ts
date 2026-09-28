/**
 * A coordinated drop across many independent country series is more likely to
 * be a provider/measurement artifact than simultaneous national incidents.
 * This guard suppresses new country alerts; it never interprets it as normal.
 */
export function providerWideAnomaly(input: {
  assessedCountries: number;
  anomalousCountries: number;
  minimumCountries?: number;
  fractionThreshold?: number;
}) {
  const minimum = input.minimumCountries ?? 10;
  const fraction = input.assessedCountries > 0
    ? input.anomalousCountries / input.assessedCountries
    : 0;
  return {
    affectedFraction: fraction,
    suppressed:
      input.assessedCountries >= minimum &&
      fraction >= (input.fractionThreshold ?? 0.3),
  };
}
