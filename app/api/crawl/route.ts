// POST /api/crawl { url, city } -> CrawlResult
// Step 1 of the chained audit. Rate-limited: 3 audits/day per IP.
import { crawlSite } from "@/lib/crawl";
import {
  checkAndIncrementRateLimit,
  getClientIp,
  MAX_AUDITS_PER_DAY,
} from "@/lib/storage";

export const maxDuration = 50;

export async function POST(req: Request) {
  let body: { url?: string; city?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.url || typeof body.url !== "string") {
    return Response.json({ error: "Missing 'url'" }, { status: 400 });
  }

  const ip = getClientIp(req);
  const rl = checkAndIncrementRateLimit(ip);
  if (!rl.allowed) {
    return Response.json(
      {
        error: `Daily limit reached (${MAX_AUDITS_PER_DAY} free audits/day per IP). Try again tomorrow.`,
      },
      { status: 429 }
    );
  }

  try {
    const result = await crawlSite(body.url, body.city || "");
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Crawl failed";
    return Response.json({ error: msg }, { status: 400 });
  }
}
