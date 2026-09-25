"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SignalSnapshot, WorldSignal } from "@/core/types";
import type { CorrelatedEvent } from "@/correlations/types";
import { worldFeed } from "@/events/feed";
import type { EventCategory, WorldEvent } from "@/events/types";
import { useI18n, LanguageSwitch } from "@/i18n/context";
import { signalTitle } from "@/i18n/signals";
import { eventLabel } from "./world-event-detail";
import { Icon } from "./icon";
import { SignalDetail } from "./signal-detail";
import { WorldEventDetail } from "./world-event-detail";
import { CorrelationDetail } from "./correlation-detail";

const Earth = dynamic(() => import("./earth"), {
  ssr: false,
  loading: () => <div className="earth-loading">LOADING EARTH</div>,
});

const PERIODS = [
  { label: "6H", hours: 6 },
  { label: "24H", hours: 24 },
  { label: "7D", hours: 168 },
  { label: "30D", hours: 720 },
];

const CATEGORIES: Array<{
  id: EventCategory | null;
  en: string;
  fr: string;
}> = [
  { id: null, en: "All", fr: "Tout" },
  { id: "natural_hazard", en: "Nature", fr: "Nature" },
  { id: "climate", en: "Climate", fr: "Climat" },
  { id: "infrastructure", en: "Networks", fr: "Réseaux" },
  { id: "mobility", en: "Mobility", fr: "Mobilité" },
  { id: "environment", en: "Oceans & environment", fr: "Océans et environnement" },
];

type MobileView = "feed" | "map" | "links";
type FeedItem =
  | { kind: "event"; event: WorldEvent; timestamp: string }
  | { kind: "correlation"; correlation: CorrelatedEvent; timestamp: string };

function healthLabel(status: string, fr: boolean) {
  if (status === "healthy") return fr ? "À jour" : "Current";
  if (status === "delayed") return fr ? "Retardé" : "Delayed";
  if (status === "unavailable" || status === "error")
    return fr ? "Indisponible" : "Unavailable";
  return fr ? "Historique en construction" : "Building history";
}

function severityLabel(severity: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    significant: ["Important", "Important"],
    elevated: ["Elevated", "Élevé"],
    notable: ["Notable", "Notable"],
    info: ["Information", "Information"],
  };
  return labels[severity]?.[fr ? 1 : 0] ?? severity;
}

function eventNature(event: WorldEvent, fr: boolean) {
  if (event.properties.signalId)
    return event.type === "earthquake"
      ? fr
        ? "Observé"
        : "Observed"
      : fr
        ? "Anomalie"
        : "Anomaly";
  if (["earthquake", "wildfire", "volcano", "flood", "tropical_cyclone"].includes(event.type))
    return fr ? "Signalé" : "Reported";
  return fr ? "Détecté" : "Detected";
}

function correlationMatchesCategory(item: CorrelatedEvent, category: EventCategory | null) {
  if (!category) return true;
  const categories: EventCategory[] = item.signalTypes.map((type) => {
    if (["earthquake", "wildfire"].includes(type)) return "natural_hazard";
    if (type === "internet") return "infrastructure";
    if (type === "aviation") return "mobility";
    return "environment";
  });
  return categories.includes(category);
}

function errorExplanation(error: string | null | undefined, fr: boolean) {
  if (!error) return fr ? "Dernières données conservées" : "Last data retained";
  if (["upstream_http_429", "provider_cooldown"].includes(error))
    return fr ? "Limite temporaire du fournisseur" : "Temporary provider limit";
  if (error === "all_scopes_unavailable")
    return fr ? "Source temporairement inaccessible" : "Source temporarily unreachable";
  if (error === "analysis_pending")
    return fr ? "Analyse en cours" : "Analysis in progress";
  return fr ? "Actualisation temporairement indisponible" : "Refresh temporarily unavailable";
}

