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
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rotating, setRotating] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    getMotionPreference,
    () => true,
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
      .then((r) => {
        if (!r.ok) throw new Error("Map unavailable");
        return r.json();
      })
      .then((data) => setCountries(data.features))
      .catch((e) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => {
      observer.disconnect();
      abort.abort();
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
    globe.current
      .renderer()
      .setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    globe.current.controls().minDistance = 145;
    globe.current.controls().maxDistance = 500;
    globe.current.controls().enablePan = false;
    setReady(true);
  }, []);
  const zoom = (factor: number) => {
    const g = globe.current;
    if (g)
      g.pointOfView(
        {
          altitude: Math.max(
            0.5,
            Math.min(3.8, g.pointOfView().altitude * factor),
          ),
        },
        reducedMotion ? 0 : 400,
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
        polygonCapColor={(d) =>
          (d as Country).properties.ADMIN === country
            ? "rgba(98,215,183,0.24)"
            : "rgba(29,65,71,0.16)"
        }
        polygonSideColor={() => "rgba(0,0,0,0)"}
        polygonStrokeColor={() => "#345558"}
        polygonLabel={(d) => (d as Country).properties.ADMIN}
        onPolygonClick={(d) => onCountry((d as Country).properties.ADMIN)}
        pointsData={signals}
        pointLat="latitude"
        pointLng="longitude"
        pointAltitude={0.008}
        pointRadius={(d) =>
          (d as WorldSignal).id === selected?.id ? 0.7 : 0.45
        }
        pointColor={(d) => SEVERITY_COLOR[(d as WorldSignal).severity]}
        pointLabel={(d) =>
          `${(d as WorldSignal).country} · ${(d as WorldSignal).title} (${(d as WorldSignal).provenance === "synthetic" ? "demo" : "observed"})`
        }
        onPointClick={(d) => onSelect(d as WorldSignal)}
        pointsTransitionDuration={reducedMotion ? 0 : 400}
        ringsData={reducedMotion ? [] : labelSignals}
        ringLat="latitude"
        ringLng="longitude"
        ringAltitude={0.018}
        ringColor={(d: object) => SEVERITY_COLOR[(d as WorldSignal).severity]}
        ringMaxRadius={3.2}
        ringPropagationSpeed={0.7}
        ringRepeatPeriod={2400}
        labelsData={labelSignals}
        labelLat="latitude"
        labelLng="longitude"
        labelAltitude={0.035}
        labelText={(d) =>
          (d as WorldSignal).country === "United States of America"
            ? "UNITED STATES"
            : (d as WorldSignal).country.toUpperCase()
        }
        labelSize={0.9}
        labelColor={() => "#b7c8cb"}
        labelDotRadius={0}
        labelDotOrientation={() => "bottom"}
        labelResolution={2}
        onLabelClick={(d) => onSelect(d as WorldSignal)}
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
          onClick={() => setRotating((r) => !r)}
        >
          <Icon name={rotating ? "pause" : "play"} size={15} />
        </button>
      </div>
    </div>
  );
}
