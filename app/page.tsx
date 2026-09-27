"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/lib/questions";

type StepKey = "crawl" | "probe" | "plan";
type StepStatus = "idle" | "active" | "done" | "error";

const STEP_LABELS: Record<StepKey, { title: string; desc: string }> = {
  crawl: { title: "Crawling your site", desc: "Checking pages, schema, robots.txt, llms.txt…" },
  probe: { title: "Asking the AI", desc: "Running 4 local buyer-intent questions…" },
  plan: { title: "Building your fix plan", desc: "Turning findings into copy-paste fixes…" },
};

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepStatus>>({
    crawl: "idle",
    probe: "idle",
    plan: "idle",
  });
  const [error, setError] = useState<string | null>(null);

  const setStep = (k: StepKey, s: StepStatus) =>
    setSteps((prev) => ({ ...prev, [k]: s }));

  async function postJson(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function runAudit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRunning(true);
    setSteps({ crawl: "idle", probe: "idle", plan: "idle" });
    try {
      setStep("crawl", "active");
      const crawl = await postJson("/api/crawl", { url, city });
      setStep("crawl", "done");

      setStep("probe", "active");
      const probeRes = await postJson("/api/probe", {
        businessName: name,
        city,
        category,
        website: crawl.url || url,
      });
      setStep("probe", "done");

      setStep("plan", "active");
      const planRes = await postJson("/api/plan", {
        crawl,
        probes: probeRes.probes,
        business: { url, name, city, category },
      });
      setStep("plan", "done");

      router.push(`/report/${planRes.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setSteps((prev) => {
        const next = { ...prev };
        (Object.keys(next) as StepKey[]).forEach((k) => {
          if (next[k] === "active") next[k] = "error";
        });
        return next;
      });
      setRunning(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-600">
          SeenByAI
        </p>
      </div>
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Is AI search recommending <span className="text-indigo-600">you</span>?
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Paste a local business website. We ask AI assistants real buyer questions
          and hand you a fix plan — not a dashboard.
        </p>
      </div>

      <form
        onSubmit={runAudit}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Website URL</label>
          <input
            className={inputCls}
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            disabled={running}
            inputMode="url"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Business name</label>
            <input
              className={inputCls}
              placeholder="Bright Smile Dental"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={running}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">City</label>
            <input
              className={inputCls}
              placeholder="Austin"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              disabled={running}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Category</label>
          <select
            className={inputCls}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={running}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={running}
          className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? "Audit running…" : "Run free AI visibility audit"}
        </button>
        <p className="text-center text-xs text-slate-400">
          Free · ~90 seconds · no signup needed for your score
        </p>
      </form>

      {(running || error) && (
        <div className="mt-8 space-y-3">
          {(Object.keys(STEP_LABELS) as StepKey[]).map((k) => (
            <StepRow key={k} label={STEP_LABELS[k]} status={steps[k]} />
          ))}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function StepRow({
  label,
  status,
}: {
  label: { title: string; desc: string };
  status: StepStatus;
}) {
  if (status === "idle") return null;
  const icon =
    status === "active" ? (
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
    ) : status === "done" ? (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-xs text-white">✓</span>
    ) : (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">✕</span>
    );
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-sm font-semibold text-slate-900">{label.title}</p>
        <p className="text-xs text-slate-500">{label.desc}</p>
      </div>
    </div>
  );
}
