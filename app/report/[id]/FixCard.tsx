import { Fix } from "@/lib/types";
import CopyButton from "./CopyButton";

const ARTIFACT_LABELS: Record<string, string> = {
  gbp_description: "Google Business Profile",
  faqs: "Homepage FAQs",
  llms_txt: "llms.txt",
  robots_txt: "robots.txt",
  json_ld: "Schema markup",
  nap: "NAP consistency",
  probe: "Probe miss",
};

export default function FixCard({ fix, index }: { fix: Fix; index: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            Fix #{index} · {ARTIFACT_LABELS[fix.artifact] ?? fix.artifact}
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-900">{fix.title}</h3>
        </div>
        <div className="flex gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              fix.impact === "High"
                ? "bg-red-100 text-red-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {fix.impact} impact
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {fix.effort}
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600">{fix.why}</p>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Copy-paste ready
          </p>
          <CopyButton text={fix.content} />
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
          {fix.content}
        </pre>
      </div>
    </div>
  );
}
