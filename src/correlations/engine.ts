import { createHash } from "node:crypto";
import type { Severity } from "../core/types";
import { providerMetadata } from "../providers/registry";
import { geographicRelation, spatialKeys, validScope } from "./geography";
import {
  CORRELATION_WINDOWS,
  type CandidateDecision,
  type CorrelatedEvent,
  type CorrelationInput,
  type CorrelationWindow,
  type GeographicScope,
  type ProviderConfirmation,
} from "./types";
const HOUR = 3600000;
const severityValue: Record<Severity, number> = {
  notable: 0.4,
  elevated: 0.7,
  significant: 1,
};
const start = (input: CorrelationInput) =>
  Date.parse(input.signal.startedAt ?? input.signal.timestamp);
const end = (input: CorrelationInput) =>
  Date.parse(input.endedAt ?? input.signal.timestamp);
export const CORRELATION_METHOD =
  "spatiotemporal-v1: geography 30%, temporal proximity 25%, severity 15%, system independence 15%, minimum component confidence 15%; threshold 0.70. Country containment or shared H3 cell; maximum 24-hour onset span. Grouping describes co-occurrence, not causality. Ranking is a heuristic, not scientific certainty.";
export function scoreCandidate(
  a: CorrelationInput,
  b: CorrelationInput,
  windowHours: CorrelationWindow = 6,
  threshold = 0.7,
): CandidateDecision {
  const geography = geographicRelation(a.scope, b.scope);
  const ap = providerMetadata(a.providerId),
    bp = providerMetadata(b.providerId);
  const span = Math.abs(start(a) - start(b));
  const independent = Boolean(
    ap &&
    bp &&
    ap.system === a.signal.type &&
    bp.system === b.signal.type &&
    ap.system !== bp.system &&
    ap.independenceGroup !== bp.independenceGroup,
  );
  const factors = {
    geographic: geography?.score ?? 0,
    temporal: Number.isFinite(span)
      ? Math.max(0, 1 - span / (windowHours * HOUR))
      : 0,
    severity:
      (severityValue[a.signal.severity] + severityValue[b.signal.severity]) / 2,
    independence: independent ? 1 : 0,
    confidence: Math.min(a.signal.confidence, b.signal.confidence),
  };
  const score =
    factors.geographic * 0.3 +
    factors.temporal * 0.25 +
    factors.severity * 0.15 +
    factors.independence * 0.15 +
    factors.confidence * 0.15;
  const reason =
    !Number.isFinite(score) ||
    !Number.isFinite(start(a)) ||
    !Number.isFinite(start(b))
      ? "invalid_input"
      : a.signal.id === b.signal.id
        ? "same_signal"
        : a.signal.provenance !== b.signal.provenance
          ? "mixed_provenance"
          : !geography
            ? "geographic_mismatch"
            : !Number.isFinite(span) || span > windowHours * HOUR
              ? "outside_time_window"
              : !independent
                ? "same_system_or_unregistered_provider"
                : !Number.isFinite(factors.confidence) ||
                    factors.confidence < 0.4 ||
                    factors.confidence > 1
                  ? "insufficient_confidence"
                  : score < threshold
                    ? "below_threshold"
                    : "accepted";
  return {
    signalIds: [a.signal.id, b.signal.id],
    accepted: reason === "accepted",
    reason,
    factors,
    score,
    threshold,
  };
}
export interface CorrelationOptions {
  asOf: string;
  windowHours?: CorrelationWindow;
  threshold?: number;
  debug?: boolean;
}
export function correlate(
  inputs: CorrelationInput[],
  options: CorrelationOptions,
) {
  const now = Date.parse(options.asOf);
  const window = options.windowHours ?? 6,
    threshold = options.threshold ?? 0.7;
  if (
    !Number.isFinite(now) ||
    !CORRELATION_WINDOWS.includes(window) ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  )
    throw new Error("Invalid correlation options");
  const unique = new Map<string, CorrelationInput>();
  const excluded: { signalId: string; reason: string }[] = [];
  for (const input of inputs) {
    const known = Date.parse(input.recordedAt);
    if (!Number.isFinite(known) || known > now) {
      if (options.debug)
        excluded.push({
          signalId: input.signal.id,
          reason: "not_known_at_as_of",
        });
      continue;
    }
    const previous = unique.get(input.signal.id);
    if (!previous || known > Date.parse(previous.recordedAt))
      unique.set(input.signal.id, input);
  }
  // Pick the latest known version before validating it. A retracted, stale or
  // invalid newer version must not resurrect an older eligible measurement.
  for (const input of unique.values()) {
    const begun = start(input),
      finished = end(input);
    const provider = providerMetadata(input.providerId);
    const reason =
      !Number.isFinite(begun) ||
      !Number.isFinite(finished) ||
      finished < begun ||
      begun > now ||
      finished > now
        ? "invalid_or_future_window"
        : finished < now - window * HOUR
          ? "outside_time_window"
          : !validScope(input.scope)
            ? "invalid_geography"
            : !provider || provider.system !== input.signal.type
              ? "unregistered_or_mismatched_provider"
              : !Number.isFinite(input.signal.confidence) ||
                  input.signal.confidence < 0 ||
                  input.signal.confidence > 1
                ? "invalid_confidence"
                : null;
    if (reason) {
      unique.delete(input.signal.id);
      if (options.debug) excluded.push({ signalId: input.signal.id, reason });
    }
  }
  const signals = [...unique.values()].sort(
    (a, b) => start(a) - start(b) || a.signal.id.localeCompare(b.signal.id),
  );
  const index = new Map<string, number[]>();
  const candidates: CandidateDecision[] = [];
  const edges = new Map<string, CandidateDecision>();
  const confirmations: ProviderConfirmation[] = [];
  let comparisons = 0;
  const bucketWidth = window * HOUR;
  for (let i = 0; i < signals.length; i++) {
    const a = signals[i],
      bucket = Math.floor(start(a) / bucketWidth);
    const keys = spatialKeys(a.scope, "read");
    const matches = new Set<number>();
    for (const key of keys)
      for (const b of [bucket - 1, bucket]) {
        for (const j of index.get(`${key}:${b}`) ?? []) {
          matches.add(j);
        }
      }
    for (const j of matches) {
      const b = signals[j];
      if (Math.abs(start(a) - start(b)) > bucketWidth) continue;
      comparisons++;
      const decision = scoreCandidate(a, b, window, threshold);
      if (options.debug) candidates.push(decision);
      if (decision.accepted) edges.set(`${j}:${i}`, decision);
      else if (
        a.signal.type === b.signal.type &&
        a.providerId !== b.providerId &&
        a.signal.provenance === b.signal.provenance &&
        geographicRelation(a.scope, b.scope) &&
        Math.min(a.signal.confidence, b.signal.confidence) >= 0.4
      ) {
        confirmations.push({
          system: a.signal.type,
          signalIds: [b.signal.id, a.signal.id].sort(),
          providerIds: [a.providerId, b.providerId].sort(),
          confidence: Math.min(
            0.95,
            Math.max(a.signal.confidence, b.signal.confidence) + 0.05,
          ),
        });
      }
    }
    for (const key of spatialKeys(a.scope, "write")) {
      const k = `${key}:${bucket}`;
      const list = index.get(k) ?? [];
      list.push(i);
      index.set(k, list);
    }
  }
  // Strongest edges first. Complete-link merge prevents a chain of near-time or
  // neighboring events from becoming a geographically or temporally huge alert.
  const groups: number[][] = [];
  const acceptedEdges = [...edges.entries()].sort(
    (a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]),
  );
  const compatible = (members: number[]) => {
    if (
      start(signals[members[members.length - 1]]) - start(signals[members[0]]) >
      bucketWidth
    )
      return false;
    for (let x = 0; x < members.length; x++)
      for (let y = x + 1; y < members.length; y++) {
        const a = signals[members[x]],
          b = signals[members[y]];
        if (!geographicRelation(a.scope, b.scope)) return false;
        if (
          a.signal.type !== b.signal.type &&
          !edges.has(`${members[x]}:${members[y]}`)
        )
          return false;
      }
    return true;
  };
  for (const [key] of acceptedEdges) {
    const [a, b] = key.split(":").map(Number);
    const ai = groups.findIndex((g) => g.includes(a)),
      bi = groups.findIndex((g) => g.includes(b));
    if (ai >= 0 && ai === bi) continue;
    const merged = [
      ...new Set([
        ...(ai < 0 ? [a] : groups[ai]),
        ...(bi < 0 ? [b] : groups[bi]),
      ]),
    ].sort((x, y) => x - y);
    if (!compatible(merged)) continue;
    for (const idx of [ai, bi].filter((v) => v >= 0).sort((x, y) => y - x))
      groups.splice(idx, 1);
    groups.push(merged);
  }
  const events: CorrelatedEvent[] = groups.map((indices) => {
    const members = indices.map((i) => signals[i]);
    const signalIds = members.map((s) => s.signal.id).sort();
    let scope: GeographicScope = members[0].scope;
    for (const member of members.slice(1))
      scope = geographicRelation(scope, member.scope)!.scope;
    const scores = indices.flatMap((a, x) =>
      indices
        .slice(x + 1)
        .map((b) => edges.get(`${a}:${b}`)?.score)
        .filter((s): s is number => s !== undefined),
    );
    return {
      id: `correlation:${createHash("sha256")
        .update(signalIds.join("|"))
        .digest("hex")
        .slice(0, 24)}`,
      geographicScope: scope,
      startedAt: new Date(Math.min(...members.map(start))).toISOString(),
      updatedAt: new Date(now).toISOString(),
      windowEnd: new Date(Math.max(...members.map(end))).toISOString(),
      windowHours: window,
      signalIds,
      signalTypes: [...new Set(members.map((s) => s.signal.type))].sort(),
      providerIds: [...new Set(members.map((s) => s.providerId))].sort(),
      correlationStrength: Math.min(...scores),
      confidence: Math.min(...members.map((s) => s.signal.confidence)),
      severity: members.reduce<Severity>(
        (best, s) =>
          severityValue[s.signal.severity] > severityValue[best]
            ? s.signal.severity
            : best,
        "notable",
      ),
      status: members.every((s) => s.signal.status === "resolved")
        ? "resolved"
        : "active",
      provenance: members[0].signal.provenance,
      methodology: CORRELATION_METHOD,
      relationship: `Signals share ${scope.kind === "country" ? `country coverage (${scope.country})` : `H3 area ${scope.cellId}`} and begin within ${window} hours. Observation timestamps do not establish exact real-world onset or causality.`,
    };
  });
  return {
    events: events.sort(
      (a, b) =>
        b.correlationStrength - a.correlationStrength ||
        a.id.localeCompare(b.id),
    ),
    confirmations,
    ...(options.debug ? { debug: { candidates, excluded, comparisons } } : {}),
  };
}

