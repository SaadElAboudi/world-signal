"use client";
import { signalTitle } from "@/i18n/signals";
import { useI18n, LanguageSwitch } from "@/i18n/context";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { filterSignals, deviationLabel } from "@/core/analysis";
import {
  LAYERS,
  type SignalSnapshot,
  type SignalType,
  type WorldSignal,
} from "@/core/types";
import { Icon } from "./icon";
import type { WorldEvent } from "@/events/types";
import { WorldEventDetail, eventLabel } from "./world-event-detail";
import { CorrelationDetail } from "./correlation-detail";
import { SignalDetail } from "./signal-detail";
const Earth = dynamic(() => import("./earth"), {
  ssr: false,
  loading: function LoadingEarth() {
    const { t } = useI18n();
    return (
      <div className="earth-loading">
        <span className="loading-orbit" />
        {t("LOADING EARTH")}
      </div>
    );
  },
});
class GlobeBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <GlobeFailure /> : this.props.children;
  }
}
function GlobeFailure() {
  const { t } = useI18n();
  return (
    <div className="earth-loading">
      <Icon name="internet" size={64} />
      <p>{t("3D view unavailable on this device.")}</p>
      <span>{t("All signals and evidence remain available in the feed.")}</span>
    </div>
  );
}
const periods = [
  { label: "1H", hours: 1 },
  { label: "6H", hours: 6 },
  { label: "24H", hours: 24 },
  { label: "7D", hours: 168 },
  { label: "30D", hours: 720 },
];

