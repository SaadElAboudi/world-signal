import { cookies } from "next/headers";
import { I18nProvider } from "@/i18n/context";
import { StoryLoader } from "@/components/story-detail";

export const dynamic = "force-dynamic";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = (await cookies()).get("world-signal-language")?.value === "fr" ? "fr" : "en";
  return <I18nProvider initialLocale={locale}><StoryLoader id={id} /></I18nProvider>;
}
