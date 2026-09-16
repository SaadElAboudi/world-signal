"use client";
import { useState } from "react";
import { LAYERS, type WorldSignal } from "@/core/types";
import { deviationLabel } from "@/core/analysis";
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
          <span className="demo-mini">SIMULATED</span>
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
          <span>vs. 30-day reference</span>
        </div>
        <div className="metric-pair">
          <div>
            <span>OBSERVED · DEMO</span>
            <strong>{signal.observedValue.toLocaleString("en-US")}</strong>
            <small>{signal.unit}</small>
          </div>
          <div>
            <span>EXPECTED · DEMO</span>
            <strong>{signal.expectedValue.toFixed(0)}</strong>
            <small>reference mean</small>
          </div>
        </div>
        {signal.magnitude && (
          <div className="quake-meta">
            <span>
              Magnitude <b>{signal.magnitude.toFixed(1)}</b>
            </span>
            <span>
              Depth <b>{signal.depth} km</b>
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
            <span>30D REFERENCE</span>
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
              Confidence in real-world conclusions: <b>LOW</b>. This scenario is
              synthetic; no cause has been established.
            </p>
          </div>
        )}
        <details className="method-details">
          <summary>Methodology & limitations</summary>
          <p>{signal.methodology}</p>
          <p>{signal.limitation}</p>
        </details>
        <div className="detail-section source-section">
          <h3>Reference source</h3>
          <a href={signal.source.url} target="_blank" rel="noreferrer">
            {signal.source.name}
            <Icon name="external" size={14} />
          </a>
          <p>Provider documentation, not evidence of a real event.</p>
        </div>
        <div className="timestamp">
          <span>SCENARIO TIMESTAMP</span>
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
