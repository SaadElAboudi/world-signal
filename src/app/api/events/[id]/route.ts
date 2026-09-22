import { getWorldEvent } from "@/server/world-events";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const event = await getWorldEvent(decodeURIComponent(id));
    return Response.json(event ?? { error: "not_found" }, {
      status: event ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "events_unavailable" }, { status: 503 });
  }
}
