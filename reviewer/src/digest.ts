/**
 * Build a token-budgeted digest of the repo: a bounded file tree plus excerpts
 * of the highest-signal files (manifests, IaC, entrypoints, schemas, docs). This
 * is the single artifact the LLM reasons over, so it must be small but faithful.
 */

import type { RepoFile, RepoDigest, ScanResult, StackInfo } from "./types.js";

/** Roughly 4 chars per token — good enough for budgeting. */
const approxTokens = (s: string): number => Math.ceil(s.length / 4);

/** Total excerpt budget in characters (~ keeps a digest near 20–25k tokens). */
const EXCERPT_CHAR_BUDGET = 90 * 1024;
const PER_EXCERPT_CHARS = 8 * 1024;
const TREE_MAX_LINES = 400;

/** Render a compact indented tree from a flat, sorted file list. */
function renderTree(files: RepoFile[]): string {
  const lines: string[] = [];
  let shown = 0;
  let lastDirs: string[] = [];
  for (const f of files) {
    const parts = f.relPath.split("/");
    const dirs = parts.slice(0, -1);
    // Emit any new directory levels.
    for (let i = 0; i < dirs.length; i++) {
      if (lastDirs[i] !== dirs[i]) {
        if (shown++ < TREE_MAX_LINES) lines.push("  ".repeat(i) + dirs[i] + "/");
        lastDirs = dirs.slice(0, i + 1);
      }
    }
    lastDirs = dirs;
    if (shown++ < TREE_MAX_LINES) {
      lines.push("  ".repeat(dirs.length) + parts[parts.length - 1]);
    }
  }
  if (shown > TREE_MAX_LINES) lines.push(`… (${shown - TREE_MAX_LINES} more entries omitted)`);
  return lines.join("\n");
}

/** Score a file for excerpt priority — higher is more worth showing. */
function priority(f: RepoFile, stack: StackInfo): number {
  const base = f.relPath.split("/").pop() || "";
  const lower = f.relPath.toLowerCase();
  if (stack.manifests.includes(f.relPath)) return 100;
  if (f.ext === ".tf" || base === "cdk.json" || base === "serverless.yml" || base === "template.yaml") return 95;
  if (base === "docker-compose.yml" || base === "docker-compose.yaml" || base === "compose.yaml") return 92;
  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return 88;
  if (/\bkind:\s*(Deployment|Service|StatefulSet|Ingress)\b/.test(f.content)) return 86;
  if (stack.entrypoints.includes(f.relPath)) return 84;
  if (/(schema|model|entity|entities|migration)/.test(lower) && /\.(ts|js|py|go|rb|sql|prisma)$/.test(f.relPath)) return 80;
  if (base.toLowerCase().startsWith("readme")) return 75;
  if (/(^|\/)(routes?|controllers?|handlers?|api)(\/|\.)/.test(lower)) return 60;
  if (/(config|settings)/.test(lower)) return 45;
  if (f.ext === ".md") return 30;
  return 10;
}

function reasonFor(f: RepoFile, stack: StackInfo): string {
  const base = f.relPath.split("/").pop() || "";
  if (stack.manifests.includes(f.relPath)) return "dependency manifest";
  if (f.ext === ".tf" || base === "cdk.json") return "infrastructure-as-code";
  if (base.startsWith("Dockerfile") || base.includes("compose")) return "container/runtime config";
  if (stack.entrypoints.includes(f.relPath)) return "application entrypoint";
  if (/schema|model|entity|migration/i.test(f.relPath)) return "data model / schema";
  if (base.toLowerCase().startsWith("readme")) return "project documentation";
  return "high-signal source";
}

export function buildDigest(scan: ScanResult, stack: StackInfo): RepoDigest {
  const textFiles = scan.files.filter((f) => f.isText && f.content.trim().length > 0);

  const ranked = textFiles
    .map((f) => ({ f, score: priority(f, stack) }))
    .sort((a, b) => b.score - a.score || a.f.relPath.localeCompare(b.f.relPath));

  const excerpts: RepoDigest["excerpts"] = [];
  let used = 0;
  for (const { f } of ranked) {
    if (used >= EXCERPT_CHAR_BUDGET) break;
    const remaining = EXCERPT_CHAR_BUDGET - used;
    const slice = f.content.slice(0, Math.min(PER_EXCERPT_CHARS, remaining));
    if (slice.trim().length === 0) continue;
    const text = slice.length < f.content.length ? slice + "\n… (truncated)" : slice;
    excerpts.push({ relPath: f.relPath, reason: reasonFor(f, stack), text });
    used += text.length;
  }

  const tree = renderTree(scan.files.filter((f) => f.isText || f.size > 0));
  const digestText = tree + excerpts.map((e) => e.text).join("\n");

  return {
    root: scan.root,
    stack,
    tree,
    excerpts,
    approxTokens: approxTokens(digestText),
  };
}

/** Serialize a digest into the prompt block the LLM reads. */
export function renderDigestForPrompt(d: RepoDigest): string {
  const s = d.stack;
  const head = [
    `REPO ROOT: ${d.root.split("/").pop()}`,
    `LANGUAGES: ${s.languages.join(", ") || "unknown"}`,
    `FRAMEWORKS: ${s.frameworks.join(", ") || "none detected"}`,
    `INFRA-AS-CODE: ${s.iac.join(", ") || "none detected"}`,
    `DATASTORES: ${s.datastores.join(", ") || "none detected"}`,
    `ENTRYPOINTS: ${s.entrypoints.join(", ") || "unknown"}`,
    `DOCKER: ${s.hasDocker ? "yes" : "no"}   CI: ${s.hasCi ? "yes" : "no"}`,
  ].join("\n");

  const tree = `FILE TREE:\n${d.tree}`;
  const files = d.excerpts
    .map((e) => `--- FILE: ${e.relPath}  (${e.reason}) ---\n${e.text}`)
    .join("\n\n");

  return `${head}\n\n${tree}\n\nKEY FILES:\n\n${files}`;
}
