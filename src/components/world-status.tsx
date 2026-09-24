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
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(timestamp)) / 60000),
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function WorldStatus({
  events,
  now = new Date(),
}: {
  events: WorldEvent[];
  now?: Date;
}) {
  const active = events.filter((event) => event.status === "active");
  const categories = [
    "natural_hazard",
    "climate",
    "environment",
    "infrastructure",
    "mobility",
  ] as const;
  const latest = [...active]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3);

  return (
    <section className={styles.status} aria-label="World event status">
      <div className={styles.summary}>
        <span className={styles.pulse} aria-hidden="true" />
        <strong>WORLD STATUS</strong>
        <b>{active.length}</b>
        <span>active events</span>
      </div>
      <div className={styles.counts}>
        {categories.map((category) => {
          const count = active.filter(
            (event) => event.category === category,
          ).length;
          if (!count) return null;
          return (
            <span key={category}>
              <b>{count}</b> {label[category]}
            </span>
          );
        })}
      </div>
      <div className={styles.latest}>
        {latest.length ? (
          latest.map((event) => (
            <a
              key={event.id}
              href={event.source.url}
              target="_blank"
              rel="noreferrer"
              title={event.title}
            >
              <span data-severity={event.severity} />
              <strong>{event.type.replaceAll("_", " ")}</strong>
              <em>{event.title}</em>
              <time dateTime={event.updatedAt}>
                {timeAgo(event.updatedAt, now)}
              </time>
            </a>
          ))
        ) : (
          <span className={styles.empty}>Broad event feed initializing…</span>
        )}
      </div>
    </section>
  );
}
