import { getSignal, modeFromParams } from "@/server/snapshot";
import { DataError } from "@/server/log";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const signal = await getSignal(
      id,
      modeFromParams(new URL(request.url).searchParams),
    );
    return Response.json(signal ?? { error: "not_found" }, {
      status: signal ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof DataError ? error.code : "database_unavailable",
      },
      { status: error instanceof DataError ? 400 : 503 },
    );
  }
}
