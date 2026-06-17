/**
 * Filesystem scanner: walk a repo, honor .gitignore, skip the usual noise and
 * binaries, and return text files within a byte budget. No network, no LLM —
 * just a clean, bounded view of what's on disk.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import ignoreImport, { type Ignore } from "ignore";

import type { RepoFile, ScanResult } from "./types.js";

// `ignore` ships as a CommonJS `export =` factory; normalize to a callable.
const ignore = ((ignoreImport as any).default ?? ignoreImport) as (...args: any[]) => Ignore;

/** Directories we never descend into, regardless of .gitignore. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  "vendor", "target", "bin", "obj", "__pycache__", ".venv", "venv", "env",
  ".idea", ".vscode", "coverage", ".gradle", ".terraform", ".serverless",
  ".turbo", ".cache", ".parcel-cache", "Pods", ".pytest_cache", ".mypy_cache",
]);

/** Extensions we treat as binary/uninteresting and never read. */
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf", ".zip",
  ".gz", ".tar", ".tgz", ".bz2", ".7z", ".rar", ".mp4", ".mov", ".avi", ".mp3",
  ".wav", ".woff", ".woff2", ".ttf", ".eot", ".otf", ".class", ".jar", ".war",
  ".so", ".dylib", ".dll", ".exe", ".bin", ".wasm", ".node", ".pyc", ".lock",
  ".min.js", ".min.css", ".map", ".heic", ".psd", ".sketch",
]);

/** Lockfiles: present-but-not-read (their existence is a signal, contents aren't). */
const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
  "Gemfile.lock", "composer.lock", "Cargo.lock", "go.sum",
]);

/** Read this much of any single file at most. */
const PER_FILE_CAP = 120 * 1024; // 120 KB
/** Stop retaining text once we cross this total. */
const TOTAL_TEXT_BUDGET = 6 * 1024 * 1024; // 6 MB

function isBinaryExt(name: string): boolean {
  const lower = name.toLowerCase();
  for (const ext of BINARY_EXT) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/** Heuristic: a NUL byte in the first chunk means binary. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

async function readGitignore(root: string): Promise<Ignore> {
  const ig = ignore();
  // Always ignore VCS/data dirs even if no .gitignore.
  ig.add([".git", "node_modules"]);
  try {
    const txt = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    ig.add(txt);
  } catch {
    /* no .gitignore — fine */
  }
  return ig;
}

export async function scanRepo(rootInput: string): Promise<ScanResult> {
  const root = path.resolve(rootInput);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const ig = await readGitignore(root);
  const files: RepoFile[] = [];
  let skipped = 0;
  let textBytes = 0;

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (!rel || rel.startsWith("..")) continue;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) { skipped++; continue; }
        if (ig.ignores(rel + "/")) { skipped++; continue; }
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (ig.ignores(rel)) { skipped++; continue; }

      const ext = path.extname(entry.name).toLowerCase();

      // Lockfiles & binaries: record presence (size only), don't read content.
      if (LOCKFILES.has(entry.name) || isBinaryExt(entry.name)) {
        let size = 0;
        try { size = (await fs.stat(abs)).size; } catch { /* ignore */ }
        files.push({ relPath: rel, ext, size, content: "", isText: false });
        skipped++;
        continue;
      }

      let size = 0;
      try { size = (await fs.stat(abs)).size; } catch { skipped++; continue; }

      if (textBytes >= TOTAL_TEXT_BUDGET) {
        files.push({ relPath: rel, ext, size, content: "", isText: false });
        continue;
      }

      try {
        const buf = await fs.readFile(abs);
        if (looksBinary(buf)) {
          files.push({ relPath: rel, ext, size, content: "", isText: false });
          skipped++;
          continue;
        }
        const text = buf.subarray(0, PER_FILE_CAP).toString("utf8");
        textBytes += Buffer.byteLength(text);
        files.push({ relPath: rel, ext, size, content: text, isText: true });
      } catch {
        skipped++;
      }
    }
  }

  await walk(root);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { root, files, skipped, textBytes };
}
