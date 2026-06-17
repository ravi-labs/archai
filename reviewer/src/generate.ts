/**
 * Generation stage: draw one planned diagram, grounded in the repo digest, with
 * a single stricter retry if the first response doesn't parse.
 */

import { callLLM, type ProviderConfig } from "./llm.js";
import { extractFor } from "./extract.js";
import { systemPromptFor, buildGenerateUserMessage } from "./prompts.js";
import { renderDigestForPrompt } from "./digest.js";
import type { DiagramPlanItem, GeneratedDiagram, RepoDigest } from "./types.js";

function fileNameFor(item: DiagramPlanItem, index: number): string {
  const n = String(index + 1).padStart(2, "0");
  const ext = item.format === "drawio" ? "drawio" : "mmd";
  return `${n}-${item.id}.${ext}`;
}

export async function generateDiagram(
  config: ProviderConfig,
  item: DiagramPlanItem,
  digest: RepoDigest,
  index: number,
): Promise<GeneratedDiagram> {
  const fileName = fileNameFor(item, index);
  const system = systemPromptFor(item.format);
  const digestText = renderDigestForPrompt(digest);
  const userMsg = buildGenerateUserMessage(item, digestText);

  try {
    const raw = await callLLM(config, system, userMsg);
    try {
      const source = extractFor(item.format, raw);
      return { ...item, source, fileName };
    } catch (firstErr) {
      // One stricter retry, feeding the parse error back.
      const retryMsg =
        userMsg +
        `\n\nYOUR PREVIOUS OUTPUT FAILED TO PARSE: ${(firstErr as Error).message}\n` +
        `Return ONLY valid ${item.format === "drawio" ? "drawio XML starting with <mxfile" : "Mermaid source starting with a valid header"}. No commentary, no fences.`;
      const raw2 = await callLLM(config, system, retryMsg);
      const source = extractFor(item.format, raw2);
      return { ...item, source, fileName };
    }
  } catch (err) {
    return { ...item, source: "", fileName, error: (err as Error).message };
  }
}
