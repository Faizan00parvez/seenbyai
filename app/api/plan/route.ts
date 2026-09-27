// POST /api/plan { crawl, probes, business }
// Step 3: generates the prioritized Fix Plan via Gemini, persists the report,
// returns { id }. MOCK mode builds a rule-based plan from real crawl data,
// clearly labeled.
import { callGemini, isMockMode, parseJsonResponse } from "@/lib/gemini";
import { saveReport } from "@/lib/storage";
import {
  BusinessInput,
  CrawlResult,
  Fix,
  FixArtifact,
  ProbeResult,
} from "@/lib/types";

export const maxDuration = 50;

const PLAN_PROMPT = (
  business: BusinessInput,
  crawl: CrawlResult,
  probes: ProbeResult[]
) =>
  `You are an AI-search visibility consultant for local businesses. ` +
  `Generate a prioritized FIX PLAN for this business so AI assistants (ChatGPT, Gemini, Perplexity) ` +
  `recommend it for local buyer-intent queries.\n\n` +
  `Business: ${business.name} | ${business.category} | ${business.city} | ${business.url}\n\n` +
  `CRAWL FINDINGS (JSON):\n${JSON.stringify(crawl, null, 1).slice(0, 6000)}\n\n` +
  `PROBE RESULTS (JSON):\n${JSON.stringify(
    probes.map((p) => ({ q: p.question, verdict: p.verdict, note: p.accuracyNote })),
    null,
    1
  )}\n\n` +
  `Produce fixes in priority order. Include ALL of these that are relevant (skip only if genuinely not applicable):\n` +
  `1. Google Business Profile description rewrite (full draft, buyer-intent keywords baked in)\n` +
  `2. Homepage FAQ block — exactly 5 Q&As written out, ready to paste (also feeds FAQ schema)\n` +
  `3. Complete llms.txt file content, ready to upload to the site root\n` +
  `4. robots.txt fix — exact lines to remove/change to unblock AI crawlers\n` +
  `5. LocalBusiness JSON-LD snippet, filled with their real details, ready to paste\n` +
  `6. NAP inconsistency fixes (only if the crawl found mismatches)\n` +
  `7. Probe-miss fixes — for each probe where the business was invisible, one concrete reason + fix\n\n` +
  `Every fix must be concrete and copy-paste ready — draft the actual text, don't describe it.\n` +
  `Respond with ONLY JSON: {"fixes":[{"title":"...","why":"one sentence on why this moves the needle","effort":"5 min"|"30 min","impact":"High"|"Med","artifact":"gbp_description"|"faqs"|"llms_txt"|"robots_txt"|"json_ld"|"nap"|"probe","content":"the copy-paste-ready artifact (plain text or code, no markdown fences)"}]}`;

const VALID_ARTIFACTS: FixArtifact[] = [
  "gbp_description",
  "faqs",
  "llms_txt",
  "robots_txt",
  "json_ld",
  "nap",
  "probe",
];

function sanitizeFixes(raw: unknown): Fix[] {
  if (!raw || typeof raw !== "object") throw new Error("Bad plan shape");
  const arr = (raw as { fixes?: unknown }).fixes;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("Empty fix list");
  return arr.slice(0, 12).map((f) => {
    const r = f as Record<string, unknown>;
    return {
      title: String(r.title || "Untitled fix").slice(0, 120),
      why: String(r.why || "").slice(0, 300),
      effort: r.effort === "30 min" ? "30 min" : "5 min",
      impact: r.impact === "Med" ? "Med" : "High",
      artifact: VALID_ARTIFACTS.includes(r.artifact as FixArtifact)
        ? (r.artifact as FixArtifact)
        : "probe",
      content: String(r.content || "").slice(0, 6000),
    } as Fix;
  });
}

