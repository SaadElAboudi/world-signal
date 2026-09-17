import { getProviderHealth } from "@/server/health";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(
      { asOf: new Date().toISOString(), providers: await getProviderHealth() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error: "database_unavailable",
        providers: [
          { id: "usgs", status: "unavailable" },
          { id: "firms", status: "unavailable" },
        ],
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
