# ArchAI Reviewer

> Point it at a repo. It understands the code and generates the architecture-review
> diagrams that codebase actually needs — drawio + Mermaid. CLI **and** MCP server. BYOK.

This is the companion to the [ArchAI](../README.md) web app. Where the web app turns a
*description* into a diagram, the Reviewer turns a *whole repository* into the **set** of
diagrams an architecture review needs — and the LLM decides which diagrams that is, per repo
(a serverless API, a Kubernetes monolith, and a data pipeline each get a different set).

It does **real static analysis first** (scan, stack/IaC detection, a token-budgeted digest),
so the model reasons over an accurate, compact view of the code rather than a blind dump.

## How it works

```
scan  →  detect           →  digest            →  plan (LLM)        →  generate (LLM)   →  write
files    stack, IaC,          file tree +          "which diagrams      drawio/Mermaid       NN-*.drawio/.mmd
.gitignore  frameworks,        key-file excerpts     does THIS repo       per diagram          + REVIEW.md
binaries    datastores,        (budgeted)            need?"               (1 stricter retry)
skipped     entrypoints
```

Everything before `plan` is deterministic and runs with no API key. The drawio/Mermaid
prompts + extractors are shared with the web app (one source of truth, incl. truncation recovery).

## Install / build

```bash
npm install
npm run build
```

## CLI

```bash
# BYOK — set one provider:
export ANTHROPIC_API_KEY=sk-ant-…       # Anthropic direct (default claude-sonnet-4-6)
# or: export OPENAI_API_KEY=sk-…        # OpenAI-compatible (default gpt-4o-mini)

archai-review ./path/to/repo
# → writes ./path/to/repo/archai-review/  (diagram files + REVIEW.md)

archai-review ./repo --out ./review --concurrency 4
```

The key is read from the environment at call time and **never written to disk**.

### Providers

Unlike the web app (which can't reach AWS Bedrock directly because Bedrock's API
has no browser CORS), the Reviewer runs in **Node**, so it can call Bedrock natively.

**LiteLLM (your proxy):**
```bash
ARCHAI_BASE_URL=https://litellm.mycorp.com \
ARCHAI_MODEL=claude-3-5-sonnet \
OPENAI_API_KEY=$LITELLM_KEY \
archai-review ./repo
```

**AWS Bedrock (your account, direct — no proxy):**
```bash
ARCHAI_PROVIDER=bedrock \
AWS_REGION=us-east-1 \
ARCHAI_MODEL=anthropic.claude-3-5-sonnet-20241022-v2:0 \
archai-review ./repo
# AWS credentials come from the standard chain: AWS_ACCESS_KEY_ID/SECRET[/SESSION_TOKEN],
# ~/.aws/credentials, or an attached IAM role. Uses the Bedrock Converse API (SigV4).
# Model can be an inference-profile id too, e.g. us.anthropic.claude-3-5-sonnet-20241022-v2:0.
```

All overrides: `ARCHAI_PROVIDER` (`anthropic` | `openai-compat` | `bedrock`),
`ARCHAI_BASE_URL`, `ARCHAI_MODEL`, `ARCHAI_API_KEY`, `ARCHAI_AWS_REGION`.

## MCP server

Exposes the engine to agentic clients (Claude Code/Desktop, Cursor) so you can review a repo in-chat.

```bash
# Claude Code:
claude mcp add archai-reviewer -- node /absolute/path/to/reviewer/dist/mcp.js
```

For GUI clients, add to the client's MCP config (pass the key via the `env` block since GUI
apps don't inherit your shell):

```json
{
  "mcpServers": {
    "archai-reviewer": {
      "command": "node",
      "args": ["/absolute/path/to/reviewer/dist/mcp.js"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-…" }
    }
  }
}
```

### Tools

| Tool | What it does |
| --- | --- |
| `analyze_repo` | Detected stack + the diagram set the repo needs — **no generation** (fast, cheap preview). |
| `review_repo` | Full pipeline: generate every diagram and write the diagram files + `REVIEW.md`. |
| `generate_diagram` | One diagram from an instruction, optionally grounded in a repo's real component names. |

## Output

`REVIEW.md` indexes every diagram with its rationale. **Mermaid diagrams are embedded inline**,
so the review renders directly on GitHub. drawio diagrams are written as `.drawio` files you can
open in the [ArchAI web app](https://ravi-labs.github.io/archai/), the drawio desktop app, or the
drawio VS Code extension.

## Notes & limits

- **Big monorepos**: the digest is byte-budgeted (≈6 MB text, ~90 KB of excerpts), so very large
  repos are sampled by priority (manifests, IaC, entrypoints, schemas, docs first). Point it at a
  subdirectory for a focused review.
- **First draft, not gospel**: diagrams come from an LLM reading a digest — verify against reality.
- **Provider must allow your model's output length**; generation uses `max_tokens: 16000`.

## License

Apache-2.0, same as ArchAI.
