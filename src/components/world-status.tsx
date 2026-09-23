import type { WorldEvent } from "@/events/types";
import styles from "./world-status.module.css";

const label: Record<string, string> = {
  natural_hazard: "Natural",
  climate: "Climate",
  environment: "Environment",
  infrastructure: "Infrastructure",
  mobility: "Mobility",
  earth_observation: "Earth obs.",
};

function timeAgo(timestamp: string, now: Date) {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(timestamp)) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function WorldStatus({ events, now = new Date() }: { events: WorldEvent[]; now?: Date }) {
  const active = events.filter((event) => event.status === "active");
  const significant = active.filter((event) => event.severity === "significant").length;
  const categories = ["natural_hazard", "climate", "environment", "infrastructure", "mobility"] as const;
  const latest = [...active]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 4);

  return (
    <section className={styles.status} aria-label="World event status and feed">
      <div className={styles.summary}>
        <span className={styles.pulse} aria-hidden="true" />
        <strong>WORLD STATUS</strong>
        <b>{active.length}</b>
        <span>active</span>
        {significant > 0 && <em>{significant} significant</em>}
      </div>
      <div className={styles.counts}>
        {categories.map((category) => {
          const count = active.filter((event) => event.category === category).length;
          if (!count) return null;
          return <span key={category}><b>{count}</b> {label[category]}</span>;
        })}
      </div>
      <div className={styles.feed} aria-label="Latest world events">
        <span className={styles.feedLabel}>WORLD FEED</span>
        <div className={styles.latest}>
          {latest.length ? latest.map((event) => (
            <a key={event.id} href={event.source.url} target="_blank" rel="noreferrer" title={`${event.title} · ${event.source.name}`}>
              <span data-severity={event.severity} />
              <strong>{label[event.category] ?? event.category}</strong>
              <em>{event.title}</em>
              <time dateTime={event.updatedAt}>{timeAgo(event.updatedAt, now)}</time>
            </a>
          )) : <span className={styles.empty}>Event coverage initializing…</span>}
        </div>
      </div>
    </section>
  );
}
