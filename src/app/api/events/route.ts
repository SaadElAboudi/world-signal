import { queryWorldEvents } from "@/server/world-events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const events = await queryWorldEvents(new URL(request.url).searchParams);
    return Response.json(
      { asOf: new Date().toISOString(), events, total: events.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "events_unavailable" }, { status: 503 });
  }
}
