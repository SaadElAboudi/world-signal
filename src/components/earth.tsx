"use client";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
  useMemo,
} from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { SEVERITY_COLOR, type WorldSignal } from "@/core/types";
import type { WorldEvent } from "@/events/types";
import { Icon } from "./icon";

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const getMotionPreference = () => window.matchMedia(motionQuery).matches;

interface Country {
  properties: { ADMIN: string };
  geometry: { type: string; coordinates: number[][][] };
}

type GlobePoint =
  | {
      kind: "signal";
      id: string;
      latitude: number;
      longitude: number;
      severity: WorldSignal["severity"];
      signal: WorldSignal;
    }
  | {
      kind: "event";
      id: string;
      latitude: number;
      longitude: number;
      severity: WorldEvent["severity"];
      event: WorldEvent;
    };

export default function Earth({
  signals,
  selected,
  country,
  onSelect,
  onCountry,
}: {
  signals: WorldSignal[];
  selected: WorldSignal | null;
  country: string | null;
  onSelect: (s: WorldSignal) => void;
  onCountry: (name: string) => void;
}) {
  const labelSignals = useMemo(() => {
    if (signals.length <= 14) return signals;
    const countries = new Set<string>();
    return [...(selected ? [selected] : []), ...signals]
      .filter((signal) => {
        if (countries.has(signal.country)) return false;
        countries.add(signal.country);
        return true;
      })
      .slice(0, 12);
  }, [signals, selected]);
  const container = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 800, height: 700 });
  const [countries, setCountries] = useState<Country[]>([]);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<WorldEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rotating, setRotating] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    getMotionPreference,
    () => true,
  );
  const points = useMemo<GlobePoint[]>(
    () => [
      ...signals.map((signal) => ({
        kind: "signal" as const,
        id: signal.id,
        latitude: signal.latitude,
        longitude: signal.longitude,
        severity: signal.severity,
        signal,
      })),
      ...events.map((event) => ({
        kind: "event" as const,
        id: event.id,
        latitude: event.location.latitude,
        longitude: event.location.longitude,
        severity: event.severity,
        event,
      })),
    ],
    [signals, events],
  );

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (container.current) observer.observe(container.current);
    const abort = new AbortController();
    fetch("/geo/countries.geojson", { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Map unavailable");
        return response.json();
      })
      .then((data) => setCountries(data.features))
      .catch((error) => {
        if (error.name !== "AbortError") setFailed(true);
      });
    return () => {
      observer.disconnect();
      abort.abort();
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "demo") {
      setEvents([]);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/events?status=active&limit=300", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        const next = Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : [];
        if (!disposed) setEvents(next);
      } catch {
        // Universal events are additive; existing signals remain usable when this layer is unavailable.
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!ready || !selected) return;
    globe.current?.pointOfView(
      { lat: selected.latitude, lng: selected.longitude, altitude: 1.85 },
      reducedMotion ? 0 : 1100,
    );
  }, [ready, selected, reducedMotion]);
  useEffect(() => {
    if (!ready || !globe.current) return;
    globe.current.controls().autoRotate = rotating && !reducedMotion;
    globe.current.controls().autoRotateSpeed = 0.3;
  }, [ready, rotating, reducedMotion]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) globe.current?.pauseAnimation();
      else globe.current?.resumeAnimation();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);

  const onReady = useCallback(() => {
    if (!globe.current) return;
    globe.current.pointOfView({ lat: 23, lng: 43, altitude: 2.05 });
    globe.current.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    globe.current.controls().minDistance = 145;
    globe.current.controls().maxDistance = 500;
    globe.current.controls().enablePan = false;
    setReady(true);
  }, []);
  const zoom = (factor: number) => {
    const current = globe.current;
    if (current)
      current.pointOfView(
        {
          altitude: Math.max(
            0.5,
            Math.min(3.8, current.pointOfView().altitude * factor),
          ),
        },
        reducedMotion ? 0 : 400,
      );
  };
  const selectPoint = (point: GlobePoint) => {
    if (point.kind === "signal") {
      setSelectedEvent(null);
      onSelect(point.signal);
      return;
    }
    setSelectedEvent(point.event);
    globe.current?.pointOfView(
      { lat: point.latitude, lng: point.longitude, altitude: 1.85 },
      reducedMotion ? 0 : 900,
    );
  };

  return (
    <div className="earth-canvas" ref={container} data-testid="earth">
      <Globe
        ref={globe}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="/geo/earth-dark.jpg"
        atmosphereColor="#568c9a"
        atmosphereAltitude={0.13}
        showGraticules
        polygonsData={countries}
        polygonAltitude={0.002}
        polygonCapColor={(datum) =>
          (datum as Country).properties.ADMIN === country
            ? "rgba(98,215,183,0.24)"
            : "rgba(29,65,71,0.16)"
        }
        polygonSideColor={() => "rgba(0,0,0,0)"}
        polygonStrokeColor={() => "#345558"}
        polygonLabel={(datum) => (datum as Country).properties.ADMIN}
        onPolygonClick={(datum) => onCountry((datum as Country).properties.ADMIN)}
        pointsData={points}
        pointLat="latitude"
        pointLng="longitude"
        pointAltitude={(datum) => ((datum as GlobePoint).kind === "event" ? 0.014 : 0.008)}
        pointRadius={(datum) => {
          const point = datum as GlobePoint;
          if (point.kind === "event") return selectedEvent?.id === point.id ? 0.65 : 0.32;
          return point.id === selected?.id ? 0.7 : 0.45;
        }}
        pointColor={(datum) => SEVERITY_COLOR[(datum as GlobePoint).severity]}
        pointLabel={(datum) => {
          const point = datum as GlobePoint;
          return point.kind === "signal"
            ? `${point.signal.country} · ${point.signal.title} (${point.signal.provenance === "synthetic" ? "demo" : "observed"})`
            : `${point.event.category.replaceAll("_", " ")} · ${point.event.title}`;
        }}
        onPointClick={(datum) => selectPoint(datum as GlobePoint)}
        pointsTransitionDuration={reducedMotion ? 0 : 400}
        ringsData={reducedMotion ? [] : labelSignals}
        ringLat="latitude"
        ringLng="longitude"
        ringAltitude={0.018}
        ringColor={(datum: object) => SEVERITY_COLOR[(datum as WorldSignal).severity]}
        ringMaxRadius={3.2}
        ringPropagationSpeed={0.7}
        ringRepeatPeriod={2400}
        labelsData={labelSignals}
        labelLat="latitude"
        labelLng="longitude"
        labelAltitude={0.035}
        labelText={(datum) =>
          (datum as WorldSignal).country === "United States of America"
            ? "UNITED STATES"
            : (datum as WorldSignal).country.toUpperCase()
        }
        labelSize={0.9}
        labelColor={() => "#b7c8cb"
        }
        labelDotRadius={0}
        labelDotOrientation={() => "bottom"}
        labelResolution={2}
        onLabelClick={(datum) => onSelect(datum as WorldSignal)}
        onGlobeReady={onReady}
      />
      {!ready && (
        <div className="earth-loading">
          <span className="loading-orbit" />
          INITIALIZING EARTH
        </div>
      )}
      {failed && (
        <p className="map-warning">
          Country boundaries unavailable. Explore signals in the feed.
        </p>
      )}
      {selectedEvent && (
        <article className="event-map-card" data-severity={selectedEvent.severity}>
          <button
            type="button"
            aria-label="Close world event"
            onClick={() => setSelectedEvent(null)}
          >
            <Icon name="close" size={14} />
          </button>
          <small>{selectedEvent.category.replaceAll("_", " ")}</small>
          <strong>{selectedEvent.title}</strong>
          <span>{selectedEvent.description}</span>
          <a href={selectedEvent.source.url} target="_blank" rel="noreferrer">
            {selectedEvent.source.name} <Icon name="arrow" size={12} />
          </a>
        </article>
      )}
      <div className="globe-controls">
        <button aria-label="Zoom in" onClick={() => zoom(0.8)}>
          <Icon name="plus" />
        </button>
        <button aria-label="Zoom out" onClick={() => zoom(1.25)}>
          <Icon name="minus" />
        </button>
        <span />
        <button
          aria-label="Reset globe view"
          onClick={() =>
            globe.current?.pointOfView(
              { lat: 23, lng: 43, altitude: 2.05 },
              reducedMotion ? 0 : 900,
            )
          }
        >
          <Icon name="target" />
        </button>
        <button
          aria-label={rotating ? "Pause globe rotation" : "Rotate globe"}
          aria-pressed={rotating}
          disabled={reducedMotion}
          onClick={() => setRotating((value) => !value)}
        >
          <Icon name={rotating ? "pause" : "play"} size={15} />
        </button>
      </div>
    </div>
  );
}
