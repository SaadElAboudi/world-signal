"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StoryDetail as StoryDetailData } from "@/database/stories";
import { useI18n } from "@/i18n/context";

const statusCopy = {
  detected: ["Detected", "Détectée"],
  developing: ["Developing", "En cours"],
  corroborated: ["Corroborated", "Recoupée"],
  confirmed: ["Confirmed", "Confirmée"],
  unexplained: ["No explanation found yet", "Aucune explication trouvée pour le moment"],
  resolved: ["Resolved", "Résolue"],
} as const;

export function StoryDetail({ detail }: { detail: StoryDetailData }) {
  const { locale, countryName } = useI18n();
  const fr = locale === "fr";
  const copy = (value: readonly [string, string]) => value[fr ? 1 : 0];
  const { story, signals, investigation } = detail;
  const date = (value: string) => new Date(value).toLocaleString(fr ? "fr-FR" : "en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const timeline = investigation?.timeline ?? signals.map((signal) => ({
    timestamp: signal.startedAt ?? signal.timestamp,
    kind: "signal" as const,
    label: `${signal.type} anomaly detected`,
    signalId: signal.id,
  }));
  return <main className="story-page">
    <header className="story-topbar"><Link className="brand" href="/"><span className="brand-symbol">◉</span><span>WORLD<span className="brand-light"> SIGNAL</span></span></Link><Link className="story-back" href="/">← {fr ? "Retour au monde" : "Back to world"}</Link></header>
    <article className="story-article">
      <p className={`story-status story-status-${story.status}`}>{copy(statusCopy[story.status])}</p>
      <p className="story-place">{countryName(story.location.country ?? "Offshore / unassigned")}</p>
      <h1>{story.title}</h1>
      <p className="story-lead">{story.signalTypes.length} {fr ? "signaux indépendants observés dans la même zone." : "independent signals observed in the same area."}</p>
      <section className="story-summary">
        <div><span>{fr ? "DÉBUT DE L’OBSERVATION" : "FIRST OBSERVATION"}</span><strong>{date(story.startedAt)} UTC</strong></div>
        <div><span>{fr ? "CONFIANCE DES DONNÉES" : "DATA CONFIDENCE"}</span><strong>{Math.round(story.confidence * 100)}%</strong></div>
        <div><span>{fr ? "FORCE DU REGROUPEMENT" : "CLUSTER STRENGTH"}</span><strong>{Math.round(story.correlationStrength * 100)}%</strong></div>
        {detail.correlation.clusterScore !== undefined && <div><span>{fr ? "PRIORITÉ" : "PRIORITY"}</span><strong>{Math.round(detail.correlation.clusterScore * 100)}%</strong></div>}
      </section>
      <section className="story-section story-assessment">
        <h2>{fr ? "Évaluation actuelle" : "Current assessment"}</h2>
        {story.explanationStatus === "unexplained" ? <><h3>{fr ? "AUCUNE EXPLICATION TROUVÉE POUR LE MOMENT" : "NO EXPLANATION FOUND YET"}</h3><p>{fr ? "Les sources de contexte interrogées n’ont pas fourni d’explication suffisamment pertinente. Cela ne signifie pas qu’il n’en existe pas." : "The searched context sources did not return a sufficiently relevant explanation. This does not mean no explanation exists."}</p></> : story.explanationStatus === "unavailable" ? <p>{fr ? "La recherche de contexte est momentanément indisponible. Cette Story reste en cours d’évaluation." : "Context retrieval is temporarily unavailable. This Story remains under assessment."}</p> : story.explanationStatus === "pending" ? <p>{fr ? "Les observations ont été regroupées. La recherche de contexte n’a pas encore été exécutée." : "The observations have been grouped. Context retrieval has not run yet."}</p> : <p>{fr ? "Du contexte pertinent a été identifié. Les sources sont listées ci-dessous ; aucune causalité n’est déduite de ce rapprochement." : "Relevant context was identified. Sources are listed below; no causal relationship is inferred from this grouping."}</p>}
      </section>
      <section className="story-section"><h2>{fr ? "Chronologie" : "Timeline"}</h2><ol className="story-timeline">{timeline.map((entry, index) => <li key={`${entry.timestamp}:${index}`}><time>{date(entry.timestamp)} UTC</time><strong>{entry.kind === "context" ? (fr ? "Contexte publié" : "Context published") : (fr ? "Signal détecté" : "Signal detected")}</strong><span>{entry.kind === "context" ? entry.sourceName ?? entry.label : entry.label}</span></li>)}</ol></section>
      <section className="story-section"><h2>{fr ? "Signaux observés" : "Observed signals"}</h2><div className="story-signal-list">{signals.map((signal) => <Link key={signal.id} href={`/?mode=live`}><span>{signal.type}</span><strong>{signal.source.name}</strong><small>{date(signal.startedAt ?? signal.timestamp)} UTC</small></Link>)}</div></section>
      <section className="story-section"><h2>{fr ? "Éléments de contexte" : "Context evidence"}</h2>{investigation?.evidence.length ? <div className="story-evidence">{investigation.evidence.map((item) => <a key={item.id} href={item.source.url} target="_blank" rel="noreferrer"><strong>{item.source.name}</strong><span>{item.text}</span><small>{date(item.publishedAt)} UTC</small></a>)}</div> : <p>{fr ? "Aucun élément de contexte suffisamment pertinent n’est disponible." : "No sufficiently relevant context evidence is available."}</p>}</section>
      <p className="story-caveat">{fr ? "La proximité géographique ou temporelle de signaux ne prouve ni une cause, ni un impact. Les données peuvent être incomplètes ou retardées." : "Geographic or temporal proximity between signals does not prove cause or impact. Data may be incomplete or delayed."}</p>
    </article>
  </main>;
}

export function StoryLoader({ id }: { id: string }) {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [detail, setDetail] = useState<StoryDetailData | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/stories/${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) { setState("missing"); return null; }
        if (!response.ok) throw new Error("story_unavailable");
        return response.json() as Promise<StoryDetailData>;
      })
      .then((result) => { if (result) { setDetail(result); setState("loading"); } })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [id]);
  if (detail) return <StoryDetail detail={detail} />;
  const message = state === "loading"
    ? (fr ? "Chargement de la Story…" : "Loading Story…")
    : state === "missing"
      ? (fr ? "Cette Story n’est plus disponible." : "This Story is no longer available.")
      : (fr ? "La Story est momentanément indisponible." : "This Story is temporarily unavailable.");
  return <main className="story-page"><header className="story-topbar"><Link className="brand" href="/"><span className="brand-symbol">◉</span><span>WORLD<span className="brand-light"> SIGNAL</span></span></Link></header><section className="story-loader"><p>{message}</p><Link href="/stories">{fr ? "Voir les Stories actives" : "View active stories"}</Link></section></main>;
}
