import { listStories } from "@/database/stories";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const stories = await listStories(rawLimit);
    return Response.json({ asOf: new Date().toISOString(), stories, total: stories.length }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "stories_unavailable" }, { status: 503 });
  }
}
