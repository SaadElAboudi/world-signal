import { I18nProvider } from "@/i18n/context";
import { cookies } from "next/headers";
import Dashboard from "@/components/dashboard";
import { listWorldEvents } from "@/database/world-events";
import { listStories } from "@/database/stories";
import type { WorldEvent } from "@/events/types";
import type { Story } from "@/stories/types";
import { getSnapshot } from "@/server/snapshot";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; lang?: string }>;
}) {
  const { mode, lang } = await searchParams;
  const preferred =
    lang ?? (await cookies()).get("world-signal-language")?.value;
  const locale = preferred === "fr" ? "fr" : "en";
  const params = new URLSearchParams();
  if (mode === "demo" || mode === "live") params.set("mode", mode);
  const snapshot = await getSnapshot(params);
  let events: WorldEvent[] = [];
  let stories: Story[] = [];
  let eventsAvailable = snapshot.mode === "demo";
  if (snapshot.mode === "live") {
    try {
      events = await listWorldEvents({ status: "active", limit: 500 });
      stories = await listStories(6);
      eventsAvailable = true;
    } catch {
      eventsAvailable = false;
    }
  }
  return (
    <I18nProvider initialLocale={locale}>
      <Dashboard
        key={snapshot.mode}
        snapshot={snapshot}
        initialEvents={events}
        initialEventsAvailable={eventsAvailable}
        initialStories={stories}
      />
    </I18nProvider>
  );
}
