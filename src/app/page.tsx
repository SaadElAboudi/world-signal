import Dashboard from "@/components/dashboard";
import { getSnapshot } from "@/server/snapshot";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const params = new URLSearchParams();
  if (mode === "demo" || mode === "live") params.set("mode", mode);
  const snapshot = await getSnapshot(params);
  return <Dashboard key={snapshot.mode} snapshot={snapshot} />;
}
