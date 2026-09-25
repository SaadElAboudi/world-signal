"use client";
import { useI18n } from "@/i18n/context";
import { InvestigationPanel } from "./investigation-panel";
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
          {t(LAYERS.find((l) => l.id === signal.type)?.name ?? "")}
          <span className="demo-mini">
            {demo
              ? t("SIMULATED")
              : event
                ? t("OBSERVED EVENT")
                : t("STATISTICAL ANOMALY")}
          </span>
        </div>
        <h2>{countryName(signal.country)}</h2>
        <p className="region">{signal.region}</p>
        <span className={`severity ${signal.severity}`}>
          <i />
          {t(signal.severity)}
        </span>
        <div className="big-measure">
          {deviationLabel(signal)}
          <span>{t(signal.baselineLabel ?? "vs. 30-day reference")}</span>
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
        {signal.assessment && (
          <div className="detail-section source-section">
            <h3>{locale === "fr" ? "Priorité d’examen" : "Investigation priority"} · {signal.assessment.score}/100</h3>
            <p>
              {locale === "fr"
                ? `${signal.assessment.persistenceMinutes} min de persistance observée. Ce score classe les signaux à examiner ; il ne mesure ni le danger, ni l’impact, ni une cause.`
                : `${signal.assessment.persistenceMinutes} minutes of observed persistence. This score ranks signals for review; it does not measure danger, impact or cause.`}
            </p>
          </div>
        )}
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
          <p>
            {locale === "fr"
              ? event
                ? `Séisme de magnitude ${signal.magnitude?.toLocaleString("fr-FR") ?? signal.observedValue.toLocaleString("fr-FR")}, enregistré par ${signal.source.name}. Il s’agit d’un événement observé, sans estimation de danger.`
                : `${signal.observedValue.toLocaleString("fr-FR")} ${signal.type === "wildfire" ? "détections thermiques" : signal.type === "aviation" ? "aéronefs observés" : signal.type === "earthquake" ? "séismes observés" : "unités de la mesure de connectivité"}, pour une référence de ${signal.expectedValue?.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) ?? "valeur indisponible"} sur des périodes comparables. Cet écart décrit une observation et ne permet pas d’en déduire la cause.`
              : signal.description}
          </p>
        </div>
        <div className="detail-section">
          <div className="section-title">
            <h3>{t("The evidence")}</h3>
            <span>
              {demo
                ? t("30D REFERENCE")
                : event
                  ? t("THRESHOLD SELECTION")
                  : t(`${signal.baseline.length} REFERENCE WINDOWS`)}
            </span>
          </div>
          <EvidenceChart signal={signal} />
        </div>
        <InvestigationPanel key={signal.id} signal={signal} />
        {!demo && (
          <div className="detail-section source-section">
            <h3>
              {t("Data confidence ·")} {t(confidenceLabel(signal.confidence))}
            </h3>
            <p>
              {locale === "fr"
                ? "La confiance dépend de la couverture de la source et de la quantité de données comparables. Elle ne mesure ni le danger ni la probabilité d’une cause. Le calcul détaillé figure dans la méthodologie de la source ci-dessous."
                : signal.evidence?.confidenceMethod}
            </p>
            <p>
              {t("Status:")}
              {t(signal.status ?? "active")}
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
                : `${signal.evidence.observationWindowHours} ${locale === "fr" ? "heures, jusqu’au" : "hours ending"} ${new Date(signal.evidence.windowEnd).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "UTC" })} UTC`}
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
          {locale === "fr" && (
            <p>
              Les observations sont comparées à des périodes historiques
              comparables lorsqu’une référence suffisante existe. Les données
              manquantes ne sont pas interprétées comme un retour à la normale.
              Les méthodes détaillées et limites propres à ce signal sont
              conservées en anglais ci-dessous.
            </p>
          )}
          <p lang="en">{signal.methodology}</p>
          <p lang="en">{signal.limitation}</p>
          {locale === "fr" && (
            <p lang="en">{signal.evidence?.confidenceMethod}</p>
          )}
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
              : `${locale === "fr" ? "Source mise à jour :" : "Source updated:"} ${signal.sourceAsOf ? new Date(signal.sourceAsOf).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "UTC" }) + " UTC" : "Unavailable"}`}
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
