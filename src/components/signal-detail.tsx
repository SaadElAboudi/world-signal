"use client";
import { useState } from "react";
import { LAYERS, type WorldSignal } from "@/core/types";
import type { Investigation } from "@/context/investigation";
import { confidenceLabel, deviationLabel } from "@/core/analysis";
import { EvidenceChart } from "./evidence-chart";
import { Icon } from "./icon";

type ContextState = "idle" | "loading" | "ready" | "error";
type ContextView = {
  signalId: string;
  open: boolean;
  state: ContextState;
  investigation: Investigation | null;
};
const EMPTY_CONTEXT: ContextView = { signalId: "", open: false, state: "idle", investigation: null };

export function SignalDetail({ signal, onClose }: { signal: WorldSignal; onClose: () => void }) {
  const [contextView, setContextView] = useState<ContextView>(EMPTY_CONTEXT);
  const activeContext = contextView.signalId === signal.id ? contextView : EMPTY_CONTEXT;
  const demo = signal.provenance === "synthetic";
  const event = signal.kind === "earthquake-event";

  async function toggleContext() {
    if (activeContext.open) {
      setContextView({ ...activeContext, signalId: signal.id, open: false });
      return;
    }
    if (activeContext.investigation) {
      setContextView({ ...activeContext, signalId: signal.id, open: true });
      return;
    }
    setContextView({ signalId: signal.id, open: true, state: "loading", investigation: null });
    try {
      const response = await fetch(
        `/api/signals/${encodeURIComponent(signal.id)}/context?mode=${demo ? "demo" : "live"}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`Context request failed: ${response.status}`);
      const investigation = (await response.json()) as Investigation;
      setContextView({ signalId: signal.id, open: true, state: "ready", investigation });
    } catch {
      setContextView({ signalId: signal.id, open: true, state: "error", investigation: null });
    }
  }

  return (
    <section className="signal-detail" aria-label="Signal details"><div className="panel-heading"><span>SIGNAL INTELLIGENCE</span><button className="icon-button" aria-label="Close signal details" onClick={onClose}><Icon name="close" /></button></div><div className="detail-scroll">
      <div className="detail-type"><Icon name={signal.type} />{LAYERS.find((l) => l.id === signal.type)?.name}<span className="demo-mini">{demo ? "SIMULATED" : event ? "OBSERVED EVENT" : "STATISTICAL ANOMALY"}</span></div>
      <h2>{signal.country === "United States of America" ? "United States" : signal.country}</h2><p className="region">{signal.region}</p><span className={`severity ${signal.severity}`}><i />{signal.severity}</span>
      <div className="big-measure">{deviationLabel(signal)}<span>{signal.baselineLabel ?? "vs. 30-day reference"}</span></div>
      <div className="metric-pair"><div><span>{demo ? "OBSERVED · DEMO" : "OBSERVED"}</span><strong>{signal.observedValue.toLocaleString("en-US")}</strong><small>{signal.unit}</small></div><div><span>{demo ? "EXPECTED · DEMO" : "REFERENCE MEAN"}</span><strong>{signal.expectedValue === null ? "N/A" : signal.expectedValue.toFixed(demo ? 0 : 2)}</strong><small>{signal.expectedValue === null ? "event threshold" : "per comparable window"}</small></div></div>
      {signal.magnitude !== undefined && <div className="quake-meta"><span>Magnitude <b>{signal.magnitude.toFixed(1)}</b></span><span>Depth <b>{signal.depth === undefined ? "Unavailable" : `${signal.depth} km`}</b></span></div>}
      <div className="detail-section"><h3>What changed</h3><p>{signal.description}</p></div>
      <div className="detail-section"><div className="section-title"><h3>The evidence</h3><span>{demo ? "30D REFERENCE" : event ? "THRESHOLD SELECTION" : `${signal.baseline.length} REFERENCE WINDOWS`}</span></div><EvidenceChart signal={signal} /></div>
      <button className="explain-button" onClick={toggleContext} aria-expanded={activeContext.open}><Icon name="info" />{activeContext.open ? "Hide investigation" : "Investigate context"}<Icon name="arrow" size={16} /></button>
      {activeContext.open && <div className="context-investigation" aria-live="polite"><div className="context-editorial"><span>EDITORIAL CONTEXT · NOT RETRIEVED EVIDENCE</span><p>{signal.context}</p></div>
        {activeContext.state === "loading" && <div className="context-state context-state--loading"><span>SEARCHING CONTEXT</span><strong>Looking for evidence around this observation…</strong></div>}
        {activeContext.state === "error" && <div className="context-state context-state--error"><span>CONTEXT TEMPORARILY UNAVAILABLE</span><strong>The observation remains valid; external context could not be loaded.</strong></div>}
        {activeContext.state === "ready" && activeContext.investigation && <InvestigationPanel investigation={activeContext.investigation} demo={demo} />}
      </div>}
      {!demo && <div className="detail-section source-section"><h3>Data confidence · {confidenceLabel(signal.confidence)}</h3><p>{signal.evidence?.confidenceMethod}</p><p>Status: {signal.status ?? "active"}. Confidence describes data quality, not danger.</p></div>}
      {!demo && signal.evidence && <div className="detail-section source-section"><h3>Observation window</h3><p>{event ? "Individual catalogue event" : `${signal.evidence.observationWindowHours} hours ending ${new Date(signal.evidence.windowEnd).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`}</p>{signal.evidence.frpMw !== undefined && <p>FRP sum: {signal.evidence.frpMw === null ? "Unavailable" : `${signal.evidence.frpMw.toFixed(1)} MW across ${signal.evidence.frpSampleCount} detections`}. Repeated overpasses are included; this is not total fire energy.</p>}</div>}
      <details className="method-details"><summary>Methodology & limitations</summary><p>{signal.methodology}</p><p>{signal.limitation}</p></details>
      <div className="detail-section source-section"><h3>{demo ? "Reference source" : "Original data source"}</h3><a href={signal.source.url} target="_blank" rel="noreferrer">{signal.source.name}<Icon name="external" size={14} /></a><p>{demo ? "Provider documentation, not evidence of a real event." : `Source updated: ${signal.sourceAsOf ? new Date(signal.sourceAsOf).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : "Unavailable"}`}</p></div>
      <div className="timestamp"><span>{demo ? "SCENARIO TIMESTAMP" : "LAST OBSERVATION"}</span><time dateTime={signal.timestamp}>{new Date(signal.timestamp).toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} UTC</time></div>
    </div></section>
  );
}

function InvestigationPanel({ investigation, demo }: { investigation: Investigation; demo: boolean }) {
  return <>
    <div className={`context-state ${investigation.status === "context_found" ? "context-state--found" : investigation.status === "context_unavailable" ? "context-state--error" : "context-state--unknown"}`}>
      <span>{investigation.status === "context_found" ? "CONTEXT EVIDENCE FOUND" : investigation.status === "context_unavailable" ? "CONTEXT SOURCES UNAVAILABLE" : "NO EXPLANATION FOUND YET"}</span>
      <strong>{investigation.status === "context_found" ? `${investigation.evidence.length} relevant source${investigation.evidence.length === 1 ? "" : "s"} matched the event window.` : investigation.status === "context_unavailable" ? "The configured context sources could not be searched." : demo ? "External retrieval is intentionally disabled in demo mode." : "No sufficiently relevant external evidence was retrieved from the available sources."}</strong>
      <p>Retrieval: {investigation.retrievalStatus.replace("_", " ")}. Context is evidence around the anomaly, not proof of cause.</p>
      <p>Contextual support: <b>{investigation.explanationConfidence.level.toUpperCase()}</b>{investigation.explanationConfidence.level !== "none" ? ` · ${Math.round(investigation.explanationConfidence.score * 100)}%` : ""}. {investigation.explanationConfidence.rationale}</p>
    </div>
    {investigation.evidence.length > 0 && <div className="context-evidence-list" aria-label="Context evidence">{investigation.evidence.map((item) => <a className="context-evidence" href={item.source.url} target="_blank" rel="noreferrer" key={item.id}><div className="context-evidence__meta"><strong>{item.source.name}</strong><time dateTime={item.publishedAt}>{new Date(item.publishedAt).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })} UTC</time></div><p>{item.text}</p><small>Relevance {Math.round(item.score * 100)} · topic {Math.round(item.scoreBreakdown.topical * 100)} · external source ↗</small></a>)}</div>}
    <div className="context-timeline" aria-label="Investigation timeline"><span>INVESTIGATION TIMELINE</span><ol>{investigation.timeline.map((entry, index) => <li key={`${entry.kind}-${entry.timestamp}-${entry.signalId ?? entry.evidenceId ?? index}`}><time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}</time><i data-kind={entry.kind} /><div><strong>{entry.kind === "signal" ? "Anomaly detected" : "Context published"}</strong><small>{entry.sourceName ?? entry.label}</small></div></li>)}</ol></div>
    {investigation.providers.length > 0 && <div className="context-provider-health" aria-label="Context source health">{investigation.providers.map((provider) => <span key={provider.providerId} data-status={provider.status}>{provider.providerId} · {provider.status}</span>)}</div>}
    <details className="context-unknowns"><summary>What remains unknown</summary><ul>{investigation.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></details>
  </>;
}
