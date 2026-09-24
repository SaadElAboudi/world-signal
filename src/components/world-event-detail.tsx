"use client";
import type { WorldEvent } from "@/events/types";
import { useI18n } from "@/i18n/context";
import { Icon } from "./icon";
export const eventNames: Record<string, [string, string]> = {
  earthquake: ["Earthquake", "Séisme"],
  wildfire: ["Wildfire", "Feu"],
  volcano: ["Volcano", "Volcan"],
  severe_storm: ["Severe storm", "Tempête"],
  tropical_cyclone: ["Tropical cyclone", "Cyclone"],
  flood: ["Flood", "Inondation"],
  landslide: ["Landslide", "Glissement de terrain"],
  drought: ["Drought", "Sécheresse"],
  dust_haze: ["Dust / haze", "Poussières / brume"],
  sea_lake_ice: ["Sea / lake ice", "Glaces"],
  snow: ["Snow", "Neige"],
  temperature_extreme: ["Extreme temperature", "Température extrême"],
  high_wind: ["Strong wind", "Vent fort"],
  heavy_rain: ["Heavy rain", "Fortes pluies"],
  internet_outage: ["Internet disruption", "Perturbation Internet"],
  aviation_disruption: ["Aviation disruption", "Perturbation aérienne"],
  water_anomaly: [
    "Ocean temperature change",
    "Variation de température océanique",
  ],
  marine_heatwave: ["Marine heatwave", "Vague de chaleur marine"],
  power_grid_anomaly: ["Power grid anomaly", "Anomalie du réseau électrique"],
  other: ["Reported event", "Événement signalé"],
};
export function eventLabel(event: WorldEvent, locale: string) {
  return (
    eventNames[event.type]?.[locale === "fr" ? 1 : 0] ??
    event.type.replaceAll("_", " ")
  );
}
export function WorldEventDetail({
  event,
  onClose,
}: {
  event: WorldEvent;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const fr = locale === "fr";
  const date = (s: string) =>
    new Date(s).toLocaleString(fr ? "fr-FR" : "en-GB", { timeZone: "UTC" });
  return (
    <section
      className="signal-detail"
      aria-label={fr ? "Détails de l’événement" : "Event details"}
    >
      <div className="panel-heading">
        <span>{fr ? "ÉVÉNEMENT SIGNALÉ" : "REPORTED EVENT"}</span>
        <button
          className="icon-button"
          aria-label={fr ? "Fermer l’événement" : "Close event"}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="detail-scroll">
        <div className="detail-type">
          {eventLabel(event, locale)}
          <span className="demo-mini">{t(event.status)}</span>
        </div>
        <h2>{event.title}</h2>
        <p className="region">
          {event.location.latitude.toFixed(2)}°,{" "}
          {event.location.longitude.toFixed(2)}° · {event.source.name}
        </p>
        <div className="context-note">
          <p>
            {fr
              ? "Un événement rapporté par une source externe ou détecté par une règle documentée. Ce n’est pas automatiquement une anomalie par rapport à une référence historique."
              : "An event reported by an external source or detected by a documented rule. This is not automatically an anomaly against a historical baseline."}
          </p>
        </div>
        {event.magnitude.value !== null && (
          <div className="big-measure">
            {event.magnitude.value.toLocaleString(fr ? "fr-FR" : "en-GB", {
              maximumFractionDigits: 2,
            })}
            <span>{event.magnitude.unit}</span>
          </div>
        )}
        <div className="detail-section">
          <h3>{fr ? "Quand et où" : "When and where"}</h3>
          <p>
            {fr ? "Début signalé :" : "Reported start:"} {date(event.startedAt)}{" "}
            UTC
          </p>
          <p>
            {fr ? "Mise à jour source :" : "Source update:"}{" "}
            {date(event.updatedAt)} UTC
          </p>
          {event.endedAt && (
            <p>
              {fr ? "Fin signalée :" : "Reported end:"} {date(event.endedAt)}{" "}
              UTC
            </p>
          )}
        </div>
        <details className="method-details">
          <summary>
            {fr
              ? "Rapport source · langue originale"
              : "Source report · original language"}
          </summary>
          <strong>{event.title}</strong>
          <p>{event.description}</p>
          <p>{event.magnitude.description}</p>
        </details>
        <div className="detail-section source-section">
          <h3>{fr ? "Source et vérification" : "Source and verification"}</h3>
          <a href={event.source.url} target="_blank" rel="noreferrer">
            {event.source.name}
            <Icon name="external" size={14} />
          </a>
          {event.secondarySources.map((s) => (
            <p key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.name} ↗
              </a>
            </p>
          ))}
          <p>
            {fr ? "Qualité déclarée des données :" : "Declared data quality:"}{" "}
            {Math.round(event.confidence * 100)} / 100.{" "}
            {fr
              ? "Cet indicateur ne mesure ni le danger ni une probabilité de cause."
              : "This indicator measures neither danger nor a causal probability."}
          </p>
        </div>
        <details className="method-details">
          <summary>
            {fr
              ? "Mesures et limites détaillées"
              : "Detailed measurements and limitations"}
          </summary>
          <dl className="event-properties">
            {Object.entries(event.properties).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll("_", " ")}</dt>
                <dd>{String(value ?? "—")}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </section>
  );
}
