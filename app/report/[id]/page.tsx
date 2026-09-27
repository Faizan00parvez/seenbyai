import { notFound } from "next/navigation";
import { getReport } from "@/lib/storage";
import FixCard from "./FixCard";
import UnlockGate from "./UnlockGate";

export const dynamic = "force-dynamic";

const VERDICT_STYLE: Record<string, string> = {
  invisible: "bg-red-100 text-red-700",
  mentioned: "bg-amber-100 text-amber-700",
  recommended: "bg-green-100 text-green-700",
};

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-amber-500";
  return "text-red-500";
}

function scoreLabel(score: number): string {
  if (score >= 70) return "Strong — AI assistants already recommend you.";
  if (score >= 40) return "Partially visible — some queries miss you entirely.";
  return "Nearly invisible — AI assistants rarely mention you.";
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = getReport(id);
  if (!report) notFound();

  const { business, crawl, probes, fixes, score, mock } = report;
  const freeFixes = fixes.slice(0, 3);
  const lockedFixes = fixes.slice(3);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <a href="/" className="text-sm font-medium text-indigo-600 hover:underline">
        ← Run another audit
      </a>
      <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">
        SeenByAI
      </p>

      {mock && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>MOCK DATA.</strong> No Gemini API key is configured, so the AI
          probes and fix copy are stubs. Set <code>GEMINI_API_KEY</code> for real
          results. Crawl findings above are real.
        </div>
      )}

      <header className="mt-6">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-400">
          AI Visibility Report · {business.category} · {business.city}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold text-slate-900">{business.name}</h1>
        <a
          href={business.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-indigo-600 hover:underline"
        >
          {business.url}
        </a>
      </header>

      {/* Score hero */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          AI Visibility Score
        </p>
        <p className={`mt-2 text-7xl font-extrabold ${scoreColor(score)}`}>
          {score}
          <span className="text-2xl text-slate-400">/100</span>
        </p>
        <p className="mt-3 text-slate-600">{scoreLabel(score)}</p>
      </section>

      {/* Probe results */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-slate-900">What the AI actually said</h2>
        <p className="mt-1 text-sm text-slate-500">
          We asked an AI assistant 4 real buyer-intent questions for {business.city}.
        </p>
        <div className="mt-4 space-y-4">
          {probes.map((p, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-slate-900">“{p.question}”</p>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${VERDICT_STYLE[p.verdict]}`}
                >
                  {p.verdict}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{p.accuracyNote}</p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-indigo-600">
                  Show full AI answer
                </summary>
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  {p.answer}
                </p>
              </details>
            </div>
          ))}
        </div>
      </section>

      {/* Crawl findings */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-slate-900">Site crawl findings</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <FindingCard
            title="Pages crawled"
            ok
            detail={`${crawl.pages.length} page(s): ${crawl.pages
              .map((p) => new URL(p.url).pathname || "/")
              .join(", ")}`}
          />
          <FindingCard
            title="llms.txt"
            ok={crawl.llmsTxt.found}
            detail={
              crawl.llmsTxt.found
                ? "Present — AI crawlers can read your summary."
                : "Missing — AI crawlers get no guided summary of your business."
            }
          />
          <FindingCard
            title="AI crawlers in robots.txt"
            ok={crawl.robotsTxt.blocksAiBots.length === 0}
            detail={
              crawl.robotsTxt.blocksAiBots.length > 0
                ? `Blocked: ${crawl.robotsTxt.blocksAiBots.join(", ")}`
                : crawl.robotsTxt.found
                  ? "No AI bots blocked."
                  : "No robots.txt found."
            }
          />
          <FindingCard
            title="LocalBusiness schema"
            ok={crawl.pages[0]?.hasLocalBusinessSchema ?? false}
            detail={
              crawl.pages[0]?.hasLocalBusinessSchema
                ? "Detected on homepage."
                : "Not detected on homepage."
            }
          />
          <FindingCard
            title="FAQ schema"
            ok={crawl.pages[0]?.hasFaqSchema ?? false}
            detail={crawl.pages[0]?.hasFaqSchema ? "Detected." : "Not detected."}
          />
          <FindingCard
            title="Contact consistency"
            ok={crawl.napMismatches.length === 0}
            detail={
              crawl.napMismatches.length > 0
                ? crawl.napMismatches.join(" ")
                : "Phone/address consistent across crawled pages."
            }
          />
        </div>
        {crawl.errors.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {crawl.errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
      </section>

      {/* Fix plan */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-slate-900">Your fix plan</h2>
        <p className="mt-1 text-sm text-slate-500">
          Prioritized, copy-paste ready. Highest impact first.
        </p>
        <div className="mt-4 space-y-6">
          {freeFixes.map((f, i) => (
            <FixCard key={i} fix={f} index={i + 1} />
          ))}
        </div>
        {lockedFixes.length > 0 && (
          <div className="mt-6">
            <UnlockGate reportId={id} lockedFixes={lockedFixes} />
          </div>
        )}
      </section>

      <footer className="mt-12 border-t border-slate-200 pt-6 text-center text-xs text-slate-400">
        <p className="mb-2 font-bold uppercase tracking-[0.2em] text-indigo-400">SeenByAI</p>
        Report generated {new Date(report.createdAt).toLocaleString()} · Want us to
        implement these fixes for you? Reply to the audit email.
      </footer>
    </main>
  );
}

function FindingCard({
  title,
  ok,
  detail,
}: {
  title: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs text-white ${
            ok ? "bg-green-500" : "bg-red-500"
          }`}
        >
          {ok ? "✓" : "!"}
        </span>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{detail}</p>
    </div>
  );
}
