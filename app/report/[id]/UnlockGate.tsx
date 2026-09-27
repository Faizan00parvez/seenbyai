"use client";

import { useState } from "react";
import { Fix } from "@/lib/types";
import FixCard from "./FixCard";

export default function UnlockGate({
  reportId,
  lockedFixes,
}: {
  reportId: string;
  lockedFixes: Fix[];
}) {
  const [email, setEmail] = useState("");
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reportId, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unlock failed");
      setFixes(data.fixes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setLoading(false);
    }
  }

  if (fixes) {
    return (
      <div className="space-y-6">
        {fixes.map((f, i) => (
          <FixCard key={i} fix={f} index={i + 4} />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50 p-8 text-center">
      <p className="text-lg font-bold text-slate-900">
        {lockedFixes.length} more fix{lockedFixes.length === 1 ? "" : "es"} waiting
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        Including your ready-to-upload <code>llms.txt</code>, the exact{" "}
        <code>robots.txt</code> changes, and your GBP description rewrite.
        Enter your email to unlock the full plan — no spam, ever.
      </p>
      <form onSubmit={unlock} className="mx-auto mt-5 flex max-w-md gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@business.com"
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {/* blurred preview of what's behind the gate */}
      <div className="pointer-events-none mt-6 select-none space-y-3 opacity-40 blur-[2px]" aria-hidden>
        {lockedFixes.slice(0, 2).map((f, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 text-left">
            <p className="text-sm font-semibold text-slate-900">{f.title}</p>
            <p className="mt-1 text-xs text-slate-500">{f.why}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
