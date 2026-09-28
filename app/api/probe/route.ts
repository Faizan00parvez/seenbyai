// POST /api/probe { businessName, city, category }
// Step 2: asks Gemini 4 localized buyer-intent questions, classifies each
// answer as invisible / mentioned / recommended, returns 0-100 score.
// MOCK mode (no GEMINI_API_KEY): returns clearly-labeled stub data.
import { callGemini, isMockMode, parseJsonResponse } from "@/lib/gemini";
import { getQuestions } from "@/lib/questions";
import { ProbeResult, Verdict } from "@/lib/types";

export const maxDuration = 50;

const ANSWER_PROMPT = (q: string) =>
  `You are a helpful local business recommendation assistant, like an AI search engine. ` +
  `Answer the following question the way you would to a real user, in 3-5 sentences, ` +
  `naming specific real businesses where you genuinely know of good options. ` +
  `If you don't know good options, say so honestly instead of inventing names.\n\nQuestion: ${q}`;

const CLASSIFY_PROMPT = (
  businessName: string,
  city: string,
  category: string,
  website: string,
  qa: { question: string; answer: string }[]
) =>
  `You are auditing how visible a local business is inside AI-generated answers.\n\n` +
  `Business under test:\n- Name: ${businessName}\n- City: ${city}\n- Category: ${category}\n- Website: ${website}\n\n` +
  `Below are ${qa.length} question/answer pairs produced by an AI assistant. For each pair, decide:\n` +
  `- verdict: "invisible" (business not mentioned at all), "mentioned" (named but not as a recommendation), or "recommended" (named as a pick/recommendation)\n` +
  `- details_accurate: true/false/null — are the stated phone/address/hours about the business correct? null if not mentioned or no details given.\n` +
  `- accuracyNote: one short sentence explaining the verdict (e.g. which competitor was recommended instead).\n\n` +
  `Match the business loosely: minor name variations count as a mention.\n\n` +
  qa.map((x, i) => `### Pair ${i}\nQ: ${x.question}\nA: ${x.answer}`).join("\n\n") +
  `\n\nRespond with ONLY a JSON array, one object per pair in order: ` +
  `[{"index":0,"verdict":"invisible","details_accurate":null,"accuracyNote":"..."}, ...]`;

export function scoreProbes(
  verdicts: { verdict: Verdict; details_accurate?: boolean | null }[]
): number {
  let score = 0;
  for (const v of verdicts) {
    if (v.verdict === "recommended") score += 25;
    else if (v.verdict === "mentioned") score += 10;
    if (v.verdict !== "invisible" && v.details_accurate === false) score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

function mockProbes(questions: string[]): ProbeResult[] {
  const verdicts: Verdict[] = ["invisible", "invisible", "mentioned", "invisible"];
  return questions.map((question, i) => ({
    question,
    answer:
      "MOCK answer — set GEMINI_API_KEY for a real probe. A real answer would name specific local businesses here.",
    verdict: verdicts[i] ?? "invisible",
    accuracyNote:
      "MOCK classification — set GEMINI_API_KEY for a real verdict.",
    mock: true,
  }));
}

export async function POST(req: Request) {
  let body: { businessName?: string; city?: string; category?: string; website?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { businessName, city, category } = body;
  if (!businessName || !city || !category) {
    return Response.json(
      { error: "Missing businessName, city or category" },
      { status: 400 }
    );
  }

  const questions = getQuestions(category, city);

  if (isMockMode()) {
    const probes = mockProbes(questions);
    return Response.json({
      probes,
      score: scoreProbes(probes.map((p) => ({ verdict: p.verdict }))),
      mock: true,
    });
  }

  try {
    // Answer calls run concurrently: 4 sequential calls + pacing sleeps
    // exceeded Vercel's 50s function limit (FUNCTION_INVOCATION_TIMEOUT).
    // Per-call 429/503 backoff in callGemini still applies.
    // maxRetries: 1 — fail fast on quota/overload instead of burning ~28s
    // in backoff sleeps (which pushed slow-429 responses into the 50s limit).
    const answers = await Promise.all(
      questions.map((q) =>
        callGemini(ANSWER_PROMPT(q), { temperature: 0.7, maxRetries: 1 })
      )
    );
    const qa = questions.map((question, i) => ({ question, answer: answers[i] }));

    const raw = await callGemini(
      CLASSIFY_PROMPT(businessName, city, category, body.website || "", qa),
      { json: true, temperature: 0.2, maxRetries: 1 }
    );
    const classified = parseJsonResponse<
      { index: number; verdict: Verdict; details_accurate: boolean | null; accuracyNote: string }[]
    >(raw);

    const probes: ProbeResult[] = qa.map((x, i) => {
      const c = classified.find((k) => k.index === i) ?? classified[i];
      const verdict: Verdict =
        c && ["invisible", "mentioned", "recommended"].includes(c.verdict)
          ? c.verdict
          : "invisible";
      return {
        question: x.question,
        answer: x.answer,
        verdict,
        accuracyNote: c?.accuracyNote || "No note returned.",
      };
    });

    return Response.json({
      probes,
      score: scoreProbes(
        probes.map((p, i) => ({
          verdict: p.verdict,
          details_accurate: classified[i]?.details_accurate ?? null,
        }))
      ),
      mock: false,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Probe failed";
    // Translate quota/overload failures into a human message — the frontend
    // surfaces data.error verbatim.
    const msg =
      /429|quota|rate limit|overloaded|503/i.test(raw)
        ? "The AI service is temporarily out of quota — please wait a few minutes and run the audit again."
        : raw;
    return Response.json({ error: msg }, { status: 502 });
  }
}
