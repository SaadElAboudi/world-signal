"use client";

import { useEffect, useMemo, useState } from "react";
import type { EventCategory, WorldEvent } from "@/events/types";
import styles from "./world-status.module.css";

const label: Record<string, string> = {
  natural_hazard: "Natural",
  climate: "Climate",
  environment: "Environment",
  infrastructure: "Infrastructure",
  mobility: "Mobility",
  earth_observation: "Earth obs.",
};

const categories: EventCategory[] = [
  "natural_hazard",
  "climate",
  "environment",
  "infrastructure",
  "mobility",
];

function timeAgo(timestamp: string, now: Date) {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(timestamp)) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function WorldStatus({ events: initialEvents }: { events: WorldEvent[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/events?status=active&limit=300", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const next = Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : [];
        if (!disposed) {
          setEvents(next);
          setNow(new Date());
        }
      } catch {
        // Keep the last known event surface if additive event storage is temporarily unavailable.
      }
    };
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  const active = useMemo(
    () => events.filter((event) => event.status === "active"),
    [events],
  );
  const latest = useMemo(
    () => [...active].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [active],
  );
  const filtered = category === "all" ? latest : latest.filter((event) => event.category === category);

  return (
    <section className={styles.status} aria-label="World event status">
      <div className={styles.summary}>
        <span className={styles.pulse} aria-hidden="true" />
        <strong>WORLD STATUS</strong>
        <b>{active.length}</b>
        <span>active events</span>
      </div>
      <div className={styles.counts}>
        {categories.map((item) => {
          const count = active.filter((event) => event.category === item).length;
          if (!count) return null;
          return <span key={item}><b>{count}</b> {label[item]}</span>;
        })}
      </div>
      <div className={styles.latest}>
        {latest.length ? latest.slice(0, 3).map((event) => (
          <a key={event.id} href={event.source.url} target="_blank" rel="noreferrer" title={event.title}>
            <span data-severity={event.severity} />
            <strong>{event.type.replaceAll("_", " ")}</strong>
            <em>{event.title}</em>
            <time dateTime={event.updatedAt}>{timeAgo(event.updatedAt, now)}</time>
          </a>
        )) : <span className={styles.empty}>Broad event feed initializing…</span>}
      </div>
      <button
        type="button"
        className={styles.feedToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "CLOSE" : "WORLD FEED"}
      </button>
      {expanded && (
        <div className={styles.drawer}>
          <header>
            <div>
              <small>GLOBAL EVENT STREAM</small>
              <strong>What is happening now?</strong>
            </div>
            <b>{filtered.length.toString().padStart(2, "0")}</b>
          </header>
          <nav aria-label="World feed categories">
            <button data-active={category === "all"} onClick={() => setCategory("all")}>All</button>
            {categories.map((item) => (
              <button
                key={item}
                data-active={category === item}
                onClick={() => setCategory(item)}
              >
                {label[item]}
              </button>
            ))}
          </nav>
          <div className={styles.feedList}>
            {filtered.slice(0, 40).map((event) => (
              <a key={event.id} href={event.source.url} target="_blank" rel="noreferrer">
                <span className={styles.feedDot} data-severity={event.severity} />
                <div>
                  <small>
                    {event.category.replaceAll("_", " ")} · {event.source.name}
                  </small>
                  <strong>{event.title}</strong>
                  <em>{event.description ?? event.type.replaceAll("_", " ")}</em>
                </div>
                <time dateTime={event.updatedAt}>{timeAgo(event.updatedAt, now)}</time>
              </a>
            ))}
            {!filtered.length && (
              <p className={styles.feedEmpty}>No active event in this category. Absence of an event does not imply complete global coverage.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
