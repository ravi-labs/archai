/**
 * BYOK LLM client — same provider shapes as the ArchAI web app, configured from
 * environment variables so no key is ever written to disk by this tool.
 *
 *   ANTHROPIC_API_KEY=…            → Anthropic direct (default model claude-sonnet-4-6)
 *   OPENAI_API_KEY=…              → OpenAI-compatible (default gpt-4o-mini)
 *
 * Overrides (any provider):
 *   ARCHAI_PROVIDER = anthropic | openai-compat
 *   ARCHAI_BASE_URL = https://api.openai.com/v1  (or LiteLLM/Ollama/etc.)
 *   ARCHAI_MODEL    = model id
 *   ARCHAI_API_KEY  = key (overrides the provider-specific vars)
 */

export interface ProviderConfig {
  provider: "anthropic" | "openai-compat";
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function resolveProvider(): ProviderConfig {
  const env = process.env;
  const explicit = (env.ARCHAI_PROVIDER || "").toLowerCase();

  const anthropicKey = env.ARCHAI_API_KEY || env.ANTHROPIC_API_KEY || "";
  const openaiKey = env.ARCHAI_API_KEY || env.OPENAI_API_KEY || "";

  const useAnthropic = explicit === "anthropic" || (!explicit && !!anthropicKey && !env.OPENAI_API_KEY);

  if (useAnthropic) {
    return {
      provider: "anthropic",
      baseUrl: env.ARCHAI_BASE_URL || "https://api.anthropic.com",
      model: env.ARCHAI_MODEL || "claude-sonnet-4-6",
      apiKey: anthropicKey,
    };
  }
  return {
    provider: "openai-compat",
    baseUrl: env.ARCHAI_BASE_URL || "https://api.openai.com/v1",
    model: env.ARCHAI_MODEL || "gpt-4o-mini",
    apiKey: openaiKey,
  };
}

export function describeProvider(c: ProviderConfig): string {
  return `${c.provider} · ${c.model} · ${c.baseUrl}`;
}

export class LLMError extends Error {}

async function callOpenAICompat(c: ProviderConfig, system: string, user: string): Promise<string> {
  const url = c.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + c.apiKey },
    body: JSON.stringify({
      model: c.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 16000,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new LLMError(`LLM error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(c: ProviderConfig, system: string, user: string): Promise<string> {
  const url = c.baseUrl.replace(/\/+$/, "") + "/v1/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": c.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new LLMError(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.content?.[0]?.text ?? "";
}

export async function callLLM(c: ProviderConfig, system: string, user: string): Promise<string> {
  if (!c.apiKey) {
    throw new LLMError(
      "No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (or ARCHAI_API_KEY).",
    );
  }
  return c.provider === "anthropic"
    ? callAnthropic(c, system, user)
    : callOpenAICompat(c, system, user);
}
