import { I18nProvider } from "@/i18n/context";
import { cookies } from "next/headers";
import Dashboard from "@/components/dashboard";
import { getSnapshot } from "@/server/snapshot";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; lang?: string }>;
}) {
  const { mode, lang } = await searchParams;
  const preferred =
    lang ?? (await cookies()).get("world-signal-language")?.value;
  const locale = preferred === "fr" ? "fr" : "en";
  const params = new URLSearchParams();
  if (mode === "demo" || mode === "live") params.set("mode", mode);
  const snapshot = await getSnapshot(params);
  return (
    <I18nProvider initialLocale={locale}>
      <Dashboard key={snapshot.mode} snapshot={snapshot} />
    </I18nProvider>
  );
}