/** Rule-based plan from REAL crawl data, used when no API key is set. */
function mockPlan(
  business: BusinessInput,
  crawl: CrawlResult,
  probes: ProbeResult[]
): Fix[] {
  const fixes: Fix[] = [];
  const tag = (s: string) => `[MOCK — set GEMINI_API_KEY for AI-generated copy]\n${s}`;
  const phone = crawl.pages[0]?.phones[0] || "[phone]";

  fixes.push({
    title: "Rewrite your Google Business Profile description",
    why: tag("GBP descriptions feed AI answers; keyword-rich ones get cited more."),
    effort: "5 min",
    impact: "High",
    artifact: "gbp_description",
    content: tag(
      `${business.name} — trusted ${business.category.toLowerCase()} in ${business.city}. ` +
        `Call ${phone} for fast, reliable service with upfront pricing. ` +
        `Serving ${business.city} and nearby areas. Open weekends.`
    ),
  });

  fixes.push({
    title: "Add this FAQ block to your homepage",
    why: tag("FAQ content is the #1 thing AI assistants quote verbatim."),
    effort: "30 min",
    impact: "High",
    artifact: "faqs",
    content: tag(
      `Q: What is the best ${business.category.toLowerCase()} in ${business.city}?\n` +
        `A: ${business.name} is rated among the top choices in ${business.city} for ...\n\n` +
        `Q: How much does it cost?\nA: ...\n\nQ: Are you open on weekends?\nA: ...\n\n` +
        `Q: Which areas do you serve?\nA: ${business.city} and surrounding areas.\n\nQ: How do I book?\nA: Call ${phone} ...`
    ),
  });

  if (!crawl.llmsTxt.found) {
    fixes.push({
      title: "Create an llms.txt file at your site root",
      why: tag("Gives AI crawlers a clean summary of your business to quote."),
      effort: "5 min",
      impact: "High",
      artifact: "llms_txt",
      content: tag(
        `# ${business.name}\n\n> ${business.category} in ${business.city}.\n\n` +
          `## Contact\n- Phone: ${phone}\n- Website: ${business.url}\n\n## Services\n- ...\n\n## Areas served\n- ${business.city}`
      ),
    });
  }

  if (crawl.robotsTxt.blocksAiBots.length > 0) {
    fixes.push({
      title: "Unblock AI crawlers in robots.txt",
      why: tag(`These bots are currently blocked: ${crawl.robotsTxt.blocksAiBots.join(", ")}.`),
      effort: "5 min",
      impact: "High",
      artifact: "robots_txt",
      content: tag(
        `In robots.txt, change:\n  User-agent: ${crawl.robotsTxt.blocksAiBots[0]}\n  Disallow: /\nto:\n  User-agent: ${crawl.robotsTxt.blocksAiBots[0]}\n  Allow: /`
      ),
    });
  }

  if (!crawl.pages[0]?.hasLocalBusinessSchema) {
    fixes.push({
      title: "Add LocalBusiness schema markup",
      why: tag("Structured data is how AI assistants verify your phone, hours and address."),
      effort: "30 min",
      impact: "Med",
      artifact: "json_ld",
      content: tag(
        `<script type="application/ld+json">\n${JSON.stringify(
          {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            name: business.name,
            telephone: phone,
            url: business.url,
            address: {
              "@type": "PostalAddress",
              addressLocality: business.city,
              addressCountry: "IN",
            },
          },
          null,
          2
        )}\n</script>`
      ),
    });
  }

  for (const m of crawl.napMismatches) {
    fixes.push({
      title: "Fix inconsistent contact details",
      why: tag("Mismatched NAP data confuses both Google and AI assistants."),
      effort: "30 min",
      impact: "Med",
      artifact: "nap",
      content: tag(m),
    });
  }

  const misses = probes.filter((p) => p.verdict === "invisible");
  if (misses.length > 0) {
    fixes.push({
      title: `Become quotable for "${misses[0].question}"`,
      why: tag("AI assistants couldn't find a citable answer about you for this query."),
      effort: "30 min",
      impact: "High",
      artifact: "probe",
      content: tag(
        `Publish a dedicated page/section answering: "${misses[0].question}" ` +
          `in 2-3 sentences naming ${business.name}, ${business.city}, and your phone number.`
      ),
    });
  }

  return fixes;
}

export async function POST(req: Request) {
  let body: { crawl?: CrawlResult; probes?: ProbeResult[]; business?: BusinessInput };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { crawl, probes, business } = body;
  if (!crawl || !probes || !business?.name) {
    return Response.json({ error: "Missing crawl, probes or business" }, { status: 400 });
  }

  try {
    let fixes: Fix[];
    let mock = false;
    if (isMockMode()) {
      mock = true;
      fixes = mockPlan(business, crawl, probes);
    } else {
      const raw = await callGemini(PLAN_PROMPT(business, crawl, probes), {
        json: true,
        temperature: 0.5,
      });
      fixes = sanitizeFixes(parseJsonResponse(raw));
    }

    // Recompute score defensively (probe route already scored, but plan is the source of truth here)
    let score = 0;
    for (const p of probes) {
      if (p.verdict === "recommended") score += 25;
      else if (p.verdict === "mentioned") score += 10;
    }
    score = Math.max(0, Math.min(100, score));

    const report = saveReport({ business, score, crawl, probes, fixes, mock });
    return Response.json({ id: report.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Plan generation failed";
    return Response.json({ error: msg }, { status: 502 });
  }
}
