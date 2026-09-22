import Dashboard from "@/components/dashboard";
import { WorldStatus } from "@/components/world-status";
import { listWorldEvents } from "@/database/world-events";
import type { WorldEvent } from "@/events/types";
import { getSnapshot } from "@/server/snapshot";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const params = new URLSearchParams();
  if (mode === "demo" || mode === "live") params.set("mode", mode);
  const snapshot = await getSnapshot(params);
  let events: WorldEvent[] = [];
  if (snapshot.mode === "live") {
    try {
      events = await listWorldEvents({ status: "active", limit: 500 });
    } catch {
      // Event coverage is additive. A missing migration/provider must never make
      // the established signal observatory unavailable.
      events = [];
    }
  }
  return (
    <>
      {snapshot.mode === "live" && <WorldStatus events={events} />}
      <Dashboard key={snapshot.mode} snapshot={snapshot} />
    </>
  );
}
