// POST /api/unlock { id, email } -> { fixes }
// Email gate: reveals the full fix plan, stores the email for outreach.
import { addEmail, getReport } from "@/lib/storage";

export async function POST(req: Request) {
  let body: { id?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { id, email } = body;
  if (!id || !email) {
    return Response.json({ error: "Missing id or email" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return Response.json({ error: "That doesn't look like a valid email" }, { status: 400 });
  }
  const report = getReport(id);
  if (!report) {
    return Response.json({ error: "Report not found" }, { status: 404 });
  }
  addEmail(email.trim().toLowerCase(), id);
  return Response.json({ fixes: report.fixes });
}
