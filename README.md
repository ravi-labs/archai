# ArchAI

> Plain-English → editable architecture diagrams. drawio + Mermaid. Free, BYOK, no signup.

ArchAI is a single-page web app that turns a description of a system into a working diagram. Pick a format — **drawio** (with the full AWS4 icon library, editable in the embedded drawio editor) or **Mermaid** (rendered client-side, with real AWS icons via `architecture-beta`).

You can also load an existing `.drawio` or `.mmd` file and ask the AI to refine it: "now add a CloudFront in front of the ALB," "swap RDS for Aurora," "add the refresh-token flow."

No accounts. No backend. No telemetry. Your API key never leaves your browser.

## Quick start

1. Open `archai.html` in any modern browser, or host the file on GitHub Pages / Vercel / anywhere static (see [Deploy](#deploy)).
2. In **section 3 (LLM provider)**, pick a provider and paste your key.
3. In **section 1**, pick a diagram format (drawio or Mermaid), describe a system, click **Generate fresh diagram**.
4. Edit visually (drawio) or refine with another prompt: type a change, click **Refine current diagram**.

Keyboard: `Ctrl/Cmd+Enter` generates fresh. `Shift+Ctrl/Cmd+Enter` refines (when a diagram is loaded).

## Formats

### drawio — recommended for AWS / multi-cloud architecture

- Generates `<mxfile>` XML using the full AWS4 shape library.
- Loads into an embedded drawio editor; full visual editing, free-form layout, export to PNG/SVG/PDF.
- Best when you'll keep iterating in drawio after the AI does the first draft.

### Mermaid — quick architecture or non-AWS diagrams

- Generates Mermaid source rendered client-side.
- **AWS architectures** use Mermaid's `architecture-beta` with real AWS icons (logos:aws-ec2, logos:aws-rds, etc.) loaded from the Iconify CDN.
- Other diagram types: flowchart, sequence, ER, state-v2, class, timeline, gantt, journey.
- Refine flow is text-only — you re-prompt and the diagram re-renders. There's no in-browser visual editor for Mermaid.

Switch formats with the dropdown in section 1. Each format remembers its own example prompts and accepts its own file types in section 2.

## Supported LLM providers

ArchAI talks one of three shapes; you choose which in the UI.

### OpenAI-compatible (default — recommended)

Works with anything that exposes an OpenAI-style `/chat/completions` endpoint. That's a *lot* of things:

- **OpenAI** — base URL `https://api.openai.com/v1`, model e.g. `gpt-4o-mini` or `gpt-4o`.
- **Azure OpenAI** — base URL is your deployment URL, model is your deployment name.
- **LiteLLM proxy** — base URL `http://localhost:4000` (or wherever you run it), model whatever you configured. Recommended bridge to Bedrock, Vertex AI, on-prem models, etc.
- **Ollama** — base URL `http://localhost:11434/v1`, model e.g. `llama3.1:70b`. (You may need `OLLAMA_ORIGINS=*` to allow browser CORS.)
- **LM Studio / vLLM / Groq / Together / Fireworks / DeepInfra** — all OpenAI-compatible.

### Anthropic (direct)

Base URL `https://api.anthropic.com`, model e.g. `claude-sonnet-4-6`. Uses the `anthropic-dangerous-direct-browser-access` header so calls work from a browser. Get a key at console.anthropic.com.

### AWS Bedrock (via LiteLLM proxy)

The MVP path is **LiteLLM as a proxy**. This avoids implementing AWS SigV4 in the browser, keeps your AWS credentials off the page, and gives you the full LiteLLM model catalog for free.

```bash
# install LiteLLM
pip install 'litellm[proxy]'

# set AWS creds however you normally do (env, ~/.aws/credentials, IAM role)
export AWS_REGION=us-east-1

# start the proxy
litellm --model bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0
# proxy is now at http://localhost:4000
```

Then in ArchAI: provider = "OpenAI-compatible", base URL = `http://localhost:4000`, model = `bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0`, key = anything non-empty (LiteLLM ignores it by default in local mode; set `LITELLM_MASTER_KEY` for real auth).

Native in-browser Bedrock support (with SigV4 signing) is on the Phase 2 roadmap.

## How it works

```
┌──────────────────────────────┐   fetch (BYOK)    ┌──────────────┐
│ archai.html (your browser)   │ ────────────────► │ LLM provider │
│ - format adapter (drawio/    │ ◄──────────────── │              │
│   mermaid) chooses prompt    │      source       └──────────────┘
│   + extractor                │
│ - per-format renderer:       │
│     drawio  → iframe embed   │
│     mermaid → SVG via CDN    │
└──────────────────────────────┘
```

Each format owns three pieces: a system prompt (teaches the LLM how to emit valid source), an extractor (cleans up the response, recovers from truncation), and a renderer (loads into drawio iframe / renders Mermaid SVG / supports export-for-refine).

## Loading existing diagrams

Section 2 in the sidebar accepts a `.drawio`/`.xml` file (drawio mode) or `.mmd`/`.md`/`.txt` file (Mermaid mode), or you can paste source directly. Once loaded, the **Refine current diagram** button activates — write an instruction in the prompt box and the LLM modifies the diagram in place, preserving existing IDs where possible.

For drawio, the app reads the current diagram back from the embedded editor via the `export` postMessage protocol, so refines pick up your visual edits, not just the original generation.

## Deploy

ArchAI is a single static file, so any static host works.

### GitHub Pages (zero-config, recommended)

```bash
# from inside the folder containing archai.html + README.md
git init
git add .
git commit -m "Initial ArchAI release"

# create a public repo on github.com — call it "archai" — then:
git remote add origin git@github.com:<your-username>/archai.git
git branch -M main
git push -u origin main
```

Then in GitHub: **Settings → Pages → Source: Deploy from branch → main / (root) → Save.** Wait ~1 minute. Your app is live at `https://<your-username>.github.io/archai/archai.html`.

For a cleaner URL, rename `archai.html` to `index.html` before deploying.

### Vercel / Netlify / Cloudflare Pages

Drop the folder in — they all serve static files with no config. Same files, same behavior.

### Local

Just open `archai.html` from disk (`file://`). Works in any modern browser. Local models like Ollama may need `OLLAMA_ORIGINS=*` to accept browser requests.

## Trust — why you can believe "your key never leaves your browser"

Five layers, in increasing strength:

1. **Architectural.** There is no ArchAI backend. The repo is one HTML file. There is no server to send your key to.
2. **Source.** GitHub Pages serves the file directly from the public repo — you can read every line before opening it. The file you load is the file in the repo.
3. **Browser-verifiable.** Open DevTools → Network tab while you click Generate. The only outbound requests go to the LLM provider you configured. Nothing goes to anywhere else.
4. **Browser-enforced (planned for Phase 2).** A `Content-Security-Policy` meta tag will whitelist exactly the LLM provider origins you've configured, so any code that tries to call elsewhere is blocked by the browser before the request is made.
5. **Reputation.** Open source, Apache 2.0, public commit history. If anything in the file ever sent a key elsewhere it would be visible in the diff.

The "Clear stored config" button removes the key from `localStorage` immediately. Use it on shared machines.

## Files

- `archai.html` — the entire app, single file.
- `PLAN.md` — project plan / PRD (problem, scope, architecture, roadmap).
- `README.md` — this file.
- `LICENSE` — Apache 2.0.
- `.gitignore` — keeps editor/OS junk out of the repo.

## License and attribution

ArchAI is released under the **Apache License 2.0**.

ArchAI embeds the [drawio](https://github.com/jgraph/drawio) editor via iframe (drawio © JGraph Ltd, Apache 2.0) and loads [Mermaid](https://github.com/mermaid-js/mermaid) from a CDN (Mermaid project, MIT). AWS icons for Mermaid `architecture-beta` come from the [Iconify](https://iconify.design/) "logos" pack via the Iconify CDN.

ArchAI is not affiliated with JGraph Ltd, the Mermaid project, Iconify, or Amazon Web Services. "draw.io" / "diagrams.net" are trademarks of JGraph Ltd. "AWS" and AWS service marks are trademarks of Amazon.com, Inc. We use the upstream embed URL (`embed.diagrams.net`) without modification.

## Roadmap

- **Phase 1 (MVP — shipped).** Text → drawio AWS diagram. Three provider modes (OpenAI-compat / Anthropic / Bedrock-via-LiteLLM). localStorage config.
- **Phase 1.5 (shipped).** Mermaid as second format with AWS architecture-beta support. Load existing diagrams. Refine current diagram with AI. Robust extractors with truncation recovery.
- **Phase 2.** Native AWS Bedrock (SigV4 in browser). Azure & GCP shape coverage in drawio. Content-Security-Policy lockdown. Excalidraw as third format.
- **Phase 3.** Terraform / CloudFormation / CDK → diagram. Diagram critique mode (SPOFs, security, scaling). C4 model support.

## Contributing

This is a side project meant to stay small and friendly. PRs welcome for: more shape coverage, better prompts, additional providers, additional formats, bug fixes. Please keep it a single-file app for as long as possible.
