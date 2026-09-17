import { getSnapshot } from "@/server/snapshot";
import { DataError } from "@/server/log";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const snapshot = await getSnapshot(new URL(request.url).searchParams);
    return Response.json(snapshot, {
      status: snapshot.status === "unavailable" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof DataError ? error.code : "configuration_error",
      },
      { status: error instanceof DataError ? 400 : 503 },
    );
  }
}
