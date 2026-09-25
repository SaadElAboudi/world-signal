"use client";

import Link from "next/link";
import type { Story } from "@/stories/types";
import { useI18n } from "@/i18n/context";

export function StoryList({ stories }: { stories: Story[] }) {
  const { locale, countryName } = useI18n();
  const fr = locale === "fr";
  return <main className="story-page"><header className="story-topbar"><Link className="brand" href="/"><span className="brand-symbol">◉</span><span>WORLD<span className="brand-light"> SIGNAL</span></span></Link><Link className="story-back" href="/">← {fr ? "Retour au monde" : "Back to world"}</Link></header><section className="story-article"><p className="world-now-kicker">{fr ? "SITUATIONS EN COURS" : "DEVELOPING SITUATIONS"}</p><h1>{fr ? "Stories mondiales" : "World stories"}</h1><p className="story-lead">{fr ? "Des signaux indépendants regroupés pour suivre une situation, sans en inventer la cause." : "Independent signals grouped to follow a situation, without inventing a cause."}</p><div className="story-list">{stories.map((story) => <Link key={story.id} href={`/stories/${encodeURIComponent(story.id)}`}><p>{countryName(story.location.country ?? "Offshore / unassigned")}</p><h2>{story.title}</h2><span className={`story-status story-status-${story.status}`}>{story.status === "unexplained" ? (fr ? "Aucune explication trouvée pour le moment" : "No explanation found yet") : story.status}</span><small>{story.signalTypes.join(" + ")} · {Math.round(story.confidence * 100)}% {fr ? "confiance des données" : "data confidence"}</small></Link>)}{!stories.length && <p>{fr ? "Aucune Story active pour le moment." : "No active Story at the moment."}</p>}</div></section></main>;
}
