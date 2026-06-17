/**
 * The Reviewer engine: ties scan → detect → digest → plan → generate together.
 * Shared by both surfaces (CLI and MCP) so they behave identically.
 */

import { scanRepo } from "./scan.js";
import { detectStack } from "./detect.js";
import { buildDigest } from "./digest.js";
import { planDiagrams } from "./plan.js";
import { generateDiagram } from "./generate.js";
import { resolveProvider, type ProviderConfig } from "./llm.js";
import type { GeneratedDiagram, ReviewResult } from "./types.js";

export interface ReviewOptions {
  /** Override the auto-resolved provider config (e.g. from MCP args). */
  provider?: ProviderConfig;
  /** Max diagrams generated concurrently. */
  concurrency?: number;
  /** Progress hook for CLIs / streaming UIs. */
  onProgress?: (e: ProgressEvent) => void;
}

export type ProgressEvent =
  | { phase: "scan"; files: number; skipped: number }
  | { phase: "detect"; languages: string[]; iac: string[] }
  | { phase: "digest"; approxTokens: number }
  | { phase: "plan"; count: number; summary: string }
  | { phase: "generate"; done: number; total: number; title: string; ok: boolean };

/** Run tasks with a small concurrency cap, preserving input order in results. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function reviewRepo(repoPath: string, opts: ReviewOptions = {}): Promise<ReviewResult> {
  const provider = opts.provider ?? resolveProvider();
  const emit = opts.onProgress ?? (() => {});

  const scan = await scanRepo(repoPath);
  emit({ phase: "scan", files: scan.files.length, skipped: scan.skipped });

  const stack = detectStack(scan);
  emit({ phase: "detect", languages: stack.languages, iac: stack.iac });

  const digest = buildDigest(scan, stack);
  emit({ phase: "digest", approxTokens: digest.approxTokens });

  const plan = await planDiagrams(provider, digest);
  emit({ phase: "plan", count: plan.diagrams.length, summary: plan.summary });

  let done = 0;
  const diagrams = await mapLimit<typeof plan.diagrams[number], GeneratedDiagram>(
    plan.diagrams,
    Math.max(1, opts.concurrency ?? 3),
    async (item, i) => {
      const result = await generateDiagram(provider, item, digest, i);
      done++;
      emit({ phase: "generate", done, total: plan.diagrams.length, title: item.title, ok: !result.error });
      return result;
    },
  );

  return { digest, plan, diagrams };
}
