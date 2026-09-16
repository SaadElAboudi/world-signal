import { demoProvider } from "@/providers/demo";
export async function GET() {
  return Response.json(await demoProvider.getSnapshot(), {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
