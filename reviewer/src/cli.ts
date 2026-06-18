#!/usr/bin/env node
/**
 * ArchAI Reviewer — CLI.
 *
 *   archai-review <path> [--out <dir>] [--concurrency N]
 *
 * Points at a repo, understands it, and writes the architecture-review diagrams
 * the codebase needs (drawio + Mermaid) plus a REVIEW.md index.
 */

import path from "node:path";

import { reviewRepo } from "./engine.js";
import { writeReview } from "./report.js";
import { resolveProvider, describeProvider } from "./llm.js";

const HELP = `ArchAI Reviewer — code → architecture-review diagrams (drawio + Mermaid)

Usage:
  archai-review <path-to-repo> [options]

Options:
  --out <dir>          Output directory (default: <repo>/archai-review)
  --concurrency <n>    Diagrams generated in parallel (default: 3)
  -h, --help           Show this help
  -v, --version        Print version

Provider (BYOK — set one):
  ANTHROPIC_API_KEY    Use Anthropic direct (default model claude-sonnet-4-6)
  OPENAI_API_KEY       Use OpenAI-compatible (default model gpt-4o-mini)
  LiteLLM              Set ARCHAI_BASE_URL to your proxy URL + ARCHAI_MODEL (uses the OpenAI-compatible path)
  AWS Bedrock          ARCHAI_PROVIDER=bedrock — calls your account directly via SigV4 (no proxy needed).
                       Creds: AWS_ACCESS_KEY_ID/SECRET (or ~/.aws, IAM role). Region: AWS_REGION. Model: ARCHAI_MODEL.
  ARCHAI_PROVIDER / ARCHAI_BASE_URL / ARCHAI_MODEL / ARCHAI_API_KEY  (overrides)

Examples:
  ANTHROPIC_API_KEY=sk-ant-… archai-review ./my-service
  ARCHAI_BASE_URL=https://litellm.mycorp.com ARCHAI_MODEL=claude-3-5-sonnet OPENAI_API_KEY=… archai-review ./svc
  ARCHAI_PROVIDER=bedrock AWS_REGION=us-east-1 ARCHAI_MODEL=anthropic.claude-3-5-sonnet-20241022-v2:0 archai-review ./svc`;

function parseArgs(argv: string[]) {
  const args = { path: "", out: "", concurrency: 3, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "-v" || a === "--version") args.version = true;
    else if (a === "--out") args.out = argv[++i] || "";
    else if (a === "--concurrency") args.concurrency = Math.max(1, parseInt(argv[++i] || "3", 10) || 3);
    else if (!a.startsWith("-") && !args.path) args.path = a;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    console.log(require("../package.json").version);
    return;
  }
  if (args.help || !args.path) {
    console.log(HELP);
    process.exit(args.path ? 0 : 1);
  }

  const repoPath = path.resolve(args.path);
  const outDir = args.out ? path.resolve(args.out) : path.join(repoPath, "archai-review");
  const provider = resolveProvider();

  if (provider.provider !== "bedrock" && !provider.apiKey) {
    console.error("✗ No API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or ARCHAI_PROVIDER=bedrock for AWS Bedrock (see --help).");
    process.exit(1);
  }

  console.error(`ArchAI Reviewer`);
  console.error(`  repo:     ${repoPath}`);
  console.error(`  provider: ${describeProvider(provider)}`);
  console.error("");

  const result = await reviewRepo(repoPath, {
    provider,
    concurrency: args.concurrency,
    onProgress: (e) => {
      switch (e.phase) {
        case "scan": console.error(`• scanned ${e.files} files (${e.skipped} skipped)`); break;
        case "detect": console.error(`• stack: ${e.languages.join(", ") || "?"}${e.iac.length ? ` · IaC: ${e.iac.join(", ")}` : ""}`); break;
        case "digest": console.error(`• digest ~${e.approxTokens.toLocaleString()} tokens`); break;
        case "plan": console.error(`• plan: ${e.count} diagrams\n  ${e.summary}`); break;
        case "generate": console.error(`  ${e.ok ? "✓" : "✗"} [${e.done}/${e.total}] ${e.title}`); break;
      }
    },
  });

  const w = await writeReview(outDir, result);
  console.error("");
  console.error(`✅ Wrote ${w.written.length} diagram(s)${w.failed ? ` (${w.failed} failed)` : ""} + REVIEW.md`);
  console.error(`   → ${w.reviewPath}`);
}

main().catch((err) => {
  console.error("✗ " + (err?.message || err));
  process.exit(1);
});
