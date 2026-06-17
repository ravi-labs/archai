/**
 * Shared types for the ArchAI Reviewer engine.
 */

/** A single text file picked up by the scanner. */
export interface RepoFile {
  /** Path relative to the repo root, POSIX-style. */
  relPath: string;
  /** Lowercased extension including the dot (e.g. ".ts"), or "" if none. */
  ext: string;
  /** Size in bytes on disk. */
  size: number;
  /** File contents, truncated to the per-file cap. Empty for binary/oversized. */
  content: string;
  /** True when we read it as text (i.e. not binary, not over the hard cap). */
  isText: boolean;
}

/** Result of scanning a repo: the text files plus what we skipped. */
export interface ScanResult {
  root: string;
  files: RepoFile[];
  /** Count of entries skipped (binary, ignored, oversized) — for transparency. */
  skipped: number;
  /** Total bytes of text content retained. */
  textBytes: number;
}

/** What the detector infers about the repo's stack and shape. */
export interface StackInfo {
  languages: string[];
  frameworks: string[];
  /** Infrastructure-as-code signals found (terraform, cdk, k8s, compose, …). */
  iac: string[];
  /** Dependency/build manifests found, by relPath. */
  manifests: string[];
  /** Likely application entrypoints, by relPath. */
  entrypoints: string[];
  /** Datastore hints gleaned from deps/config (postgres, dynamodb, redis, …). */
  datastores: string[];
  hasDocker: boolean;
  hasCi: boolean;
}

/** A condensed, token-budgeted view of the repo handed to the LLM. */
export interface RepoDigest {
  root: string;
  stack: StackInfo;
  /** A rendered file tree (directories + files), bounded in size. */
  tree: string;
  /** Selected high-signal files, each as a labeled excerpt. */
  excerpts: { relPath: string; reason: string; text: string }[];
  /** Rough token estimate of the digest text. */
  approxTokens: number;
}

/** One diagram the LLM decided the review needs. */
export interface DiagramPlanItem {
  id: string;
  title: string;
  /** Diagram kind, e.g. "system-context", "deployment", "data-model". */
  kind: string;
  /** Which renderer/source to emit. */
  format: "drawio" | "mermaid";
  /** Why this diagram matters for the review (shown in the report). */
  rationale: string;
  /** Focused instruction the generator uses to draw it. */
  instruction: string;
}

export interface DiagramPlan {
  summary: string;
  diagrams: DiagramPlanItem[];
}

/** A generated diagram, ready to write to disk. */
export interface GeneratedDiagram extends DiagramPlanItem {
  /** The diagram source (drawio XML or Mermaid). */
  source: string;
  /** File name to write (e.g. "01-system-context.drawio"). */
  fileName: string;
  /** Populated if generation failed for this diagram. */
  error?: string;
}

export interface ReviewResult {
  digest: RepoDigest;
  plan: DiagramPlan;
  diagrams: GeneratedDiagram[];
}