// Missing components or an unhealthy provider are unknown, never recovery.
export function reconcileEvents(
  previous: CorrelatedEvent[],
  current: CorrelatedEvent[],
  inputs: CorrelationInput[],
  healthyProviderIds: ReadonlySet<string>,
  asOf: string,
) {
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) throw new Error("Invalid reconciliation time");
  const latest = new Map<string, CorrelationInput>();
  for (const input of inputs) {
    const previous = latest.get(input.signal.id);
    if (
      Date.parse(input.recordedAt) <= now &&
      (!previous ||
        Date.parse(previous.recordedAt) < Date.parse(input.recordedAt))
    )
      latest.set(input.signal.id, input);
  }
  const canResolve = (event: CorrelatedEvent) =>
    event.signalIds.every((id) => {
      const input = latest.get(id);
      return (
        input?.signal.status === "resolved" &&
        healthyProviderIds.has(input.providerId)
      );
    });
  const next = new Map(current.map((event) => [event.id, event]));
  for (const event of previous) {
    const replacement = next.get(event.id);
    if (replacement) {
      if (
        event.status === "active" &&
        replacement.status === "resolved" &&
        !canResolve(event)
      )
        next.set(event.id, event);
      continue;
    }
    // A larger current event containing all previous members supersedes the
    // smaller alert; retaining both would double-count the same evidence.
    if (
      current.some(
        (candidate) =>
          event.signalIds.every((id) => candidate.signalIds.includes(id)) &&
          candidate.provenance === event.provenance,
      )
    )
      continue;
    next.set(
      event.id,
      canResolve(event)
        ? { ...event, status: "resolved", updatedAt: asOf }
        : event,
    );
  }
  return [...next.values()];
}
