"use client";
import { useState } from "react";
import type { WorldSignal } from "@/core/types";
import type { Investigation } from "@/context/investigation";
import { useI18n } from "@/i18n/context";
import { Icon } from "./icon";
export function InvestigationPanel({ signal }: { signal: WorldSignal }) {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [data, setData] = useState<Investigation | null>(null);
  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (data) return;
    setState("loading");
    try {
      const r = await fetch(
        `/api/signals/${encodeURIComponent(signal.id)}/context?mode=${signal.provenance === "synthetic" ? "demo" : "live"}`,
        { signal: AbortSignal.timeout(20000) },
      );
      if (!r.ok) throw Error();
      setData(await r.json());
      setState("ready");
    } catch {
      setState("error");
    }
  }
  return (
    <>
      <button className="explain-button" onClick={toggle} aria-expanded={open}>
        <Icon name="info" />
        {open
          ? fr
            ? "Masquer l’enquête"
            : "Hide investigation"
          : fr
            ? "Examiner le contexte"
            : "Investigate context"}
        <Icon name="arrow" size={16} />
      </button>
      {open && (
        <div className="context-investigation" aria-live="polite">
          <p className="fineprint">
            {fr
              ? "Des sources externes pour éclairer les observations. Elles ne prouvent pas leur cause."
              : "External sources help investigate observations. They do not establish causality."}
          </p>
          {signal.provenance === "synthetic" && (
            <div className="context-note">
              <strong>
                {fr
                  ? "CONTEXTE ÉDITORIAL · PAS DE PREUVE COLLECTÉE"
                  : "EDITORIAL CONTEXT · NOT RETRIEVED EVIDENCE"}
              </strong>
              <p>
                {fr
                  ? "La recherche externe est désactivée dans la démonstration."
                  : "External retrieval is intentionally disabled in demo mode."}
              </p>
            </div>
          )}
          {state === "loading" && (
            <p>{fr ? "Recherche de contexte…" : "SEARCHING CONTEXT"}</p>
          )}
          {state === "error" && (
            <p role="status">
              {fr
                ? "Contexte indisponible. L’observation reste consultable ; réessayez en rouvrant ce panneau."
                : "CONTEXT TEMPORARILY UNAVAILABLE. The observation remains available; reopen this panel to retry."}
            </p>
          )}
          {data && (
            <>
              <div className="context-state">
                <strong>
                  {data.status === "context_found"
                    ? fr
                      ? "Sources de contexte trouvées"
                      : "POSSIBLE CONTEXT FOUND"
                    : data.status === "context_unavailable"
                      ? fr
                        ? "Sources de contexte indisponibles"
                        : "CONTEXT SOURCES UNAVAILABLE"
                      : fr
                        ? "Aucune explication établie pour le moment"
                        : "NO EXPLANATION FOUND YET"}
                </strong>
                <p>
                  {data.evidence.length}{" "}
                  {fr
                    ? "sources pertinentes. Les articles restent dans leur langue originale."
                    : "relevant sources. Articles retain their original language."}
                </p>
              </div>
              <div className="context-evidence-list">
                {data.evidence.map((item) => (
                  <a
                    className="context-evidence"
                    key={item.id}
                    href={item.source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>{item.source.name} ↗</strong>
                    <p>{item.text}</p>
                    <time>
                      {new Date(item.publishedAt).toLocaleString(
                        fr ? "fr-FR" : "en-GB",
                        { timeZone: "UTC" },
                      )}{" "}
                      UTC
                    </time>
                  </a>
                ))}
              </div>
              <details className="method-details">
                <summary>
                  {fr
                    ? "Chronologie et disponibilité des sources"
                    : "INVESTIGATION TIMELINE"}
                </summary>
                <ol className="event-timeline">
                  {data.timeline.map((entry, i) => (
                    <li key={i}>
                      <time>
                        {new Date(entry.timestamp).toLocaleString(
                          fr ? "fr-FR" : "en-GB",
                          { timeZone: "UTC" },
                        )}{" "}
                        UTC
                      </time>
                      <span>
                        {entry.kind === "signal"
                          ? fr
                            ? "Signal observé"
                            : "Observed signal"
                          : fr
                            ? "Publication externe"
                            : "External publication"}
                      </span>
                      <small>{entry.sourceName}</small>
                    </li>
                  ))}
                </ol>
                {data.providers.map((p) => (
                  <p key={p.providerId}>
                    {p.providerId} · {p.status}
                  </p>
                ))}
              </details>
            </>
          )}
        </div>
      )}
    </>
  );
}