export function LiveDashboard({
  snapshot: initialSnapshot,
  initialEvents = [],
  initialEventsAvailable = false,
}: {
  snapshot: SignalSnapshot;
  initialEvents?: WorldEvent[];
  initialEventsAvailable?: boolean;
}) {
  const { locale, countryName } = useI18n();
  const fr = locale === "fr";
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [events, setEvents] = useState(initialEvents);
  const [eventsAvailable, setEventsAvailable] = useState(initialEventsAvailable);
  const [hours, setHours] = useState(24);
  const [category, setCategory] = useState<EventCategory | null>(null);
  const [query, setQuery] = useState("");
  const [mobileView, setMobileView] = useState<MobileView>("feed");
  const [isCompact, setIsCompact] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedCorrelationId, setSelectedCorrelationId] = useState<string | null>(null);
  const healthDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setIsCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    const refresh = async () => {
      const since = new Date(Date.now() - hours * 3600000).toISOString();
      const [signalResult, eventResult] = await Promise.allSettled([
        fetch(`/api/signals?mode=live&since=${encodeURIComponent(since)}&limit=500`, {
          signal: abort.signal,
          cache: "no-store",
        }).then(async (response) => {
          if (!response.ok) throw new Error("signals_unavailable");
          return response.json();
        }),
        fetch("/api/events?status=active&limit=500", {
          signal: abort.signal,
          cache: "no-store",
        }).then(async (response) => {
          if (!response.ok) throw new Error("events_unavailable");
          return response.json();
        }),
      ]);
      if (abort.signal.aborted) return;
      if (signalResult.status === "fulfilled" && Array.isArray(signalResult.value.signals))
        setSnapshot(signalResult.value);
      else if (signalResult.status === "rejected")
        setSnapshot((previous) => ({
          ...previous,
          status: "delayed",
          providers: previous.providers.map((provider) => ({
            ...provider,
            status: "delayed",
            error: "refresh_failed",
          })),
        }));
      if (eventResult.status === "fulfilled") {
        const next = Array.isArray(eventResult.value)
          ? eventResult.value
          : eventResult.value.events;
        if (Array.isArray(next)) {
          setEvents(next);
          setEventsAvailable(true);
        }
      } else setEventsAvailable(false);
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [hours]);

  const asOfMs = Date.parse(snapshot.asOf);
  const allEvents = useMemo(() => worldFeed(events, snapshot.signals), [events, snapshot.signals]);
  const visibleEvents = useMemo(
    () =>
      allEvents.filter((event) => {
        const updated = Date.parse(event.updatedAt);
        const text = `${event.title} ${eventLabel(event, locale)} ${event.source.name}`.toLowerCase();
        return (
          updated >= asOfMs - hours * 3600000 &&
          updated <= asOfMs &&
          (!category || event.category === category) &&
          (!query || text.includes(query.toLowerCase()))
        );
      }),
    [allEvents, asOfMs, hours, category, query, locale],
  );
  const correlations = useMemo(
    () =>
      (snapshot.correlations ?? []).filter(
        (item) =>
          Date.parse(item.windowEnd) >= asOfMs - hours * 3600000 &&
          Date.parse(item.windowEnd) <= asOfMs &&
          correlationMatchesCategory(item, category),
      ),
    [snapshot.correlations, asOfMs, hours, category],
  );
  const feed = useMemo<FeedItem[]>(
    () =>
      [
        ...visibleEvents.map((event) => ({
          kind: "event" as const,
          event,
          timestamp: event.updatedAt,
        })),
        ...correlations.map((correlation) => ({
          kind: "correlation" as const,
          correlation,
          timestamp: correlation.windowEnd,
        })),
      ].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
    [visibleEvents, correlations],
  );
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId) ?? null;
  const selectedSignal = selectedEvent?.properties.signalId
    ? snapshot.signals.find((signal) => signal.id === selectedEvent.properties.signalId) ?? null
    : null;
  const selectedCorrelation =
    correlations.find((item) => item.id === selectedCorrelationId) ?? null;
  const currentProviders = snapshot.providers.filter((provider) => provider.status === "healthy");
  const issueProviders = snapshot.providers.filter((provider) => provider.status !== "healthy");
  const importantCount = visibleEvents.filter((event) => event.severity === "significant").length;
  const mapSignals = snapshot.signals.filter((signal) =>
    visibleEvents.some((event) => event.properties.signalId === signal.id),
  );

  const openEvent = (event: WorldEvent) => {
    setSelectedCorrelationId(null);
    setSelectedEventId(event.id);
  };
  const openCorrelation = (item: CorrelatedEvent) => {
    setSelectedEventId(null);
    setSelectedCorrelationId(item.id);
  };
  const closeDetail = () => {
    setSelectedEventId(null);
    setSelectedCorrelationId(null);
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedEventId(null);
        setSelectedCorrelationId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <main className="live-shell">
      <header className="live-topbar">
        <Link className="brand" href="/" aria-label="World Signal">
          <span className="brand-symbol"><Icon name="internet" size={24} /></span>
          <span>WORLD<span className="brand-light"> SIGNAL</span><small>{fr ? "OBSERVATOIRE MONDIAL" : "WORLD OBSERVATORY"}</small></span>
        </Link>
        <nav className="live-nav" aria-label={fr ? "Navigation principale" : "Main navigation"}>
          <a href="#now">{fr ? "Maintenant" : "Now"}</a>
          <a href="#correlations">{fr ? "Corrélations" : "Correlations"}</a>
          <button onClick={() => healthDialog.current?.showModal()}>{fr ? "Sources" : "Sources"}</button>
        </nav>
        <div className="live-header-actions">
          <LanguageSwitch />
          <button className="source-health-pill" onClick={() => healthDialog.current?.showModal()}>
            <i className={issueProviders.length ? "has-issues" : ""} />
            {currentProviders.length}/{snapshot.providers.length} {fr ? "sources à jour" : "sources current"}
          </button>
        </div>
      </header>

      <section className="world-now" id="now">
        <div>
          <span className="world-now-kicker">{fr ? "LE MONDE MAINTENANT" : "THE WORLD NOW"}</span>
          <h1>{fr ? "Comprendre ce qui change." : "Understand what is changing."}</h1>
        </div>
        <p>
          <strong>{visibleEvents.length}</strong> {fr ? "événements" : "events"}
          <span>·</span>
          <strong>{correlations.length}</strong> {fr ? "corrélations" : "correlations"}
          <span>·</span>
          {fr ? "Actualisé à" : "Updated at"} {new Date(snapshot.asOf).toISOString().slice(11, 16)} UTC
        </p>
      </section>

      <div className="mobile-primary-tabs" role="tablist" aria-label={fr ? "Vue principale" : "Primary view"}>
        {([
          ["feed", fr ? "Fil" : "Feed"],
          ["map", fr ? "Carte" : "Map"],
          ["links", fr ? "Liens" : "Links"],
        ] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mobileView === id} onClick={() => setMobileView(id)}>{label}</button>
        ))}
      </div>

      <div className="live-filters" aria-label={fr ? "Filtres du Fil mondial" : "World Feed filters"}>
        <div className="category-chips">
          {CATEGORIES.map((item) => (
            <button key={item.id ?? "all"} className={category === item.id ? "active" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>
              {fr ? item.fr : item.en}
              <small>{item.id ? allEvents.filter((event) => event.category === item.id).length : allEvents.length}</small>
            </button>
          ))}
        </div>
        <label className="live-search">
          <Icon name="search" size={16} />
          <span className="sr-only">{fr ? "Rechercher" : "Search"}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={fr ? "Rechercher un lieu ou un événement" : "Search a place or event"} />
        </label>
        <div className="period-chips">
          {PERIODS.map((period) => <button key={period.hours} className={hours === period.hours ? "active" : ""} onClick={() => setHours(period.hours)}>{period.label}</button>)}
        </div>
      </div>

      <div className={`live-workspace mobile-view-${mobileView}`}>
        <section className="live-map" aria-label={fr ? "Carte mondiale" : "World map"}>
          <div className="map-context">
            <span>{fr ? "CARTE SYNCHRONISÉE" : "SYNCHRONIZED MAP"}</span>
            <strong>{importantCount} {fr ? "importants" : "important"}</strong>
          </div>
          {!isCompact || mobileView === "map" ? (
            <Earth
              signals={mapSignals}
              worldEvents={visibleEvents.filter((event) => !event.properties.signalId)}
              selectedWorldEvent={selectedEvent}
              onWorldEvent={openEvent}
              selected={selectedSignal}
              events={correlations}
              selectedEvent={selectedCorrelation}
              onEvent={openCorrelation}
              country={null}
              onSelect={(signal: WorldSignal) => {
                const event = visibleEvents.find((item) => item.properties.signalId === signal.id);
                if (event) openEvent(event);
              }}
              onCountry={() => {}}
            />
          ) : null}
          <div className="map-legend">
            <span><i className="observed" />{fr ? "Observé" : "Observed"}</span>
            <span><i className="anomaly" />{fr ? "Anomalie" : "Anomaly"}</span>
            <span><i className="linked" />{fr ? "Corrélation" : "Correlation"}</span>
          </div>
        </section>

        <aside className="world-feed" aria-label={fr ? "Fil mondial" : "World Feed"}>
          {selectedSignal && selectedEvent ? (
            <SignalDetail signal={selectedSignal} onClose={closeDetail} />
          ) : selectedEvent ? (
            <WorldEventDetail event={selectedEvent} onClose={closeDetail} />
          ) : selectedCorrelation ? (
            <CorrelationDetail event={selectedCorrelation} signals={snapshot.signals} onClose={closeDetail} onSelect={(signal) => {
              const event = visibleEvents.find((item) => item.properties.signalId === signal.id);
              if (event) openEvent(event);
            }} />
          ) : (
            <>
              <div className="world-feed-heading">
                <div><span>{fr ? "FIL MONDIAL" : "WORLD FEED"}</span><h2>{fr ? "Ce qui se passe maintenant" : "What is happening now"}</h2></div>
                <strong>{feed.length}</strong>
              </div>
              {!eventsAvailable && <p className="feed-notice">{fr ? "Actualisation des événements indisponible. Les dernières données restent visibles." : "Event refresh unavailable. Last available data remains visible."}</p>}
              <div className="world-feed-list">
                {feed.map((item) => item.kind === "correlation" ? (
                  <button className="world-feed-card correlation" id="correlations" key={`correlation:${item.correlation.id}`} onClick={() => openCorrelation(item.correlation)}>
                    <div className="feed-card-meta"><time>{new Date(item.timestamp).toISOString().slice(11, 16)} UTC</time><span>{countryName(item.correlation.geographicScope.country ?? "Offshore / unassigned")}</span><b>{fr ? "À examiner" : "Review"}</b></div>
                    <h3>{fr ? "Plusieurs changements détectés dans la même zone" : "Multiple changes detected in the same area"}</h3>
                    <p>{item.correlation.signalTypes.map((type) => type === "internet" ? "Internet" : type === "aviation" ? (fr ? "Aviation" : "Aviation") : type === "earthquake" ? (fr ? "Séisme" : "Earthquake") : (fr ? "Feux" : "Wildfires")).join(" + ")}</p>
                    <footer><span>◎ {fr ? "CORRÉLATION" : "CORRELATION"}</span><small>{fr ? "Aucun lien causal confirmé" : "No causal link confirmed"}</small></footer>
                  </button>
                ) : (
                  <button className={`world-feed-card ${item.event.severity}`} key={item.event.id} onClick={() => openEvent(item.event)}>
                    <div className="feed-card-meta">
                      <time>{new Date(item.event.updatedAt).toISOString().slice(11, 16)} UTC</time>
                      <span>{typeof item.event.properties.country === "string" ? countryName(item.event.properties.country) : eventLabel(item.event, locale)}</span>
                      <b>{severityLabel(item.event.severity, fr)}</b>
                    </div>
                    <h3>{item.event.properties.signalId ? signalTitle(snapshot.signals.find((signal) => signal.id === item.event.properties.signalId)!, locale) : item.event.title}</h3>
                    <p>{item.event.magnitude.value !== null ? `${item.event.magnitude.value.toLocaleString(fr ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 })} ${item.event.magnitude.unit ?? ""}` : item.event.source.name}</p>
                    <footer><span>◇ {eventNature(item.event, fr).toUpperCase()}</span><small>{item.event.source.name}</small></footer>
                  </button>
                ))}
                {!feed.length && <div className="empty-state"><h3>{fr ? "Aucun événement dans cette période" : "No events in this time window"}</h3><p>{fr ? "Élargissez la période ou changez de catégorie. L’absence de résultat ne prouve pas l’absence d’activité." : "Widen the period or change category. No result does not prove absence of activity."}</p></div>}
              </div>
              <div className="world-feed-footer">{fr ? "Observation, anomalie ou corrélation : la nature de chaque élément est indiquée." : "Observation, anomaly or correlation: every item states its nature."}</div>
            </>
          )}
        </aside>
      </div>

      <dialog className="health-dialog" ref={healthDialog}>
        <div className="health-dialog-header">
          <div><span>{fr ? "ÉTAT DES DONNÉES" : "DATA STATUS"}</span><h2>{currentProviders.length}/{snapshot.providers.length} {fr ? "sources à jour" : "sources current"}</h2></div>
          <button className="icon-button" aria-label={fr ? "Fermer" : "Close"} onClick={() => healthDialog.current?.close()}><Icon name="close" /></button>
        </div>
        <p className="health-intro">{fr ? "Une source retardée ne rend pas les autres données indisponibles. Les dernières observations valides restent visibles." : "A delayed source does not make other data unavailable. Last valid observations remain visible."}</p>
        <div className="health-source-list">
          {snapshot.providers.map((provider) => (
            <article key={provider.id ?? provider.name}>
              <div><strong>{provider.name}</strong><span className={`health-${provider.status}`}>{healthLabel(provider.status, fr)}</span></div>
              <p>{errorExplanation(provider.error, fr)}</p>
              <small>{fr ? "Dernière collecte réussie :" : "Last successful collection:"} {provider.lastSuccessAt ? `${new Date(provider.lastSuccessAt).toLocaleString(fr ? "fr-FR" : "en-GB", { timeZone: "UTC" })} UTC` : fr ? "Non disponible" : "Unavailable"}</small>
            </article>
          ))}
        </div>
      </dialog>
    </main>
  );
}
