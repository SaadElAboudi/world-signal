"use client";
import { useI18n } from "@/i18n/context";
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
  const { t, locale, countryName } = useI18n();
  const [showContext, setShowContext] = useState(false);
  const demo = signal.provenance === "synthetic";
  const event = signal.kind === "earthquake-event";
  return (
    <section className="signal-detail" aria-label={t("Signal details")}>
      <div className="panel-heading">
        <span>{t("SIGNAL INTELLIGENCE")}</span>
        <button
          className="icon-button"
          aria-label={t("Close signal details")}
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
              ? t("SIMULATED")
              : event
                ? t("OBSERVED EVENT")
                : t("STATISTICAL ANOMALY")}
          </span>
        </div>
        <h2>
          {signal.country === "United States of America"
            ? t("United States")
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
            <span>{demo ? t("OBSERVED · DEMO") : t("OBSERVED")}</span>
            <strong>
              {signal.observedValue.toLocaleString(
                locale === "fr" ? "fr-FR" : "en-US",
              )}
            </strong>
            <small>{signal.unit}</small>
          </div>
          <div>
            <span>{demo ? t("EXPECTED · DEMO") : t("REFERENCE MEAN")}</span>
            <strong>
              {signal.expectedValue === null
                ? "N/A"
                : signal.expectedValue.toFixed(demo ? 0 : 2)}
            </strong>
            <small>
              {signal.expectedValue === null
                ? t("event threshold")
                : t("per comparable window")}
            </small>
          </div>
        </div>
        {signal.magnitude !== undefined && (
          <div className="quake-meta">
            <span>
              {t("Magnitude")}
              <b>{signal.magnitude.toFixed(1)}</b>
            </span>
            <span>
              {t("Depth")}{" "}
              <b>
                {signal.depth === undefined
                  ? "Unavailable"
                  : `${signal.depth} km`}
              </b>
            </span>
          </div>
        )}
        <div className="detail-section">
          <h3>{t("What changed")}</h3>
          <p>{signal.description}</p>
        </div>
        <div className="detail-section">
          <div className="section-title">
            <h3>{t("The evidence")}</h3>
            <span>
              {demo
                ? t("30D REFERENCE")
                : event
                  ? t("THRESHOLD SELECTION")
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
          {showContext ? t("Hide context") : t("Why this may matter")}
          <Icon name="arrow" size={16} />
        </button>
        {showContext && (
          <div className="context-note">
            <span>{t("EDITORIAL CONTEXT · NOT AI GENERATED")}</span>
            <p>{signal.context}</p>
            <p>
              {demo
                ? t(
                    "Synthetic scenario; no real-world conclusion is established.",
                  )
                : t(
                    "No causal or impact conclusion is established by these measurements.",
                  )}
            </p>
          </div>
        )}
        {!demo && (
          <div className="detail-section source-section">
            <h3>
              {t("Data confidence ·")}
              {confidenceLabel(signal.confidence)}
            </h3>
            <p>{signal.evidence?.confidenceMethod}</p>
            <p>
              {t("Status:")}
              {signal.status ?? "active"}
              {t(". Confidence describes data quality, not danger.")}
            </p>
          </div>
        )}
        {!demo && signal.evidence && (
          <div className="detail-section source-section">
            <h3>{t("Observation window")}</h3>
            <p>
              {event
                ? t("Individual catalogue event")
                : `${signal.evidence.observationWindowHours} hours ending ${new Date(signal.evidence.windowEnd).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "UTC" })} UTC`}
            </p>
            {signal.evidence.frpMw !== undefined && (
              <p>
                {t("FRP sum:")}{" "}
                {signal.evidence.frpMw === null
                  ? "Unavailable"
                  : `${signal.evidence.frpMw.toFixed(1)} MW across ${signal.evidence.frpSampleCount} detections`}
                {t(
                  ". Repeated overpasses are included; this is not total fire energy.",
                )}
              </p>
            )}
          </div>
        )}
        <details className="method-details">
          <summary>{t("Methodology & limitations")}</summary>
          <p>{signal.methodology}</p>
          <p>{signal.limitation}</p>
        </details>
        <div className="detail-section source-section">
          <h3>{demo ? t("Reference source") : t("Original data source")}</h3>
          <a href={signal.source.url} target="_blank" rel="noreferrer">
            {signal.source.name}
            <Icon name="external" size={14} />
          </a>
          <p>
            {demo
              ? t("Provider documentation, not evidence of a real event.")
              : `Source updated: ${signal.sourceAsOf ? new Date(signal.sourceAsOf).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "UTC" }) + " UTC" : "Unavailable"}`}
          </p>
        </div>
        <div className="timestamp">
          <span>{demo ? t("SCENARIO TIMESTAMP") : t("LAST OBSERVATION")}</span>
          <time dateTime={signal.timestamp}>
            {new Date(signal.timestamp).toLocaleString(
              locale === "fr" ? "fr-FR" : "en-GB",
              {
                timeZone: "UTC",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              },
            )}{" "}
            UTC
          </time>
        </div>
      </div>
    </section>
  );
}
