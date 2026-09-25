import { getStoryDetail } from "@/database/stories";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await getStoryDetail(id);
    return Response.json(detail ?? { error: "not_found" }, {
      status: detail ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "stories_unavailable" }, { status: 503 });
  }
}
