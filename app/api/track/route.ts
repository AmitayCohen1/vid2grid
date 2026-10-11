import { NextResponse, type NextRequest } from "next/server";
import { describeAgent, sanitizeBatch } from "@/lib/events";
import { sql } from "@/lib/db";

/* Ingest for lib/analytics.ts. Accepts a small batch, drops bots and other
   origins, and writes one row per event. Always answers 204 so a beacon never retries. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return new NextResponse(null, { status: 204 });
  const { device, browser } = describeAgent(req.headers.get("user-agent") ?? "");
  if (!device) return new NextResponse(null, { status: 204 });
  const text = await req.text();
  if (text.length > 32_000) return new NextResponse(null, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return new NextResponse(null, { status: 400 }); }
  const rows = sanitizeBatch(body);
  if (!rows) return new NextResponse(null, { status: 400 });
  if (!rows.length || !process.env.DATABASE_URL) return new NextResponse(null, { status: 204 });
  const country = req.headers.get("x-vercel-ip-country");
  try {
    await sql().query(
      `INSERT INTO events (ts, name, visitor, session, path, props, referrer, country, device, browser)
       SELECT x.ts, x.name, x.visitor, x.session, x.path, x.props, x.referrer, $2, $3, $4
       FROM jsonb_to_recordset($1::jsonb) AS x(ts timestamptz, name text, visitor text, session text, path text, props jsonb, referrer text)`,
      [JSON.stringify(rows), country, device, browser],
    );
  } catch (e) {
    console.error("[track]", e);
  }
  return new NextResponse(null, { status: 204 });
}
