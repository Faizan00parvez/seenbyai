// Minimal Gemini REST client with pacing + exponential backoff.
// Key comes ONLY from process.env.GEMINI_API_KEY (never hardcoded).

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Per-attempt fetch budget. gemini-3.7-flash was observed hanging indefinitely
// (no response at all) while siblings answered in ~1.5s — without this, a hung
// model stalls the whole serverless function until Vercel kills it at 50s.
const FETCH_TIMEOUT_MS = 15000;

export function isMockMode(): boolean {
  return !process.env.GEMINI_API_KEY;
}

function modelCandidates(): string[] {
  // Ordered fastest/most-reliable first (measured 2026-09-28): 3.6-flash
  // answers in ~1-2s, 3.8-flash in ~5s, 3.7-flash in 10-25s (it trips the
  // 15s per-attempt budget under parallel load). 3.5-flash is currently
  // 503 on Google's side, so it is excluded. Order is best-effort — the
  // client falls through on 503 anyway.
  const primary = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const fallbacks = ["gemini-3.8-flash", "gemini-3.7-flash"];
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
  let quotaErr: ApiError | null = null;
  for (const model of modelCandidates()) {
    try {
      return await attemptModel(key, model, prompt, json, temperature, maxRetries);
    } catch (e) {
      lastErr = e as ApiError;
      // Remember quota errors: if every model fails, a 429 is the most
      // actionable error to surface (drives the friendly "try again later"
      // message), not a trailing 404/503 from the last candidate.
      if (lastErr.code === 429 && !quotaErr) quotaErr = lastErr;
      // 400/404 = bad model name for this key; 429 = per-model quota -> next
      // model may have its own quota; 503 = overloaded -> try next candidate
      if (
        lastErr.code === 400 ||
        lastErr.code === 404 ||
        lastErr.code === 429 ||
        lastErr.code === 503
      )
        continue;
      throw lastErr;
    }
  }
  throw quotaErr ?? lastErr;
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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
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
        signal: ctrl.signal,
      });
    } catch (e) {
      // Hung model or network failure: fail over to the next candidate
      // immediately (no same-model retry — a hanging model won't recover in
      // 4s). Thrown out of the retry loop so callGemini moves to next model.
      const err = new Error(
        `Gemini model ${model} timed out (service overloaded or unreachable): ${
          e instanceof Error ? e.message : "?"
        }`
      ) as ApiError;
      err.code = 503;
      throw err;
    } finally {
      clearTimeout(timer);
    }

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
