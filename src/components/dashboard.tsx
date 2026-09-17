"use client";
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
import { SignalDetail } from "./signal-detail";
const Earth = dynamic(() => import("./earth"), {
  ssr: false,
  loading: () => (
    <div className="earth-loading">
      <span className="loading-orbit" />
      LOADING EARTH
    </div>
  ),
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
    return this.state.failed ? (
      <div className="earth-loading">
        <Icon name="internet" size={64} />
        <p>3D view unavailable on this device.</p>
        <span>All signals and evidence remain available in the feed.</span>
      </div>
    ) : (
      this.props.children
    );
  }
}
const periods = [
  { label: "1H", hours: 1 },
  { label: "6H", hours: 6 },
  { label: "24H", hours: 24 },
  { label: "7D", hours: 168 },
  { label: "30D", hours: 720 },
];
const shortCountry = (s: string) =>
  s === "United States of America" ? "United States" : s;
export default function Dashboard({
  snapshot: initialSnapshot,
}: {
  snapshot: SignalSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const demo = snapshot.mode === "demo";
  const [types, setTypes] = useState<SignalType[]>(
    LAYERS.filter(
      (l) => demo || l.id === "earthquake" || l.id === "wildfire",
    ).map((l) => l.id),
  );
  const [hours, setHours] = useState(24);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    ? "DEMO MODE"
    : snapshot.status === "live"
      ? "LIVE DATA"
      : snapshot.status === "partial"
        ? "PARTIAL DATA"
        : snapshot.status === "unavailable"
          ? "DATA UNAVAILABLE"
          : "DATA DELAYED";
  const isPlaying = playing && replay < 100;
  const select = (signal: WorldSignal) => {
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
    setTypes(
      LAYERS.filter(
        (l) => demo || l.id === "earthquake" || l.id === "wildfire",
      ).map((l) => l.id),
    );
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
        <Link className="brand" href="/" aria-label="World Signal home">
          <span className="brand-symbol">
            <Icon name="internet" size={25} />
          </span>
          <span>
            WORLD<span className="brand-light"> SIGNAL</span>
            <small>PLANETARY INTELLIGENCE</small>
          </span>
        </Link>
        <div className="header-middle">
          <span className="status-dot" />
          EARTH OBSERVATORY <span className="header-divider">/</span>{" "}
          <span>01</span>
        </div>
        <div className="header-actions">
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
            href={demo ? "/?mode=live" : "/?mode=demo"}
          >
            {demo ? "Live view" : "Demo"}
          </Link>
          <span className="header-time">
            {new Date(asOf).toISOString().slice(11, 16)} <small>UTC</small>
          </span>
          <button
            className="icon-button help-button"
            aria-label="About the data"
            onClick={() => dialog.current?.showModal()}
          >
            <Icon name="info" />
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="layer-sidebar" aria-label="Data layers">
          <div className="sidebar-title">
            <Icon name="layers" size={15} />
            <span>DATA LAYERS</span>
            <span className="tiny-count">{demo ? "04" : "02"}</span>
          </div>
          <div className="layer-list">
            {LAYERS.map((layer) => {
              const active = types.includes(layer.id);
              return (
                <button
                  key={layer.id}
                  aria-label={layer.name}
                  disabled={
                    !demo &&
                    (layer.id === "internet" || layer.id === "aviation")
                  }
                  title={
                    !demo &&
                    (layer.id === "internet" || layer.id === "aviation")
                      ? "Not connected in this release"
                      : layer.description
                  }
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
                    <small>
                      {!demo &&
                      (layer.id === "internet" || layer.id === "aviation")
                        ? "Not connected"
                        : layer.description}
                    </small>
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
          <div className="sidebar-divider" />
          <div className="sidebar-label">SIGNAL SEVERITY</div>
          <button
            aria-label="Significant only"
            className={`severity-filter ${significantOnly ? "selected" : ""}`}
            aria-pressed={significantOnly}
            onClick={() => setSignificantOnly((v) => !v)}
          >
            <i className="severity-dot significant" />
            <span>Significant only</span>
            <span className="checkbox">
              {significantOnly && <Icon name="check" size={10} />}
            </span>
          </button>
          <div className="severity-legend">
            <span>
              <i className="severity-dot elevated" />
              Elevated
            </span>
            <span>
              <i className="severity-dot notable" />
              Notable
            </span>
          </div>
          <div className="sidebar-bottom">
            <div className="coverage-icon">
              <Icon name="target" size={24} />
            </div>
            <h3>
              A changing world.
              <br />A clearer picture.
            </h3>
            <p>
              Observed activity.
              <br />
              Meaningful deviations.
              <br />
              Evidence that explains.
            </p>
            <button onClick={() => dialog.current?.showModal()}>
              How signals work
              <Icon name="arrow" size={14} />
            </button>
            <div className="source-status">
              <span className="status-dot" />
              {demo
                ? "4 simulated data layers"
                : `${snapshot.providers.filter((p) => p.status === "healthy").length}/2 sources current`}
            </div>
          </div>
        </aside>
        <section className="observatory" aria-label="Global observatory">
          <div className="globe-heading">
            <div className="eyebrow">
              <span className="status-dot" />
              GLOBAL PULSE{" "}
              <span>{demo ? "/ SIMULATION" : "/ OBSERVED DATA"}</span>
            </div>
            <h1>What changed?</h1>
            <p>
              <strong>{visible.length}</strong> unusual signals.{" "}
              <span>One connected planet.</span>
            </p>
          </div>
          <div className="map-meta">
            <span>
              {new Date(asOf)
                .toLocaleDateString("en-GB", {
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
                  ? "DEMO SNAPSHOT"
                  : "HISTORICAL REPLAY"
                : statusLabel}
            </span>
          </div>
          <GlobeBoundary>
            <Earth
              signals={visible}
              selected={selected}
              country={country}
              onSelect={select}
              onCountry={(name) => {
                setCountry(name);
                setSelectedId(null);
              }}
            />
          </GlobeBoundary>
          <form
            className="map-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (visible[0]) select(visible[0]);
            }}
          >
            <Icon name="search" size={17} />
            <input
              ref={search}
              aria-label={
                demo ? "Search demo signals" : "Search observed signals"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCountry(null);
              }}
              placeholder="Find a place or signal…"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <Icon name="close" size={15} />
              </button>
            ) : (
              <kbd>/</kbd>
            )}
          </form>
          {country && (
            <div className="country-summary">
              <div>
                <span>REGION FOCUS</span>
                <button
                  className="icon-button"
                  aria-label="Clear country selection"
                  onClick={() => setCountry(null)}
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
              <h3>{shortCountry(country)}</h3>
              {LAYERS.map((l) => {
                const count = inWindow.filter(
                  (s) => s.country === country && s.type === l.id,
                ).length;
                return (
                  <p key={l.id}>
                    <span>{l.name}</span>
                    <b>
                      {count
                        ? `${count} ${demo ? "demo " : ""}signal${count > 1 ? "s" : ""}`
                        : demo
                          ? "No demo coverage"
                          : "No matching signal / check coverage"}
                    </b>
                  </p>
                );
              })}
            </div>
          )}
          <div className="globe-caption">
            <span>
              <i /> {significantCount} significant
            </span>
            <span className="globe-instructions">
              DRAG TO EXPLORE <span>·</span> SCROLL TO ZOOM
            </span>
            <span className="coordinate-label">3D / WGS 84</span>
          </div>
        </section>
        <aside className="feed-panel" aria-label="Signal feed">
          {selected ? (
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
                  SIGNAL FEED
                </span>
                <span className="feed-count">
                  {visible.length.toString().padStart(2, "0")}
                </span>
              </div>
              <div className="feed-subtitle">
                <span>
                  {country ? shortCountry(country) : "Around the world"}
                </span>
                <span>
                  LATEST FIRST
                  <Icon name="arrow" size={11} />
                </span>
              </div>
              <div className="signal-list">
                {visible.map((signal) => (
                  <button
                    key={signal.id}
                    className={`signal-card ${signal.severity}`}
                    onClick={() => select(signal)}
                    aria-label={`View ${signal.country} signal: ${signal.title}`}
                  >
                    <div className="signal-card-top">
                      <span>
                        <Icon name={signal.type} size={14} />
                        {shortCountry(signal.country)}
                      </span>
                      <time dateTime={signal.timestamp}>
                        {new Date(signal.timestamp).toISOString().slice(11, 16)}
                      </time>
                    </div>
                    <h3>
                      {signal.title}
                      {signal.status === "resolved" ? " · resolved" : ""}
                    </h3>
                    <div className="signal-card-bottom">
                      <span className={`severity ${signal.severity}`}>
                        <i />
                        {signal.severity}
                      </span>
                      <strong>
                        {deviationLabel(signal)}
                        <small>
                          {signal.kind === "earthquake-event"
                            ? "observed"
                            : "vs baseline"}
                        </small>
                      </strong>
                    </div>
                  </button>
                ))}
                {!visible.length && (
                  <div className="empty-state">
                    <Icon name="target" size={35} />
                    <h3>No matching signals</h3>
                    <p>
                      Try another place, enable a layer or widen the time
                      window. No result does not mean normal activity.
                    </p>
                    <button onClick={reset}>
                      Reset filters
                      <Icon name="arrow" size={15} />
                    </button>
                  </div>
                )}
              </div>
              <div className="feed-footer">
                <Icon name="info" size={14} />
                <span>
                  {demo
                    ? "Synthetic scenarios. Not live observations."
                    : snapshot.truncated
                      ? `Showing ${snapshot.signals.length} of ${snapshot.total} signals. Refine filters.`
                      : "Observed data · selection rules, not danger ratings."}
                </span>
              </div>
            </>
          )}
        </aside>
      </div>
      <section className="timeline" aria-label="Time navigation">
        <div className="timeline-label">
          <Icon name="layers" size={16} />
          <span>TIME WINDOW</span>
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
              ? "Live history uses time-window filters. Exact historical replay is not available."
              : "Replay demo scenarios"
          }
          aria-label={isPlaying ? "Pause replay" : "Play demo replay"}
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
              ).toLocaleString("en-GB", {
                timeZone: "UTC",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span>
              {demo && replay === 100
                ? "16 SEP · 21:43 UTC"
                : new Date(asOf).toLocaleString("en-GB", {
                    timeZone: "UTC",
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }) + " UTC"}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={replay}
            aria-label={
              demo ? "Demo replay position" : "Live snapshot position"
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
          {demo ? "SNAPSHOT" : "CURRENT"}
        </button>
      </section>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          {demo ? "DEMO ENVIRONMENT" : statusLabel}
          <span className="statusbar-sep">/</span>
          {demo
            ? "ALL VALUES ARE SYNTHETIC"
            : "USGS + NASA FIRMS · NO SYNTHETIC OBSERVATIONS"}
        </span>
        <span>
          OBSERVE. COMPARE. UNDERSTAND.<span className="statusbar-sep">/</span>
          V0.2
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
          <span>THE SIGNAL, NOT THE NOISE</span>
          <button
            className="icon-button"
            aria-label="Close about dialog"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="about-content">
          <Icon name="internet" size={40} />
          <h2>
            A window into a<br />
            changing world.
          </h2>
          <p>
            WORLD SIGNAL compares observed activity with a reference, highlights
            unusual changes and puts the evidence within reach.
          </p>
          <div className="process-steps">
            <span>01 Observe</span>
            <span>02 Compare</span>
            <span>03 Explain</span>
          </div>
          {demo ? (
            <>
              <h3>You are exploring a demonstration.</h3>
              <p>
                Every event, measurement and reference sample in demo mode is
                synthetic. The fixed scenario ends on 16 September 2026 at 21:43
                UTC. Switch to Live view to query observed USGS and NASA FIRMS
                data; the modes never mix.
              </p>
              <p>
                Demo severity uses count z-scores, detection ratios and traffic
                deviations over synthetic 30-day references. No AI is generating
                explanations.
              </p>
            </>
          ) : (
            <>
              <h3>Observed data and source health</h3>
              <div className="provider-health">
                {snapshot.providers.map((provider) => (
                  <div key={provider.id ?? provider.name}>
                    <strong>{provider.name}</strong>
                    <span className={`health-${provider.status}`}>
                      {provider.status.toUpperCase()}
                    </span>
                    <p>
                      Last successful collection:{" "}
                      {provider.lastSuccessAt
                        ? new Date(provider.lastSuccessAt).toLocaleString(
                            "en-GB",
                            { timeZone: "UTC" },
                          ) + " UTC"
                        : "Not available"}
                    </p>
                    <p>
                      Latest observation:{" "}
                      {provider.latestObservationAt
                        ? new Date(provider.latestObservationAt).toLocaleString(
                            "en-GB",
                            { timeZone: "UTC" },
                          ) + " UTC"
                        : "Not available"}
                    </p>
                    {provider.error && (
                      <p>State: {provider.error.replaceAll("_", " ")}</p>
                    )}
                  </div>
                ))}
              </div>
              <p>
                A current collection does not guarantee full satellite or
                catalogue coverage. Provider failures never substitute demo
                data. Internet and aviation are not connected.
              </p>
              <h3>Transparent by design</h3>
              <p>
                Individual earthquakes cross documented magnitude, depth or
                significance thresholds. Regional anomalies compare counts in
                equal-length windows with stored historical observations. The
                current window is excluded. Short fire references are labeled
                provisional; missing history is never invented.
              </p>
              <p>
                Confidence is a documented data-quality indicator, not an
                incident probability. Thermal detections are not individual
                fires, and geographic cells are not incident perimeters. No AI
                or causal analysis is used.
              </p>
            </>
          )}
          <p className="fineprint">
            Country boundaries: Natural Earth, public domain; generalized
            cartographic reference, not a statement on territorial status. Earth
            imagery: three-globe example asset.
          </p>
          <button
            className="primary-button"
            onClick={() => dialog.current?.close()}
          >
            Explore the signals
            <Icon name="arrow" size={17} />
          </button>
        </div>
      </dialog>
    </main>
  );
}
