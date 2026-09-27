// Server-side site crawler: homepage + up to 3 key pages, NAP checks,
// JSON-LD schema detection, robots.txt AI-bot blocks, llms.txt presence.
import * as cheerio from "cheerio";
import { CrawlResult, PageFindings } from "./types";

const UA =
  "Mozilla/5.0 (compatible; SeenByAI-Audit/1.0; +https://seenbyai.vercel.app)";
const PAGE_TIMEOUT_MS = 15000;

const AI_BOTS = [
  "gptbot",
  "chatgpt-user",
  "claudebot",
  "claude-web",
  "perplexitybot",
  "ccbot",
  "google-extended",
  "amazonbot",
  "applebot",
  "bytespider",
  "diffbot",
];

interface FetchOutcome {
  ok: boolean;
  text?: string;
  status?: number;
  error?: string;
}

async function fetchText(url: string, timeoutMs = PAGE_TIMEOUT_MS): Promise<FetchOutcome> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,text/plain,*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = e instanceof Error && e.name === "AbortError";
    return { ok: false, error: isTimeout ? "timeout after 15s" : msg };
  } finally {
    clearTimeout(t);
  }
}

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u); // throws on invalid
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  return parsed.toString();
}

const PHONE_RE = /(\+?\(?\d[\d\s().\-/]{6,}\d)/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function extractPhones(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) found.add(m[1].trim());
  }
  return [...found].slice(0, 10);
}

function extractEmails(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE)) {
    if (!m[0].match(/\.(png|jpg|jpeg|gif|webp)$/i)) found.add(m[0]);
  }
  return [...found].slice(0, 10);
}

function normalizePhone(p: string): string {
  return p.replace(/\D/g, "").replace(/^0+/, "");
}

/** Walk JSON-LD blocks (incl. @graph / arrays) and collect @type values. */
function collectJsonLdTypes($: cheerio.CheerioAPI): Set<string> {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw.trim()) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const walk = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === "object") {
          const rec = node as Record<string, unknown>;
          const t = rec["@type"];
          if (typeof t === "string") types.add(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
          const graph = rec["@graph"];
          if (graph) walk(graph);
        }
      };
      walk(parsed);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return types;
}

function parsePage(url: string, html: string): Omit<PageFindings, "url"> {
  const $ = cheerio.load(html);
  // strip noise before text extraction
  $("script, style, noscript, svg").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 6000);

  const title = $("title").first().text().trim().slice(0, 200);
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim().slice(0, 300) ?? "";
  const h1s: string[] = [];
  $("h1").each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, " ");
    if (t && h1s.length < 5) h1s.push(t.slice(0, 150));
  });

  const types = collectJsonLdTypes($);
  const isLocalBusiness = [...types].some((t) =>
    /localbusiness|dentist|plumber|roofingcontractor|attorney|legalservice|medspa|healthandbeautybusiness|store|organization/i.test(t)
  );

  return {
    title,
    metaDescription,
    h1s,
    phones: extractPhones(bodyText + " " + $.html().slice(0, 20000)),
    emails: extractEmails(bodyText),
    hasLocalBusinessSchema: isLocalBusiness,
    hasFaqSchema: [...types].some((t) => /faqpage/i.test(t)),
  };
}

/** Candidate address lines: short lines containing the city name. */
function addressCandidates(html: string, city: string): string[] {
  if (!city) return [];
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const lines = $("body")
    .text()
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 10 && l.length < 220);
  const cityLower = city.toLowerCase();
  const found = new Set<string>();
  for (const l of lines) {
    if (l.toLowerCase().includes(cityLower)) found.add(l);
  }
  return [...found].slice(0, 5);
}

/** Parse robots.txt; return AI bot user-agents that are fully disallowed. */
function parseRobotsAiBlocks(robots: string): string[] {
  const blocked: string[] = [];
  const lines = robots.split("\n").map((l) => l.trim());
  let currentUAs: string[] = [];
  let currentDisallows: string[] = [];
  const flush = () => {
    for (const ua of currentUAs) {
      const uaLower = ua.toLowerCase();
      const isAi = AI_BOTS.some((b) => uaLower.includes(b));
      const fullyBlocked = currentDisallows.some((d) => d === "/" || d === "");
      if (isAi && fullyBlocked && !blocked.includes(ua)) blocked.push(ua);
    }
    currentUAs = [];
    currentDisallows = [];
  };
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (currentDisallows.length > 0) flush();
      currentUAs.push(value);
    } else if (key === "disallow") {
      currentDisallows.push(value);
    }
  }
  flush();
  return blocked;
}

