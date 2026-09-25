import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getStoryDetail } from "@/database/stories";
import { I18nProvider } from "@/i18n/context";
import { StoryDetail } from "@/components/story-detail";

export const dynamic = "force-dynamic";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getStoryDetail(id);
  if (!detail) notFound();
  const locale = (await cookies()).get("world-signal-language")?.value === "fr" ? "fr" : "en";
  return <I18nProvider initialLocale={locale}><StoryDetail detail={detail} /></I18nProvider>;
}
