import { getSignalInvestigation } from "@/server/context";
import { DataError } from "@/server/log";
import { modeFromParams } from "@/server/snapshot";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const mode = modeFromParams(new URL(request.url).searchParams);
    const investigation = await getSignalInvestigation(id, mode);
    return Response.json(investigation ?? { error: "not_found" }, {
      status: investigation ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof DataError ? error.code : "context_unavailable" },
      { status: error instanceof DataError ? 400 : 503 },
    );
  }
}
