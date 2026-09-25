import { getPool } from "./client";
import { getPersistedInvestigation } from "./investigations";
import { storyFromCorrelation } from "../stories/engine";
import type { Story } from "../stories/types";
import type { CorrelatedEvent } from "../correlations/types";
import type { WorldSignal } from "../core/types";
import type { Investigation } from "../context/investigation";

export interface StoryDetail {
  story: Story;
  correlation: CorrelatedEvent;
  signals: WorldSignal[];
  investigation: Investigation | null;
}

export async function synchronizeStories(now = new Date()) {
  const client = await getPool().connect();
  try {
    const correlations = await client.query("SELECT payload FROM correlated_events WHERE window_end >= $1", [new Date(now.getTime() - 7 * 86400000)]);
    await client.query(
      `DELETE FROM stories s USING correlated_events c
       WHERE s.correlation_id=c.id AND c.payload->>'storyEligible'='false'`,
    );
    let saved = 0;
    for (const row of correlations.rows) {
      const correlation = row.payload as CorrelatedEvent;
      // v3 correlations must clear the cluster threshold before becoming a
      // human-facing Story. Older rows remain readable until recomputed.
      if (correlation.storyEligible === false) continue;
      // Reuse the synchronization connection. The production collector has a
      // deliberately small pool, so asking the pool for a nested connection
      // here can starve Context refreshes under load.
      const context = await client.query(
        "SELECT investigation FROM context_investigations WHERE subject_type='correlated_event' AND subject_id=$1",
        [correlation.id],
      );
      const investigation = (context.rows[0]?.investigation as Investigation | undefined) ?? null;
      const story = storyFromCorrelation(correlation, investigation, now);
      await client.query(
        `INSERT INTO stories(id,correlation_id,fingerprint,status,explanation_status,started_at,updated_at,resolved_at,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT(correlation_id) DO UPDATE SET status=EXCLUDED.status,explanation_status=EXCLUDED.explanation_status,updated_at=EXCLUDED.updated_at,resolved_at=EXCLUDED.resolved_at,payload=EXCLUDED.payload`,
        [story.id, story.correlationId, story.fingerprint, story.status, story.explanationStatus, story.startedAt, story.updatedAt, story.resolvedAt, JSON.stringify(story)],
      );
      await client.query("DELETE FROM story_members WHERE story_id=$1 AND NOT(signal_id=ANY($2::text[]))", [story.id, story.signalIds]);
      for (const signalId of story.signalIds)
        await client.query("INSERT INTO story_members(story_id,signal_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [story.id, signalId]);
      saved += 1;
    }
    return { saved };
  } finally {
    client.release();
  }
}

export async function listStories(limit = 20): Promise<Story[]> {
  const result = await getPool().query("SELECT payload FROM stories WHERE status<>'resolved' ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'corroborated' THEN 1 WHEN 'developing' THEN 2 WHEN 'detected' THEN 3 WHEN 'unexplained' THEN 4 ELSE 5 END, updated_at DESC LIMIT $1", [Math.max(1, Math.min(100, limit))]);
  return result.rows.map((row) => row.payload as Story);
}

export async function getStoryDetail(id: string): Promise<StoryDetail | null> {
  const result = await getPool().query("SELECT s.payload AS story,c.payload AS correlation FROM stories s JOIN correlated_events c ON c.id=s.correlation_id WHERE s.id=$1", [id]);
  if (!result.rowCount) return null;
  const story = result.rows[0].story as Story;
  const correlation = result.rows[0].correlation as CorrelatedEvent;
  const signals = (await getPool().query("SELECT payload FROM signals WHERE id=ANY($1::text[])", [story.signalIds])).rows.map((row) => row.payload as WorldSignal);
  const investigation = await getPersistedInvestigation("correlated_event", story.correlationId, { allowStale: true });
  return { story, correlation, signals, investigation };
}
