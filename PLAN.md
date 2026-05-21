# ArchAI (working title) — Project Plan

A free, open-source web app that turns a plain-English description of a system into an editable AWS architecture diagram, rendered inside an embedded drawio editor.

Status: planning / prototype
License: Apache 2.0 (compatible with drawio upstream)
Owner: Ravi

---

## 1. Problem

Architects, senior engineers, and solutions consultants spend disproportionate time drawing the same patterns over and over: three-tier web apps, event-driven pipelines, lambda-fanout, multi-AZ HA, etc. Existing AI diagram tools either (a) generate pretty pictures that aren't editable in real tools, (b) lock the output behind a SaaS paywall, or (c) produce generic boxes-and-arrows without proper AWS iconography.

The opening is: **a good first draft, in the editor the user already knows, that they can refine by hand.**

## 2. Target user

Primary: cloud architects, staff/principal engineers, and pre-sales solutions architects who already use drawio (diagrams.net) and already have access to an LLM (corporate ChatGPT, Bedrock, Claude, or a self-hosted model).

Secondary: students learning AWS, technical bloggers, anyone writing an ADR.

What they have in common: they live in drawio anyway, and they don't want to switch tools or sign up for another SaaS to get a starting diagram.

## 3. Scope — what we build first

**In scope (MVP):**

- Single-page web app, runs entirely in the browser.
- Embedded drawio editor (iframe, `embed.diagrams.net`).
- Plain-English prompt → AWS architecture diagram using AWS4 shape library.
- Bring-your-own-LLM configuration: OpenAI-compatible endpoint, Anthropic direct, AWS Bedrock (via LiteLLM proxy for MVP, native in Phase 2).
- Diagram loads into the embedded editor; user can edit, save, export.
- Config persisted in `localStorage` (no backend, no accounts).

**Explicitly out of scope (for now):**

- Code/Terraform → diagram (Phase 3).
- Diagram critique / review (Phase 3).
- Non-AWS clouds (Azure/GCP) — easy to add, but focus first.
- Team collaboration, sharing, server-side persistence.
- Mobile-optimized UI.
- Multi-page diagrams.

## 4. Architecture

### High level

```
┌───────────────────────────────────────────────────────────┐
│                     Browser (your laptop)                 │
│  ┌─────────────────────┐    ┌──────────────────────────┐  │
│  │   Our app (HTML)    │    │   drawio iframe          │  │
│  │  - prompt input     │    │   (embed.diagrams.net)   │  │
│  │  - provider config  │◄──►│   - renders XML          │  │
│  │  - LLM client       │    │   - user edits           │  │
│  └──────────┬──────────┘    └──────────────────────────┘  │
│             │                                              │
└─────────────┼──────────────────────────────────────────────┘
              │ fetch() with user's BYO key
              ▼
   ┌─────────────────────────────────────────┐
   │  LLM provider (user's choice)           │
   │  - OpenAI / Azure OpenAI                │
   │  - LiteLLM proxy → anything             │
   │  - Anthropic direct                     │
   │  - AWS Bedrock (Phase 2 native)         │
   │  - Local: Ollama, LM Studio, vLLM       │
   └─────────────────────────────────────────┘
```

### Why iframe embed (not fork)

- Zero maintenance of the drawio codebase.
- We pick up upstream improvements for free.
- Smaller blast radius for licensing concerns — we don't redistribute drawio code.
- `postMessage` protocol is documented and stable.

### Why BYOK + multi-provider

- $0 inference cost for us — the app can scale to any number of users without our wallet noticing.
- Architects often *must* use their employer's LLM (corporate ChatGPT, internal Bedrock, on-prem Llama). One provider would lock most of them out.
- LiteLLM as a single supported protocol covers 100+ models. Native Anthropic and Bedrock support is for the impatient.

### LLM abstraction

The app talks one of three protocols, selected by the user:

1. **OpenAI-compatible** (default). `POST {baseURL}/chat/completions`. Works for OpenAI, LiteLLM, Azure OpenAI (with deployment URL), Ollama (`http://localhost:11434/v1`), LM Studio, vLLM, Together, Groq, etc.
2. **Anthropic direct.** `POST https://api.anthropic.com/v1/messages` with `anthropic-dangerous-direct-browser-access: true`. For users with an Anthropic key and no proxy.
3. **AWS Bedrock.** Recommended path in MVP: run LiteLLM proxy with Bedrock credentials, then use OpenAI-compatible mode. Native SigV4-signed Bedrock calls land in Phase 2.

## 5. Prompt strategy

System prompt teaches the model:

- The mxfile/mxGraphModel XML format with a minimal example.
- The AWS4 shape style references (`shape=mxgraph.aws4.ec2`, etc.).
- Layout conventions: group by VPC/subnet, left-to-right user → edge → app → data.
- Hard constraint: output XML only, no markdown fences, no commentary.

We ship a small library of canonical examples (three-tier web app, event-driven pipeline, serverless API, data lake) as few-shot anchors. These are the difference between a wobbly first attempt and a diagram an architect would actually accept as a starting point.

## 6. UX flow

1. First run: user picks a provider, enters base URL + key + model name, clicks Test. Stored in `localStorage`.
2. User types a description, clicks Generate.
3. Spinner; LLM returns XML; we validate it's well-formed; we postMessage it into the iframe.
4. User edits in drawio. Export from drawio's native menu.

That's the entire UX. No accounts, no signup, no upload, no router.

## 7. Risks and how we handle them

| Risk | Mitigation |
| --- | --- |
| LLM returns malformed XML | Wrap in try/parse; on failure, show raw output and a "retry with stricter prompt" button. |
| drawio embed protocol changes | Pin to a documented version; the protocol has been stable for years. |
| User pastes key on a shared machine | Big disclaimer; key never leaves browser; offer "session only" mode that doesn't persist. |
| AWS icon set is intimidating to the LLM | One-shot examples; restrict to top ~30 AWS services in MVP. |
| Someone calls it "draw.io AI" and we get a trademark letter | Pick a name that isn't draw.io / diagrams.net derivative. Footer says "Built on the open-source drawio editor." |
| Inference cost surprises | We don't pay any. BYOK. |
| Anthropic browser CORS / Bedrock SigV4 | Document LiteLLM as the recommended bridge for both. |

## 8. Roadmap

**Phase 1 — MVP (this session + a weekend):**
- Single-file HTML prototype.
- OpenAI-compatible + Anthropic direct.
- AWS-focused prompt library, 4 few-shot examples.
- localStorage config.
- README + Apache 2.0 license + drawio attribution.

**Phase 2 — Polish (next 2–3 weekends):**
- Native Bedrock support (SigV4 in browser).
- Expanded AWS shape coverage; Azure and GCP shape sets.
- "Refine this diagram" follow-up turns (model sees current XML + new instruction).
- Diagram templates gallery.

**Phase 3 — Differentiators:**
- Code/Terraform → diagram. Paste HCL, get architecture.
- Diagram review/critique mode. Upload XML, get SPOFs / scaling / security feedback.
- Optional: C4 model support.

## 9. Licensing / legal notes

- App code: Apache 2.0 (matches drawio upstream).
- We do not redistribute drawio source. We embed `embed.diagrams.net` via iframe.
- We do not use the names "draw.io" or "diagrams.net" in the product name. Footer credits drawio as the underlying editor.
- No analytics, no telemetry, no key forwarding to our servers (we have no servers).
- All LLM calls go directly from the user's browser to the user's chosen provider.

## 10. Success criteria

We're done with MVP when:

1. A first-time user can go from "blank page" to "AWS three-tier diagram inside drawio" in under 90 seconds.
2. The same app works against OpenAI, Anthropic, and a local Ollama instance with just config changes.
3. The generated diagram is editable in drawio with AWS shapes (not generic rectangles).
4. The repo is public, README explains setup in under 60 seconds of reading, and the Apache 2.0 attribution is present.

If those four hold, we ship it and write the launch post.