export default function Dashboard({
  snapshot: initialSnapshot,
  initialEvents = [],
  initialEventsAvailable = false,
}: {
  snapshot: SignalSnapshot;
  initialEvents?: WorldEvent[];
  initialEventsAvailable?: boolean;
}) {
  const { t, locale, countryName } = useI18n();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const demo = snapshot.mode === "demo";
  const [view, setView] = useState<"signals" | "events">("signals");
  const [worldEvents, setWorldEvents] = useState(initialEvents);
  const [eventsAvailable, setEventsAvailable] = useState(
    initialEventsAvailable,
  );
  const [eventCategory, setEventCategory] = useState<string | null>(null);
  const [worldEventId, setWorldEventId] = useState<string | null>(null);
  const eventCategories = [
    ["natural_hazard", "Natural hazards", "Risques naturels"],
    ["climate", "Weather & climate", "Météo et climat"],
    ["infrastructure", "Networks", "Réseaux"],
    ["environment", "Environment", "Environnement"],
    ["mobility", "Mobility", "Mobilité"],
    ["earth_observation", "Earth observation", "Observation terrestre"],
  ];
  useEffect(() => {
    if (demo) return;
    const abort = new AbortController();
    const refresh = async () => {
      try {
        const r = await fetch("/api/events?status=active&limit=500", {
          signal: abort.signal,
          cache: "no-store",
        });
        if (!r.ok) throw Error();
        const data = await r.json();
        const events = Array.isArray(data) ? data : data.events;
        if (!Array.isArray(events)) throw Error();
        setWorldEvents(events);
        setEventsAvailable(true);
      } catch {
        if (!abort.signal.aborted) setEventsAvailable(false);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [demo]);

  const [types, setTypes] = useState<SignalType[]>(LAYERS.map((l) => l.id));
  const [hours, setHours] = useState(24);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [significantOnly, setSignificantOnly] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [replay, setReplay] = useState(100);
  const [playing, setPlaying] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const asOf = new Date(
    Date.parse(snapshot.asOf) - (1 - replay / 100) * hours * 3600000,
  ).toISOString();
  const visible = useMemo(
    () =>
      filterSignals(snapshot.signals, {
        types,
        hours,
        asOf,
        query,
        significantOnly,
        country: country ?? undefined,
      }),
    [snapshot.signals, types, hours, asOf, query, significantOnly, country],
  );
  const inWindow = useMemo(
    () =>
      filterSignals(snapshot.signals, {
        types: LAYERS.map((l) => l.id),
        hours,
        asOf,
      }),
    [snapshot.signals, hours, asOf],
  );
  const visibleWorldEvents = worldEvents.filter(
    (event) =>
      (!eventCategory || event.category === eventCategory) &&
      (!significantOnly || event.severity === "significant") &&
      Date.parse(event.updatedAt) >= Date.parse(asOf) - hours * 3600000 &&
      Date.parse(event.updatedAt) <= Date.parse(asOf) &&
      (!query ||
        `${event.title} ${eventLabel(event, locale)} ${event.source.name}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const selectedWorldEvent =
    visibleWorldEvents.find((e) => e.id === worldEventId) ?? null;
  const visibleEvents = (snapshot.correlations ?? []).filter(
    (event) =>
      event.signalIds.every((id) =>
        visible.some((signal) => signal.id === id),
      ) && Date.parse(event.windowEnd) <= Date.parse(asOf),
  );
  const selectedEvent =
    visibleEvents.find((event) => event.id === selectedEventId) ?? null;
  const memberIds = new Set(visibleEvents.flatMap((event) => event.signalIds));
  const feedItems = [
    ...visibleEvents,
    ...visible.filter((signal) => !memberIds.has(signal.id)),
  ].sort((a, b) => {
    const rank = (item: typeof a) =>
      ({ notable: 1, elevated: 2, significant: 3 })[item.severity] +
      item.confidence * 0.3 +
      ("signalIds" in item ? 0.15 : 0);
    return (
      rank(b) - rank(a) ||
      Date.parse("windowEnd" in b ? b.windowEnd : b.timestamp) -
        Date.parse("windowEnd" in a ? a.windowEnd : a.timestamp)
    );
  });
  const selected = visible.find((s) => s.id === selectedId) ?? null;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setSelectedEventId(null);
        setWorldEventId(null);
        search.current?.blur();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!playing || replay >= 100) return;
    const interval = setInterval(
      () => setReplay((value) => Math.min(100, value + 1)),
      350,
    );
    return () => clearInterval(interval);
  }, [playing, replay]);
  useEffect(() => {
    if (demo) return;
    const abort = new AbortController();
    const refresh = async () => {
      const params = new URLSearchParams({
        mode: "live",
        since: new Date(Date.now() - hours * 3600000).toISOString(),
        limit: "250",
      });
      if (types.length) params.set("type", types.join(","));
      if (query) params.set("q", query);
      if (country) params.set("country", country);
      if (significantOnly) params.set("severity", "significant");
      if (hours > 24) params.set("includeResolved", "true");
      try {
        const response = await fetch(`/api/signals?${params}`, {
          signal: abort.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (data.mode !== "live" || !Array.isArray(data.signals))
          throw new Error("Unavailable snapshot");
        if (!abort.signal.aborted) setSnapshot(data);
      } catch {
        if (!abort.signal.aborted)
          setSnapshot((previous) => ({
            ...previous,
            status: "delayed",
            providers: previous.providers.map((provider) => ({
              ...provider,
              status: "delayed",
              error: "refresh_failed",
            })),
          }));
      }
    };
    const debounce = setTimeout(refresh, 250);
    const poll = setInterval(refresh, 60000);
    return () => {
      abort.abort();
      clearTimeout(debounce);
      clearInterval(poll);
    };
  }, [demo, hours, types, query, country, significantOnly, refreshVersion]);
  const statusLabel = demo
    ? t("DEMO MODE")
    : snapshot.status === "live"
      ? t("LIVE DATA")
      : snapshot.status === "partial"
        ? t("PARTIAL DATA")
        : snapshot.status === "unavailable"
          ? t("DATA UNAVAILABLE")
          : t("DATA DELAYED");
  const isPlaying = playing && replay < 100;
  const select = (signal: WorldSignal) => {
    setSelectedEventId(null);
    setSelectedId(signal.id);
    if (window.matchMedia("(max-width: 760px)").matches)
      requestAnimationFrame(() => {
        document.querySelector(".feed-panel")?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
          block: "start",
        });
      });
  };
  const reset = () => {
    setWorldEventId(null);
    setEventCategory(null);
    setSelectedEventId(null);
    setTypes(LAYERS.map((l) => l.id));
    setQuery("");
    setCountry(null);
    setSignificantOnly(false);
    setSelectedId(null);
    setReplay(100);
    setPlaying(false);
  };
  const significantCount = visible.filter(
    (s) => s.severity === "significant",
  ).length;
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label={t("World Signal home")}>
          <span className="brand-symbol">
            <Icon name="internet" size={25} />
          </span>
          <span>
            WORLD<span className="brand-light"> SIGNAL</span>
            <small>{t("PLANETARY INTELLIGENCE")}</small>
          </span>
        </Link>
        <div className="header-middle">
          <span className="status-dot" />
          {t("EARTH OBSERVATORY")}
          <span className="header-divider">/</span> <span>01</span>
        </div>
        <div className="header-actions">
          <LanguageSwitch />
          <button
            className={`demo-badge ${!demo && snapshot.status === "live" ? "live-badge" : ""}`}
            onClick={() => dialog.current?.showModal()}
          >
            <span />
            {statusLabel}
            <Icon name="info" size={13} />
          </button>
          <Link
            className="mode-switch"
            href={`/?mode=${demo ? "live" : "demo"}&lang=${locale}`}
          >
            {demo ? t("Live view") : "Demo"}
          </Link>
          <span className="header-time">
            {new Date(asOf).toISOString().slice(11, 16)} <small>UTC</small>
          </span>
          <button
            className="icon-button help-button"
            aria-label={t("About the data")}
            onClick={() => dialog.current?.showModal()}
          >
            <Icon name="info" />
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="layer-sidebar" aria-label={t("Data layers")}>
          <div className="sidebar-title">
            <Icon name="layers" size={15} />
            <span>{t("DATA LAYERS")}</span>
            <span className="tiny-count">{t("04")}</span>
          </div>
          {view === "events" ? (
            <div className="layer-list event-category-list">
              <button
                className={`layer-button ${eventCategory === null ? "active" : ""}`}
                onClick={() => setEventCategory(null)}
              >
                {locale === "fr" ? "Tous les événements" : "All events"}
              </button>
              {eventCategories.map(([id, en, fr]) => (
                <button
                  className={`layer-button ${eventCategory === id ? "active" : ""}`}
                  key={id}
                  aria-label={locale === "fr" ? fr : en}
                  aria-pressed={eventCategory === id}
                  onClick={() =>
                    setEventCategory(eventCategory === id ? null : id)
                  }
                >
                  <span className="layer-name">
                    {locale === "fr" ? fr : en}
                  </span>
                  <span className="layer-count">
                    {worldEvents.filter((e) => e.category === id).length}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="layer-list">
              {LAYERS.map((layer) => {
                const active = types.includes(layer.id);
                return (
                  <button
                    key={layer.id}
                    aria-label={t(layer.name)}
                    title={t(layer.description)}
                    className={`layer-button ${active ? "active" : ""}`}
                    aria-pressed={active}
                    onClick={() =>
                      setTypes((prev) =>
                        active
                          ? prev.filter((t) => t !== layer.id)
                          : [...prev, layer.id],
                      )
                    }
                  >
                    <span className="layer-icon" style={{ color: layer.color }}>
                      <Icon name={layer.id} size={18} />
                    </span>
                    <span className="layer-name">
                      {layer.name}
                      <small>{layer.description}</small>
                    </span>
                    <span className="layer-count">
                      {inWindow
                        .filter((s) => s.type === layer.id)
                        .length.toString()
                        .padStart(2, "0")}
                    </span>
                    <span className="checkbox">
                      {active && <Icon name="check" size={10} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="sidebar-divider" />
          <div className="sidebar-label">{t("SIGNAL SEVERITY")}</div>
          <button
            aria-label={t("Significant only")}
            className={`severity-filter ${significantOnly ? "selected" : ""}`}
            aria-pressed={significantOnly}
            onClick={() => setSignificantOnly((v) => !v)}
          >
            <i className="severity-dot significant" />
            <span>{t("Significant only")}</span>
            <span className="checkbox">
              {significantOnly && <Icon name="check" size={10} />}
            </span>
          </button>
          <div className="severity-legend">
            <span>
              <i className="severity-dot elevated" />
              {t("Elevated")}
            </span>
            <span>
              <i className="severity-dot notable" />
              {t("Notable")}
            </span>
          </div>
          <div className="sidebar-bottom">
            <div className="coverage-icon">
              <Icon name="target" size={24} />
            </div>
            <h3>
              {t("A changing world.")}
              <br />
              {t("A clearer picture.")}
            </h3>
            <p>
              {t("Observed activity.")}
              <br />
              {t("Meaningful deviations.")}
              <br />
              {t("Evidence that explains.")}
            </p>
            <button onClick={() => dialog.current?.showModal()}>
              {t("How signals work")}
              <Icon name="arrow" size={14} />
            </button>
            <div className="source-status">
              <span className="status-dot" />
              {demo
                ? t("4 simulated data layers")
                : `${snapshot.providers.filter((p) => p.status === "healthy").length}/${snapshot.providers.length} sources current`}
            </div>
          </div>
        </aside>
        <section className="observatory" aria-label={t("Global observatory")}>
          <div className="globe-heading">
            <div className="eyebrow">
              <span className="status-dot" />
              {t("GLOBAL PULSE")}{" "}
              <span>{demo ? t("/ SIMULATION") : t("/ OBSERVED DATA")}</span>
            </div>
            <h1>{t("What changed?")}</h1>
            <p>
              <strong>
                {view === "events" ? visibleWorldEvents.length : visible.length}
              </strong>{" "}
              {view === "events"
                ? locale === "fr"
                  ? "événements signalés."
                  : "reported events."
                : t("unusual signals.")}{" "}
              <span>{t("One connected planet.")}</span>
            </p>
          </div>
          <div className="map-meta">
            <span>
              {new Date(asOf)
                .toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
                  timeZone: "UTC",
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
                .toUpperCase()}
            </span>
            <span>
              {demo
                ? replay === 100
                  ? t("DEMO SNAPSHOT")
                  : t("HISTORICAL REPLAY")
                : statusLabel}
            </span>
          </div>
          <GlobeBoundary>
            <Earth
              signals={view === "signals" ? visible : []}
              worldEvents={view === "events" ? visibleWorldEvents : []}
              selectedWorldEvent={selectedWorldEvent}
              onWorldEvent={(event) => setWorldEventId(event.id)}
              selected={selected}
              events={view === "signals" ? visibleEvents : []}
              selectedEvent={selectedEvent}
              onEvent={(event) => {
                setSelectedId(null);
                setSelectedEventId(event.id);
              }}
              country={view === "signals" ? country : null}
              onSelect={select}
              onCountry={(name) => {
                if (view !== "signals") return;
                setCountry(name);
                setSelectedId(null);
              }}
            />
          </GlobeBoundary>
          <form
            className="map-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (view === "events")
                setWorldEventId(visibleWorldEvents[0]?.id ?? null);
              else if (visible[0]) select(visible[0]);
            }}
          >
            <Icon name="search" size={17} />
            <input
              ref={search}
              aria-label={
                demo ? t("Search demo signals") : t("Search observed signals")
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCountry(null);
              }}
              placeholder={t("Find a place or signal…")}
            />
            {query ? (
              <button
                type="button"
                aria-label={t("Clear search")}
                onClick={() => setQuery("")}
              >
                <Icon name="close" size={15} />
              </button>
            ) : (
              <kbd>/</kbd>
            )}
          </form>
          {country && view === "signals" && (
            <div className="country-summary">
              <div>
                <span>{t("REGION FOCUS")}</span>
                <button
                  className="icon-button"
                  aria-label={t("Clear country selection")}
                  onClick={() => setCountry(null)}
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
              <h3>{countryName(country)}</h3>
              {LAYERS.map((l) => {
                const count = inWindow.filter(
                  (s) => s.country === country && s.type === l.id,
                ).length;
                return (
                  <p key={l.id}>
                    <span>{t(l.name)}</span>
                    <b>
                      {count
                        ? `${count} ${demo ? t("demo ") : ""}signal${count > 1 ? "s" : ""}`
                        : demo
                          ? t("No demo coverage")
                          : t("No matching signal / check coverage")}
                    </b>
                  </p>
                );
              })}
            </div>
          )}
          <div className="globe-caption">
            <span>
              <i />{" "}
              {view === "signals"
                ? significantCount
                : visibleWorldEvents.filter((e) => e.severity === "significant")
                    .length}{" "}
              {t("significant")}
            </span>
            <span className="activity-counts" hidden={view !== "signals"}>
              {visible.filter((s) => s.severity === "notable").length}{" "}
              {t("notable ·")}{" "}
              {visible.filter((s) => s.severity === "elevated").length}{" "}
              {t("elevated ·")} {visibleEvents.length} {t("multi")}
            </span>
            <span className="globe-instructions">
              {t("DRAG TO EXPLORE")}
              <span>·</span>
              {t("SCROLL TO ZOOM")}
            </span>
            <span className="coordinate-label">3D / WGS 84</span>
          </div>
        </section>
        <aside className="feed-panel" aria-label={t("Signal feed")}>
          {!demo && (
            <div
              className="feed-tabs"
              role="tablist"
              aria-label={locale === "fr" ? "Type de données" : "Data view"}
            >
              <button
                role="tab"
                aria-selected={view === "signals"}
                onClick={() => {
                  setView("signals");
                  setCountry(null);
                }}
              >
                {locale === "fr" ? "Signaux inhabituels" : "Unusual signals"}
              </button>
              <button
                role="tab"
                aria-selected={view === "events"}
                onClick={() => {
                  setView("events");
                  setCountry(null);
                  setSelectedId(null);
                }}
              >
                {locale === "fr" ? "Événements signalés" : "Reported events"}
              </button>
            </div>
          )}
          {view === "events" ? (
            selectedWorldEvent ? (
              <WorldEventDetail
                event={selectedWorldEvent}
                onClose={() => setWorldEventId(null)}
              />
            ) : (
              <>
                <div className="panel-heading">
                  <span>
                    {locale === "fr"
                      ? "ÉVÉNEMENTS SIGNALÉS"
                      : "REPORTED EVENTS"}
                  </span>
                  <span>{visibleWorldEvents.length}</span>
                </div>
                <div className="feed-subtitle">
                  {locale === "fr"
                    ? "Mis à jour pendant la période sélectionnée"
                    : "Updated within the selected time window"}
                </div>
                <div className="signal-list">
                  {!eventsAvailable && (
                    <p className="context-note" role="status">
                      {locale === "fr"
                        ? "Actualisation indisponible. Les dernières données sont conservées."
                        : "Refresh unavailable. Showing the last available data."}
                    </p>
                  )}
                  {visibleWorldEvents.map((event) => (
                    <button
                      className={`signal-card ${event.severity}`}
                      key={event.id}
                      onClick={() => setWorldEventId(event.id)}
                    >
                      <div className="signal-card-top">
                        <span>◇ {eventLabel(event, locale)}</span>
                        <time>
                          {new Date(event.updatedAt)
                            .toISOString()
                            .slice(11, 16)}
                        </time>
                      </div>
                      <h3>{event.title}</h3>
                      <div className="signal-card-bottom">
                        <span>{event.source.name}</span>
                        <small>
                          {event.location.latitude.toFixed(1)}°,{" "}
                          {event.location.longitude.toFixed(1)}°
                        </small>
                      </div>
                    </button>
                  ))}
                  {!visibleWorldEvents.length && (
                    <div className="empty-state">
                      <h3>
                        {locale === "fr"
                          ? "Aucun événement dans cette période"
                          : "No events in this time window"}
                      </h3>
                      <p>
                        {locale === "fr"
                          ? "Élargissez la période ou changez de catégorie. L’absence de résultat ne prouve pas l’absence d’activité."
                          : "Widen the period or change category. No result does not prove absence of activity."}
                      </p>
                    </div>
                  )}
                </div>
                <div className="feed-footer">
                  {locale === "fr"
                    ? "Rapports de sources et seuils documentés · pas un indice de danger"
                    : "Source reports and documented thresholds · not a danger index"}
                </div>
              </>
            )
          ) : selectedEvent ? (
            <CorrelationDetail
              event={selectedEvent}
              signals={snapshot.signals}
              onClose={() => setSelectedEventId(null)}
              onSelect={select}
            />
          ) : selected ? (
            <SignalDetail
              key={selected.id}
              signal={selected}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <>
              <div className="panel-heading">
                <span>
                  <i className="status-dot" />
                  {t("SIGNAL FEED")}
                </span>
                <span className="feed-count">
                  {visible.length.toString().padStart(2, "0")}
                </span>
              </div>
              <div className="feed-subtitle">
                <span>
                  {country ? countryName(country) : t("Around the world")}
                </span>
                <span>
                  {t("PRIORITY & RECENCY")}
                  <Icon name="arrow" size={11} />
                </span>
              </div>
              <div className="signal-list">
                {feedItems.map((signal) =>
                  "signalIds" in signal ? (
                    <button
                      key={signal.id}
                      className={`signal-card multi-signal-card ${signal.severity}`}
                      onClick={() => {
                        setSelectedId(null);
                        setSelectedEventId(signal.id);
                      }}
                      aria-label={`View multi-signal event: ${signal.geographicScope.country}`}
                    >
                      <div className="signal-card-top">
                        <span>{t("◎ MULTIPLE SIGNALS")}</span>
                        <span>
                          {signal.windowHours}
                          {t("h")}
                        </span>
                      </div>
                      <h3>
                        {countryName(
                          signal.geographicScope.country ??
                            "Offshore / unassigned",
                        )}
                      </h3>
                      <p>
                        {signal.signalTypes.map((type) => t(type)).join(" + ")}
                      </p>
                      <div className="signal-card-bottom">
                        <span className={`severity ${signal.severity}`}>
                          {t(signal.severity)}
                        </span>
                        <small>
                          {signal.signalTypes.length}
                          {t("independent systems")}
                        </small>
                      </div>
                    </button>
                  ) : (
                    <button
                      key={signal.id}
                      className={`signal-card ${signal.severity}`}
                      onClick={() => select(signal)}
                      aria-label={`View ${signal.country} signal: ${signalTitle(signal, locale)}`}
                    >
                      <div className="signal-card-top">
                        <span>
                          <Icon name={signal.type} size={14} />
                          {countryName(signal.country)}
                        </span>
                        <time dateTime={signal.timestamp}>
                          {new Date(signal.timestamp)
                            .toISOString()
                            .slice(11, 16)}
                        </time>
                      </div>
                      <h3>
                        {signalTitle(signal, locale)}
                        {signal.status === "resolved" ? t(" · resolved") : ""}
                      </h3>
                      <div className="signal-card-bottom">
                        <span className={`severity ${signal.severity}`}>
                          <i />
                          {t(signal.severity)}
                        </span>
                        <strong>
                          {deviationLabel(signal)}
                          <small>
                            {signal.kind === "earthquake-event"
                              ? t("observed")
                              : t("vs baseline")}
                          </small>
                        </strong>
                      </div>
                    </button>
                  ),
                )}
                {!visible.length && (
                  <div className="empty-state">
                    <Icon name="target" size={35} />
                    <h3>{t("No matching signals")}</h3>
                    <p>
                      {t(
                        "Try another place, enable a layer or widen the time window. No result does not mean normal activity.",
                      )}
                    </p>
                    <button onClick={reset}>
                      {t("Reset filters")}
                      <Icon name="arrow" size={15} />
                    </button>
                  </div>
                )}
              </div>
              <div className="feed-footer">
                <Icon name="info" size={14} />
                <span>
                  {demo
                    ? t("Synthetic scenarios. Not live observations.")
                    : snapshot.truncated
                      ? `Showing ${snapshot.signals.length} of ${snapshot.total} signals. Refine filters.`
                      : t(
                          "Observed data · selection rules, not danger ratings.",
                        )}
                </span>
              </div>
            </>
          )}
        </aside>
      </div>
      <section className="timeline" aria-label={t("Time navigation")}>
        <div className="timeline-label">
          <Icon name="layers" size={16} />
          <span>{t("TIME WINDOW")}</span>
        </div>
        <div className="time-options">
          {periods.map((p) => (
            <button
              key={p.label}
              aria-pressed={hours === p.hours}
              className={hours === p.hours ? "active" : ""}
              onClick={() => {
                setHours(p.hours);
                setReplay(100);
                setPlaying(false);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="timeline-divider" />
        <button
          className={`play-button ${isPlaying ? "active" : ""}`}
          disabled={!demo}
          title={
            !demo
              ? t(
                  "Live history uses time-window filters. Exact historical replay is not available.",
                )
              : t("Replay demo scenarios")
          }
          aria-label={isPlaying ? t("Pause replay") : t("Play demo replay")}
          onClick={() => {
            if (replay === 100) {
              setReplay(0);
              setPlaying(true);
            } else setPlaying((v) => !v);
          }}
        >
          <Icon name={isPlaying ? "pause" : "play"} size={14} />
        </button>
        <div className="scrubber">
          <div className="scrubber-labels">
            <span>
              {new Date(
                Date.parse(snapshot.asOf) - hours * 3600000,
              ).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", {
                timeZone: "UTC",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span>
              {demo && replay === 100
                ? t("16 SEP · 21:43 UTC")
                : new Date(asOf).toLocaleString(
                    locale === "fr" ? "fr-FR" : "en-GB",
                    {
                      timeZone: "UTC",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  ) + " UTC"}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={replay}
            aria-label={
              demo ? t("Demo replay position") : t("Live snapshot position")
            }
            disabled={!demo}
            onChange={(e) => {
              setReplay(Number(e.target.value));
              setPlaying(false);
            }}
          />
        </div>
        <button
          className="snapshot-button"
          onClick={() => {
            if (!demo) setRefreshVersion((value) => value + 1);
            setReplay(100);
            setPlaying(false);
          }}
        >
          <span className="status-dot" />
          {demo ? t("SNAPSHOT") : t("CURRENT")}
        </button>
      </section>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          {demo ? t("DEMO ENVIRONMENT") : statusLabel}
          <span className="statusbar-sep">/</span>
          {demo
            ? t("ALL VALUES ARE SYNTHETIC")
            : t("4 OBSERVABLE SYSTEMS · NO SYNTHETIC OBSERVATIONS")}
        </span>
        <span>
          {t("OBSERVE. COMPARE. UNDERSTAND.")}
          <span className="statusbar-sep">/</span>
          V0.3
        </span>
      </footer>
      <dialog
        ref={dialog}
        className="about-dialog"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="panel-heading">
          <span>{t("THE SIGNAL, NOT THE NOISE")}</span>
          <button
            className="icon-button"
            aria-label={t("Close about dialog")}
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="about-content">
          <Icon name="internet" size={40} />
          <h2>
            {t("A window into a")}
            <br />
            {t("changing world.")}
          </h2>
          <p>
            {t(
              "WORLD SIGNAL compares observed activity with a reference, highlights unusual changes and puts the evidence within reach.",
            )}
          </p>
          <div className="process-steps">
            <span>{t("01 Observe")}</span>
            <span>{t("02 Compare")}</span>
            <span>{t("03 Explain")}</span>
          </div>
          {demo ? (
            <>
              <h3>{t("You are exploring a demonstration.")}</h3>
              <p>
                {t(
                  "Every event, measurement and reference sample in demo mode is synthetic. The fixed scenario ends on 16 September 2026 at 21:43 UTC. Switch to Live view to query observed USGS and NASA FIRMS data; the modes never mix.",
                )}
              </p>
              <p>
                {t(
                  "Demo severity uses count z-scores, detection ratios and traffic deviations over synthetic 30-day references. No AI is generating explanations.",
                )}
              </p>
            </>
          ) : (
            <>
              <h3>{t("Observed data and source health")}</h3>
              <p>
                {t("Scheduled collection: approximately every")}{" "}
                {snapshot.collectionCadenceMinutes ?? 5}
                {t(
                  "minutes. Upstream reporting can take longer; collection times below show actual freshness.",
                )}
              </p>
              <div className="provider-health">
                {snapshot.providers.map((provider) => (
                  <div key={provider.id ?? provider.name}>
                    <strong>{provider.name}</strong>
                    <span className={`health-${provider.status}`}>
                      {t(provider.status).toUpperCase()}
                    </span>
                    <p>
                      {t("Last successful collection:")}{" "}
                      {provider.lastSuccessAt
                        ? new Date(provider.lastSuccessAt).toLocaleString(
                            locale === "fr" ? "fr-FR" : "en-GB",
                            { timeZone: "UTC" },
                          ) + " UTC"
                        : t("Not available")}
                    </p>
                    <p>
                      {t("Latest observation:")}{" "}
                      {provider.latestObservationAt
                        ? new Date(provider.latestObservationAt).toLocaleString(
                            locale === "fr" ? "fr-FR" : "en-GB",
                            { timeZone: "UTC" },
                          ) + " UTC"
                        : t("Not available")}
                    </p>
                    {provider.scopes && (
                      <p>
                        {provider.scopes.fresh}/{provider.scopes.configured}
                        {t("monitored areas with recent observations")}
                      </p>
                    )}
                    {provider.historyDays !== undefined && (
                      <p>
                        {t("Stored history:")}
                        {provider.historyDays.toFixed(1)}
                        {t("days ·")}
                        {provider.analysisState === "collecting_history"
                          ? t("Collecting baseline")
                          : t(
                              "References available; eligibility varies by area",
                            )}
                      </p>
                    )}
                    {provider.recordsReceived !== undefined && (
                      <p>
                        {t("Received:")}
                        {provider.recordsReceived}
                        {t("· inserted:")}
                        {provider.recordsInserted ?? 0}
                        {t("· updated:")}
                        {provider.recordsUpdated ?? 0}
                      </p>
                    )}
                    {provider.error && (
                      <p>
                        {t("State:")}
                        {t(provider.error.replaceAll("_", " "))}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p>
                {t(
                  "A current collection does not guarantee full satellite or catalogue coverage. Provider failures never substitute demo data. Coverage and history vary by source. Aviation monitors selected regions; a missing observation never means zero traffic.",
                )}
              </p>
              <h3>{t("Transparent by design")}</h3>
              <p>
                {t(
                  "Individual earthquakes cross documented magnitude, depth or significance thresholds. Regional anomalies compare counts in equal-length windows with stored historical observations. The current window is excluded. Short fire references are labeled provisional; missing history is never invented.",
                )}
              </p>
              <p>
                {t(
                  "Confidence is a documented data-quality indicator, not an incident probability. Thermal detections are not individual fires, and geographic cells are not incident perimeters. No AI or causal analysis is used.",
                )}
              </p>
            </>
          )}
          <p className="fineprint">
            {t(
              "Country boundaries: Natural Earth, public domain; generalized cartographic reference, not a statement on territorial status. Earth imagery: three-globe example asset.",
            )}
          </p>
          <button
            className="primary-button"
            onClick={() => dialog.current?.close()}
          >
            {t("Explore the signals")}
            <Icon name="arrow" size={17} />
          </button>
        </div>
      </dialog>
    </main>
  );
}
