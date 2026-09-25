import { cookies } from "next/headers";
import { listStories } from "@/database/stories";
import { I18nProvider } from "@/i18n/context";
import { StoryList } from "@/components/story-list";

export const dynamic = "force-dynamic";

export default async function StoriesPage() {
  const [stories, cookieStore] = await Promise.all([listStories(), cookies()]);
  const locale = cookieStore.get("world-signal-language")?.value === "fr" ? "fr" : "en";
  return <I18nProvider initialLocale={locale}><StoryList stories={stories} /></I18nProvider>;
}
