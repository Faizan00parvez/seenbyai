// TEMPORARY diagnostic endpoint — times each Gemini model candidate directly.
// DELETE after diagnosing the probe timeouts.
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODELS = [
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
];

export const maxDuration = 50;

async function timeModel(key: string, model: string) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Say OK." }] }],
        generationConfig: { temperature: 0 },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return { model, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return {
      model,
      status: "fetch-failed",
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : "?",
    };
  }
}

export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "no key" }, { status: 500 });
  const results = await Promise.all(MODELS.map((m) => timeModel(key, m)));
  return Response.json({ results });
}
