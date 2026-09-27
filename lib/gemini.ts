// Minimal Gemini REST client with pacing + exponential backoff.
// Key comes ONLY from process.env.GEMINI_API_KEY (never hardcoded).

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function isMockMode(): boolean {
  return !process.env.GEMINI_API_KEY;
}

function modelCandidates(): string[] {
  // 3.x-flash models are the current free-tier generation (the API itself
  // recommends them; 2.x names 404 for new keys). 3.7 first: it answered 200
  // while siblings were 503-overloaded at test time — order is best-effort,
  // the client falls through on 503 anyway.
  const primary = process.env.GEMINI_MODEL || "gemini-3.7-flash";
  const fallbacks = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
  ];
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface GeminiOpts {
  json?: boolean;
  temperature?: number;
  maxRetries?: number;
}

interface ApiError extends Error {
  code?: number;
}

export async function callGemini(
  prompt: string,
  opts: GeminiOpts = {}
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (dev) or Vercel env vars (prod)."
    );
  }
  const { json = false, temperature = 0.7, maxRetries = 3 } = opts;
  let lastErr: ApiError = new Error("No models attempted");
  for (const model of modelCandidates()) {
    try {
      return await attemptModel(key, model, prompt, json, temperature, maxRetries);
    } catch (e) {
      lastErr = e as ApiError;
      // 400/404 = bad model name for this key; 503 = overloaded -> try next candidate
      if (lastErr.code === 400 || lastErr.code === 404 || lastErr.code === 503) continue;
      throw lastErr;
    }
  }
  throw lastErr;
}

async function attemptModel(
  key: string,
  model: string,
  prompt: string,
  json: boolean,
  temperature: number,
  maxRetries: number
): Promise<string> {
  const url = `${API_BASE}/models/${model}:generateContent`;
  let delayMs = 4000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      // x-goog-api-key header keeps the key out of URL/logs
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });

    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      await sleep(delayMs + Math.random() * 1000);
      delayMs *= 2;
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `Gemini API error ${res.status}: ${text.slice(0, 200)}`
      ) as ApiError;
      err.code = res.status;
      throw err;
    }

    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text || "")
        .join("") ?? "";
    if (!text.trim()) throw new Error("Empty response from Gemini");
    return text;
  }
  throw new Error("Gemini retries exhausted after 429s");
}

/** Extract JSON from a model response (handles ```json fences). */
export function parseJsonResponse<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  return JSON.parse(raw) as T;
}
