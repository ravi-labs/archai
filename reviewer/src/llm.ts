/**
 * BYOK LLM client — same provider shapes as the ArchAI web app, configured from
 * environment variables so no key is ever written to disk by this tool.
 *
 *   ANTHROPIC_API_KEY=…            → Anthropic direct (default model claude-sonnet-4-6)
 *   OPENAI_API_KEY=…              → OpenAI-compatible (default gpt-4o-mini)
 *
 * LiteLLM: use the OpenAI-compatible path — set ARCHAI_BASE_URL to your proxy URL
 * (e.g. https://litellm.mycorp.com) and ARCHAI_MODEL to a model it exposes.
 *
 * Native AWS Bedrock (no proxy — runs in Node, so no browser-CORS limit):
 *   ARCHAI_PROVIDER=bedrock        → calls your Bedrock account directly (SigV4)
 *   AWS creds come from the standard chain (AWS_ACCESS_KEY_ID/SECRET[/SESSION_TOKEN],
 *     ~/.aws/credentials, or an IAM role). Region: ARCHAI_AWS_REGION | AWS_REGION.
 *   Model: ARCHAI_MODEL (a Bedrock model id, e.g. anthropic.claude-3-5-sonnet-20241022-v2:0
 *     or an inference-profile id like us.anthropic.claude-3-5-sonnet-20241022-v2:0).
 *
 * Overrides (any provider):
 *   ARCHAI_PROVIDER = anthropic | openai-compat | bedrock
 *   ARCHAI_BASE_URL = https://api.openai.com/v1  (or LiteLLM/Ollama/etc.)
 *   ARCHAI_MODEL    = model id
 *   ARCHAI_API_KEY  = key (overrides the provider-specific vars; not used for bedrock)
 */

export interface ProviderConfig {
  provider: "anthropic" | "openai-compat" | "bedrock";
  baseUrl: string;
  model: string;
  apiKey: string;
  /** AWS region — bedrock only. */
  region?: string;
}

export function resolveProvider(): ProviderConfig {
  const env = process.env;
  const explicit = (env.ARCHAI_PROVIDER || "").toLowerCase();

  if (explicit === "bedrock") {
    return {
      provider: "bedrock",
      baseUrl: "",
      model: env.ARCHAI_MODEL || env.ARCHAI_BEDROCK_MODEL || "anthropic.claude-3-5-sonnet-20241022-v2:0",
      apiKey: "", // AWS credential chain — not an API key
      region: env.ARCHAI_AWS_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1",
    };
  }

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
  if (c.provider === "bedrock") return `bedrock · ${c.model} · ${c.region}`;
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

/**
 * Native AWS Bedrock via the Converse API — model-agnostic (Claude, Llama, etc.).
 * Credentials come from the default AWS chain; no key is passed or stored here.
 * The SDK is imported lazily so non-Bedrock users never pay to load it.
 */
async function callBedrock(c: ProviderConfig, system: string, user: string): Promise<string> {
  let mod: typeof import("@aws-sdk/client-bedrock-runtime");
  try {
    mod = await import("@aws-sdk/client-bedrock-runtime");
  } catch {
    throw new LLMError(
      "Bedrock support needs the AWS SDK. Install it:  npm install @aws-sdk/client-bedrock-runtime",
    );
  }
  const { BedrockRuntimeClient, ConverseCommand } = mod;
  const client = new BedrockRuntimeClient({ region: c.region });
  try {
    const res = await client.send(
      new ConverseCommand({
        modelId: c.model,
        system: [{ text: system }],
        messages: [{ role: "user", content: [{ text: user }] }],
        inferenceConfig: { maxTokens: 16000, temperature: 0.2 },
      }),
    );
    const blocks = res.output?.message?.content ?? [];
    return blocks.map((b) => ("text" in b && b.text) || "").join("");
  } catch (err) {
    throw new LLMError(`Bedrock error: ${(err as Error).message}`);
  }
}

export async function callLLM(c: ProviderConfig, system: string, user: string): Promise<string> {
  if (c.provider === "bedrock") return callBedrock(c, system, user);
  if (!c.apiKey) {
    throw new LLMError(
      "No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (or ARCHAI_API_KEY), or ARCHAI_PROVIDER=bedrock for AWS Bedrock.",
    );
  }
  return c.provider === "anthropic"
    ? callAnthropic(c, system, user)
    : callOpenAICompat(c, system, user);
}
