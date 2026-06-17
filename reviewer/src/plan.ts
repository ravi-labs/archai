/**
 * Planning stage: ask the LLM which diagrams this repo needs, and parse the
 * result into a validated DiagramPlan.
 */

import { callLLM, type ProviderConfig } from "./llm.js";
import { PLAN_SYSTEM_PROMPT, buildPlanUserMessage } from "./prompts.js";
import { renderDigestForPrompt } from "./digest.js";
import type { DiagramPlan, DiagramPlanItem, RepoDigest } from "./types.js";

/** Pull the first balanced JSON object out of a possibly-chatty response. */
function extractJsonObject(raw: string): string {
  let s = (raw || "").trim().replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Planner did not return JSON. First 200 chars: " + s.slice(0, 200));
  }
  return s.slice(start, end + 1);
}

function slug(s: string, fallback: string): string {
  const out = (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || fallback;
}

function coerceItem(raw: any, i: number): DiagramPlanItem | null {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title || raw.kind || `Diagram ${i + 1}`).trim();
  const instruction = String(raw.instruction || "").trim();
  if (!instruction) return null;
  const format = String(raw.format || "").toLowerCase() === "drawio" ? "drawio" : "mermaid";
  return {
    id: slug(raw.id || title, `diagram-${i + 1}`),
    title,
    kind: slug(raw.kind || "other", "other"),
    format,
    rationale: String(raw.rationale || "").trim(),
    instruction,
  };
}

export function parsePlan(raw: string): DiagramPlan {
  const obj = JSON.parse(extractJsonObject(raw)) as any;
  const items = Array.isArray(obj.diagrams) ? obj.diagrams : [];
  const diagrams: DiagramPlanItem[] = [];
  const seen = new Set<string>();
  items.forEach((it: any, i: number) => {
    const item = coerceItem(it, i);
    if (!item) return;
    // De-dupe ids.
    let id = item.id;
    let n = 2;
    while (seen.has(id)) id = `${item.id}-${n++}`;
    seen.add(id);
    diagrams.push({ ...item, id });
  });
  if (diagrams.length === 0) throw new Error("Planner returned no usable diagrams.");
  return { summary: String(obj.summary || "").trim(), diagrams };
}

export async function planDiagrams(config: ProviderConfig, digest: RepoDigest): Promise<DiagramPlan> {
  const digestText = renderDigestForPrompt(digest);
  const raw = await callLLM(config, PLAN_SYSTEM_PROMPT, buildPlanUserMessage(digestText));
  return parsePlan(raw);
}
