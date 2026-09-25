"use client";
import type { CorrelatedEvent } from "@/correlations/types";
import type { WorldSignal } from "@/core/types";
import { confidenceLabel, deviationLabel } from "@/core/analysis";
import { useI18n } from "@/i18n/context";
import { Icon } from "./icon";
export function CorrelationDetail({
  event,
  signals,
  onClose,
  onSelect,
}: {
  event: CorrelatedEvent;
  signals: WorldSignal[];
  onClose: () => void;
  onSelect: (signal: WorldSignal) => void;
}) {
  const { t, locale, countryName } = useI18n();
  const members = event.signalIds
    .flatMap((id) => signals.find((s) => s.id === id) ?? [])
    .sort(
      (a, b) =>
        Date.parse(a.startedAt ?? a.timestamp) -
        Date.parse(b.startedAt ?? b.timestamp),
    );
  const time = (value: string) =>
    new Date(value).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <section className="signal-detail" aria-label={t("Multi-signal details")}>
      <div className="panel-heading">
        <span>◎ {t("MULTIPLE SIGNALS DETECTED")}</span>
        <button
          className="icon-button"
          aria-label={t("Close event details")}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="detail-scroll">
        <span className="demo-mini">
          {t(event.provenance === "synthetic" ? "SIMULATED" : "OBSERVED")}
        </span>
        <h2>
          {countryName(
            event.geographicScope.country ?? "Offshore / unassigned",
          )}
        </h2>
        <p className="region">
          {event.signalTypes.length} {t("independent systems")} ·{" "}
          {event.windowHours} h · {t(event.status)}
        </p>
        {event.clusterScore !== undefined && (
          <div className="detail-section source-section">
            <h3>{locale === "fr" ? "Priorité du regroupement" : "Cluster priority"} · {Math.round(event.clusterScore * 100)}/100</h3>
            <p>
              {locale === "fr"
                ? `${event.sourceDiversity ?? 0} de diversité des sources et ${event.persistenceMinutes ?? 0} min de persistance observée. Ce score priorise l’examen, il ne prouve aucune cause.`
                : `${event.sourceDiversity ?? 0} source diversity and ${event.persistenceMinutes ?? 0} minutes of observed persistence. This score prioritizes review; it proves no cause.`}
            </p>
          </div>
        )}
        <div className="detail-section">
          <h3>{t("Why this was grouped")}</h3>
          <p>
            {event.geographicScope.kind === "country"
              ? t(
                  "A country-wide measurement overlaps regional observations in that country.",
                )
              : t(
                  "The observations share the same H3 area or a parent/child cell.",
                )}
          </p>
          <p>
            {t("Observed start times fall within")} {event.windowHours} h.{" "}
            {t("Co-occurrence does not establish causality.")}
          </p>
          <p>
            {t("Data confidence ·")} {t(confidenceLabel(event.confidence))}.{" "}
            {t("Capped at the weakest underlying signal.")}
          </p>
        </div>
        {members.map((signal) => (
          <button
            className={`signal-card ${signal.severity}`}
            key={signal.id}
            onClick={() => onSelect(signal)}
          >
            <div className="signal-card-top">
              <span>
                <Icon name={signal.type} />
                {t(signal.type)}
              </span>
              <span>{t(signal.severity)}</span>
            </div>
            <h3>{deviationLabel(signal)}</h3>
            <p>
              {t("Data confidence ·")} {t(confidenceLabel(signal.confidence))}
            </p>
            <small>{signal.source.name}</small>
          </button>
        ))}
        <div className="detail-section">
          <h3>{t("Shared observation timeline")}</h3>
          <ol className="event-timeline">
            {members.map((signal) => (
              <li key={signal.id}>
                <time dateTime={signal.startedAt ?? signal.timestamp}>
                  {time(signal.startedAt ?? signal.timestamp)} UTC
                </time>
                <strong>{t(signal.type)}</strong>
                <span>{t("First observation represented by this signal")}</span>
              </li>
            ))}
          </ol>
          <p className="fineprint">
            {t(
              "Observation order does not prove which real-world incident began first.",
            )}
          </p>
        </div>
        <div className="detail-section source-section">
          <h3>{t("Original data sources")}</h3>
          {members.map((signal) => (
            <div key={signal.id}>
              <a href={signal.source.url} target="_blank" rel="noreferrer">
                {signal.source.name}
                <Icon name="external" size={12} />
              </a>
              <p>
                {t("Source updated:")}{" "}
                {signal.sourceAsOf
                  ? `${time(signal.sourceAsOf)} UTC`
                  : t("Not available")}
              </p>
            </div>
          ))}
        </div>
        <div className="context-note">
          <p>
            {t(
              "Grouping identifies overlapping unusual measurements. Cause, impact and completeness of coverage remain unknown.",
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
