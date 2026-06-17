#!/usr/bin/env node
/**
 * ArchAI Reviewer — MCP server.
 *
 * Exposes the reviewer engine to agentic clients (Claude Code/Desktop, Cursor)
 * so they can turn a local repo into architecture-review diagrams in-chat.
 * BYOK: the LLM key is read from the server process environment, never stored.
 *
 * Tools:
 *   analyze_repo     — detected stack + the diagram set the repo needs (no generation; cheap)
 *   review_repo      — full pipeline: generate every diagram and write REVIEW.md
 *   generate_diagram — one diagram from an instruction, optionally grounded in a repo
 */

import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { scanRepo } from "./scan.js";
import { detectStack } from "./detect.js";
import { buildDigest, renderDigestForPrompt } from "./digest.js";
import { planDiagrams } from "./plan.js";
import { reviewRepo } from "./engine.js";
import { writeReview } from "./report.js";
import { resolveProvider, callLLM, describeProvider } from "./llm.js";
import { systemPromptFor, buildGenerateUserMessage } from "./prompts.js";
import { extractFor } from "./extract.js";
import type { DiagramPlanItem } from "./types.js";

const server = new McpServer({ name: "archai-reviewer", version: "0.1.0" });

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

server.tool(
  "analyze_repo",
  "Inspect a local code repository and report its detected stack plus the set of architecture-review diagrams it needs — WITHOUT generating them. Fast, cheap preview. Use this first to decide scope.",
  { repoPath: z.string().describe("Absolute path to the repository root on this machine.") },
  async ({ repoPath }) => {
    const provider = resolveProvider();
    const scan = await scanRepo(path.resolve(repoPath));
    const stack = detectStack(scan);
    const digest = buildDigest(scan, stack);
    const plan = await planDiagrams(provider, digest);
    const lines = [
      `Repo: ${scan.root}`,
      `Files scanned: ${scan.files.length} (${scan.skipped} skipped) · digest ~${digest.approxTokens.toLocaleString()} tokens`,
      `Languages: ${stack.languages.join(", ") || "?"}`,
      `Frameworks: ${stack.frameworks.join(", ") || "none"}`,
      `Infra-as-code: ${stack.iac.join(", ") || "none"}`,
      `Datastores: ${stack.datastores.join(", ") || "none"}`,
      "",
      plan.summary,
      "",
      "Proposed diagrams:",
      ...plan.diagrams.map((d, i) => `  ${i + 1}. [${d.format}] ${d.title} (${d.kind}) — ${d.rationale}`),
      "",
      "Run review_repo to generate them.",
    ];
    return text(lines.join("\n"));
  },
);

server.tool(
  "review_repo",
  "Full architecture review of a local repository: analyze the code, let the model decide which diagrams it needs, generate them (drawio + Mermaid), and write the diagram files + a REVIEW.md to disk. Returns the review summary and where files were written; Mermaid sources are included inline.",
  {
    repoPath: z.string().describe("Absolute path to the repository root on this machine."),
    outDir: z.string().optional().describe("Where to write outputs (default: <repoPath>/archai-review)."),
  },
  async ({ repoPath, outDir }) => {
    const root = path.resolve(repoPath);
    const out = outDir ? path.resolve(outDir) : path.join(root, "archai-review");
    const result = await reviewRepo(root);
    const w = await writeReview(out, result);

    const parts: string[] = [];
    parts.push(`Architecture review complete: ${w.written.length} diagram(s) written${w.failed ? `, ${w.failed} failed` : ""}.`);
    parts.push(`Output: ${out}  (index: REVIEW.md)`);
    parts.push("");
    parts.push(result.plan.summary);
    parts.push("");
    for (const d of result.diagrams) {
      parts.push(`### ${d.title} (${d.kind}, ${d.format})`);
      if (d.error) { parts.push(`  ⚠️ failed: ${d.error}`); continue; }
      parts.push(`  file: ${d.fileName}`);
      if (d.format === "mermaid") parts.push("```mermaid\n" + d.source + "\n```");
    }
    return text(parts.join("\n"));
  },
);

server.tool(
  "generate_diagram",
  "Generate a SINGLE architecture diagram from a natural-language instruction. If repoPath is given, the diagram is grounded in that repository's code; otherwise it's drawn from the instruction alone. Returns diagram source (drawio XML or Mermaid).",
  {
    instruction: z.string().describe("What to draw, e.g. 'the request lifecycle from API Gateway through the order service to DynamoDB'."),
    format: z.enum(["drawio", "mermaid"]).default("mermaid").describe("Output format. drawio for rich cloud/AWS topology; mermaid for sequence/ER/state/flow."),
    repoPath: z.string().optional().describe("Optional repo to ground the diagram in real component names."),
  },
  async ({ instruction, format, repoPath }) => {
    const provider = resolveProvider();
    const system = systemPromptFor(format);
    let user: string;
    if (repoPath) {
      const scan = await scanRepo(path.resolve(repoPath));
      const digest = buildDigest(scan, detectStack(scan));
      const item: DiagramPlanItem = {
        id: "adhoc", title: "Diagram", kind: "other", format, rationale: "", instruction,
      };
      user = buildGenerateUserMessage(item, renderDigestForPrompt(digest));
    } else {
      user = instruction;
    }
    const raw = await callLLM(provider, system, user);
    const source = extractFor(format, raw);
    return text(source);
  },
);

async function main(): Promise<void> {
  const provider = resolveProvider();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[archai-reviewer] MCP server running (stdio). Provider: ${describeProvider(provider)}`);
}

main().catch((err) => {
  console.error("[archai-reviewer] fatal:", err);
  process.exit(1);
});