export async function crawlSite(rawUrl: string, city: string): Promise<CrawlResult> {
  const url = normalizeUrl(rawUrl);
  const origin = new URL(url).origin;
  const errors: string[] = [];

  // --- homepage ---
  const home = await fetchText(url);
  if (!home.ok) {
    if (home.status === 403) {
      return {
        url, pages: [], napMismatches: [],
        robotsTxt: { found: false, blocksAiBots: [] },
        llmsTxt: { found: false },
        blocked: true,
        errors: [`Site blocked our crawler (HTTP 403). The fix plan will be generated from probe results only.`],
        crawledAt: new Date().toISOString(),
      };
    }
    throw new Error(`Could not fetch the site: ${home.error || "unknown error"}. Check the URL and try again.`);
  }

  const html = home.text!;
  const $ = cheerio.load(html);
  const lang = ($("html").attr("lang") || "").toLowerCase();
  const nonEnglish = !!lang && !lang.startsWith("en");

  const pageHtml = new Map<string, string>();
  pageHtml.set(url, html);

  const pages: PageFindings[] = [{ url, ...parsePage(url, html) }];

  // --- key pages via nav links (about / contact / services), same-origin only ---
  const wanted: { key: string; href: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().toLowerCase();
    const blob = (href + " " + text).toLowerCase();
    for (const key of ["about", "contact", "services"]) {
      if (blob.includes(key) && !wanted.some((w) => w.key === key)) {
        try {
          const abs = new URL(href, origin).toString();
          // skip hash-only links (SPA routes serve the same HTML as the homepage)
          const absNoHash = abs.split("#")[0];
          const urlNoHash = url.split("#")[0];
          if (new URL(abs).origin === origin && absNoHash !== urlNoHash) {
            wanted.push({ key, href: abs });
          }
        } catch { /* skip bad hrefs */ }
      }
    }
  });

  for (const w of wanted.slice(0, 3)) {
    const r = await fetchText(w.href);
    if (r.ok && r.text) {
      pageHtml.set(w.href, r.text);
      pages.push({ url: w.href, ...parsePage(w.href, r.text) });
    } else {
      pages.push({ url: w.href, title: "", metaDescription: "", h1s: [], phones: [], emails: [], hasLocalBusinessSchema: false, hasFaqSchema: false, fetchError: r.error });
    }
  }

  // --- NAP consistency: flag only when pages DISAGREE with each other ---
  const napMismatches: string[] = [];
  const okPages = pages.filter((p) => !p.fetchError);
  const setsDiffer = (sets: Set<string>[]): boolean => {
    if (sets.length < 2) return false;
    const ref = sets[0];
    return sets.some(
      (s) => s.size !== ref.size || [...s].some((x) => !ref.has(x))
    );
  };

  const phoneSets = okPages.map((p) => new Set(p.phones.map(normalizePhone)));
  if (setsDiffer(phoneSets)) {
    const perPage = okPages
      .filter((p) => p.phones.length)
      .map((p) => `${new URL(p.url).pathname || "/"} shows ${p.phones.join(", ")}`);
    napMismatches.push(`Different phone numbers across pages: ${perPage.join(" | ")}`);
  }

  const addrSets = okPages.map(
    (p) => new Set(addressCandidates(pageHtml.get(p.url) ?? "", city))
  );
  if (setsDiffer(addrSets)) {
    napMismatches.push(
      `Address text mentioning "${city}" differs across pages — search engines and AI assistants penalize inconsistent addresses. Standardize on one exact format everywhere.`
    );
  }

  // --- robots.txt ---
  let robotsTxt: CrawlResult["robotsTxt"] = { found: false, blocksAiBots: [] };
  const robots = await fetchText(origin + "/robots.txt", 10000);
  if (robots.ok && robots.text) {
    robotsTxt = { found: true, blocksAiBots: parseRobotsAiBlocks(robots.text) };
  } else {
    robotsTxt = { found: false, blocksAiBots: [], note: "No robots.txt found (not an error — but AI crawler rules can't be verified)." };
  }

  // --- llms.txt ---
  let llmsTxt: CrawlResult["llmsTxt"] = { found: false };
  const llms = await fetchText(origin + "/llms.txt", 10000);
  if (llms.ok && llms.text && llms.text.trim().length > 20) {
    llmsTxt = { found: true, preview: llms.text.trim().slice(0, 400) };
  }

  if (nonEnglish) {
    errors.push(
      "Non-English site detected — probes and fix copy are generated in English. Treat English copy as a template to translate, not final text."
    );
  }

  return {
    url,
    pages,
    napMismatches,
    robotsTxt,
    llmsTxt,
    lang: lang || undefined,
    nonEnglish: nonEnglish || undefined,
    errors,
    crawledAt: new Date().toISOString(),
  };
}
