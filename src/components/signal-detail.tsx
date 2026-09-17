"use client";
import { useState } from "react";
import { LAYERS, type WorldSignal } from "@/core/types";
import { confidenceLabel, deviationLabel } from "@/core/analysis";
import { EvidenceChart } from "./evidence-chart";
import { Icon } from "./icon";
export function SignalDetail({
  signal,
  onClose,
}: {
  signal: WorldSignal;
  onClose: () => void;
}) {
  const [showContext, setShowContext] = useState(false);
  const demo = signal.provenance === "synthetic";
  const event = signal.kind === "earthquake-event";
  return (
    <section className="signal-detail" aria-label="Signal details">
      <div className="panel-heading">
        <span>SIGNAL INTELLIGENCE</span>
        <button
          className="icon-button"
          aria-label="Close signal details"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="detail-scroll">
        <div className="detail-type">
          <Icon name={signal.type} />
          {LAYERS.find((l) => l.id === signal.type)?.name}
          <span className="demo-mini">
            {demo
              ? "SIMULATED"
              : event
                ? "OBSERVED EVENT"
                : "STATISTICAL ANOMALY"}
          </span>
        </div>
        <h2>
          {signal.country === "United States of America"
            ? "United States"
            : signal.country}
        </h2>
        <p className="region">{signal.region}</p>
        <span className={`severity ${signal.severity}`}>
          <i />
          {signal.severity}
        </span>
        <div className="big-measure">
          {deviationLabel(signal)}
          <span>{signal.baselineLabel ?? "vs. 30-day reference"}</span>
        </div>
        <div className="metric-pair">
          <div>
            <span>{demo ? "OBSERVED · DEMO" : "OBSERVED"}</span>
            <strong>{signal.observedValue.toLocaleString("en-US")}</strong>
            <small>{signal.unit}</small>
          </div>
          <div>
            <span>{demo ? "EXPECTED · DEMO" : "REFERENCE MEAN"}</span>
            <strong>
              {signal.expectedValue === null
                ? "N/A"
                : signal.expectedValue.toFixed(demo ? 0 : 2)}
            </strong>
            <small>
              {signal.expectedValue === null
                ? "event threshold"
                : "per comparable window"}
            </small>
          </div>
        </div>
        {signal.magnitude !== undefined && (
          <div className="quake-meta">
            <span>
              Magnitude <b>{signal.magnitude.toFixed(1)}</b>
            </span>
            <span>
              Depth{" "}
              <b>
                {signal.depth === undefined
                  ? "Unavailable"
                  : `${signal.depth} km`}
              </b>
            </span>
          </div>
        )}
        <div className="detail-section">
          <h3>What changed</h3>
          <p>{signal.description}</p>
        </div>
        <div className="detail-section">
          <div className="section-title">
            <h3>The evidence</h3>
            <span>
              {demo
                ? "30D REFERENCE"
                : event
                  ? "THRESHOLD SELECTION"
                  : `${signal.baseline.length} REFERENCE WINDOWS`}
            </span>
          </div>
          <EvidenceChart signal={signal} />
        </div>
        <button
          className="explain-button"
          onClick={() => setShowContext((v) => !v)}
          aria-expanded={showContext}
        >
          <Icon name="info" />
          {showContext ? "Hide context" : "Why this may matter"}
          <Icon name="arrow" size={16} />
        </button>
        {showContext && (
          <div className="context-note">
            <span>EDITORIAL CONTEXT · NOT AI GENERATED</span>
            <p>{signal.context}</p>
            <p>
              {demo
                ? "Synthetic scenario; no real-world conclusion is established."
                : "No causal or impact conclusion is established by these measurements."}
            </p>
          </div>
        )}
        {!demo && (
          <div className="detail-section source-section">
            <h3>Data confidence · {confidenceLabel(signal.confidence)}</h3>
            <p>{signal.evidence?.confidenceMethod}</p>
            <p>
              Status: {signal.status ?? "active"}. Confidence describes data
              quality, not danger.
            </p>
          </div>
        )}
        {!demo && signal.evidence && (
          <div className="detail-section source-section">
            <h3>Observation window</h3>
            <p>
              {event
                ? "Individual catalogue event"
                : `${signal.evidence.observationWindowHours} hours ending ${new Date(signal.evidence.windowEnd).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`}
            </p>
            {signal.evidence.frpMw !== undefined && (
              <p>
                FRP sum:{" "}
                {signal.evidence.frpMw === null
                  ? "Unavailable"
                  : `${signal.evidence.frpMw.toFixed(1)} MW across ${signal.evidence.frpSampleCount} detections`}
                . Repeated overpasses are included; this is not total fire
                energy.
              </p>
            )}
          </div>
        )}
        <details className="method-details">
          <summary>Methodology & limitations</summary>
          <p>{signal.methodology}</p>
          <p>{signal.limitation}</p>
        </details>
        <div className="detail-section source-section">
          <h3>{demo ? "Reference source" : "Original data source"}</h3>
          <a href={signal.source.url} target="_blank" rel="noreferrer">
            {signal.source.name}
            <Icon name="external" size={14} />
          </a>
          <p>
            {demo
              ? "Provider documentation, not evidence of a real event."
              : `Source updated: ${signal.sourceAsOf ? new Date(signal.sourceAsOf).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : "Unavailable"}`}
          </p>
        </div>
        <div className="timestamp">
          <span>{demo ? "SCENARIO TIMESTAMP" : "LAST OBSERVATION"}</span>
          <time dateTime={signal.timestamp}>
            {new Date(signal.timestamp).toLocaleString("en-GB", {
              timeZone: "UTC",
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            UTC
          </time>
        </div>
      </div>
    </section>
  );
}
