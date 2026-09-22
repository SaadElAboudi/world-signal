export type TemperatureExtremeKind = "heat" | "cold";

export interface TemperatureReference {
  meanC: number;
  stddevC: number;
  p10C: number;
  p90C: number;
  sampleCount: number;
}

type ArchiveDaily = {
  time?: string[];
  temperature_2m_max?: Array<number | null>;
  temperature_2m_min?: Array<number | null>;
};

type ArchivePayload = { daily?: ArchiveDaily };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function dayOfYear(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86_400_000) + 1;
}

function circularDistance(a: number, b: number, days = 366) {
  const d = Math.abs(a - b);
  return Math.min(d, days - d);
}

function percentile(sorted: number[], q: number) {
  if (!sorted.length) throw new Error("No climatology samples");
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export function temperatureReferenceFromArchive(
  payload: ArchivePayload,
  targetDate: Date,
  kind: TemperatureExtremeKind,
  windowDays = 7,
): TemperatureReference {
  const daily = payload.daily;
  if (!daily?.time) throw new Error("Missing archive daily data");
  const values = kind === "heat" ? daily.temperature_2m_max : daily.temperature_2m_min;
  if (!values || values.length !== daily.time.length)
    throw new Error("Incomplete archive temperature data");
  const targetDoy = dayOfYear(targetDate);
  const samples: number[] = [];
  daily.time.forEach((value, index) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return;
    if (date.getUTCFullYear() < 1991 || date.getUTCFullYear() > 2020) return;
    if (circularDistance(dayOfYear(date), targetDoy) > windowDays) return;
    const candidate = values[index];
    if (finite(candidate)) samples.push(candidate);
  });
  if (samples.length < 300) throw new Error("Insufficient ERA5 climatology samples");
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    meanC: Number(mean.toFixed(2)),
    stddevC: Number(Math.sqrt(variance).toFixed(2)),
    p10C: Number(percentile(sorted, 0.1).toFixed(2)),
    p90C: Number(percentile(sorted, 0.9).toFixed(2)),
    sampleCount: samples.length,
  };
}

export function temperatureAnomaly(valueC: number, reference: TemperatureReference) {
  const deltaC = valueC - reference.meanC;
  const zscore = reference.stddevC > 0 ? deltaC / reference.stddevC : null;
  return {
    deltaC: Number(deltaC.toFixed(2)),
    zscore: zscore === null ? null : Number(zscore.toFixed(2)),
  };
}
