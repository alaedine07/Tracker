import { env } from "../config/env";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Send a chat completion request via OpenRouter
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_object" };
    plugins?: { id: string }[];
  } = {}
): Promise<string> {
  const model = options.model || env.OPENROUTER_MODEL;

  console.log("\n========== [AI Service] Request ==========");
  console.log(`Model      : ${model}`);
  console.log(`Temperature: ${options.temperature ?? 0.7}`);
  console.log(`Max tokens : ${options.max_tokens ?? 4096}`);
  if (options.plugins) {
    console.log(`Plugins    : ${options.plugins.join(", ")}`);
  }
  console.log("--- Messages ---");
  for (const msg of messages) {
    console.log(`[${msg.role.toUpperCase()}]\n${msg.content}`);
  }
  console.log("==========================================\n");

  const body = JSON.stringify({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 4096,
    ...(options.response_format ? { response_format: options.response_format } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
  });

  const headers = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://musicmanager.app",
    "X-Title": "MusicManager",
  };

  const MAX_RETRIES = 3;
  let response: Response | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers,
      body,
    });

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const wait = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
      console.warn(`[AI Service] Rate limited (429). Retrying in ${wait / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    break;
  }

  if (!response!.ok) {
    const error = await response!.text();
    console.error(`[AI Service] Request failed: ${response!.status} ${error}`);
    throw new Error(`OpenRouter API error: ${response!.status} ${error}`);
  }

  const data = (await response!.json()) as any;

  // Check for OpenRouter-level errors
  if (data.error) {
    console.error(`[AI Service] OpenRouter error:`, JSON.stringify(data.error));
    throw new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const content = data.choices?.[0]?.message?.content || "";

  console.log("\n========== [AI Service] Response ==========");
  if (data.usage) {
    console.log(
      `Tokens used: ${data.usage.prompt_tokens} prompt + ${data.usage.completion_tokens} completion = ${data.usage.total_tokens} total`
    );
  }
  console.log("--- AI Response ---");
  console.log(content);
  console.log("===========================================\n");

  return content;
}

/**
 * Parse a JSON response from the LLM, handling markdown code fences
 */
export function parseLLMJson<T>(content: string): T {
  // Strip markdown code fences if present
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned);
}
