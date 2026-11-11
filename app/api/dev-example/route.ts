/* Development only: writes a recorded example's tracking into public/examples/.
   The studio posts here from Save when opened with ?examples (see lib/examples.ts).
   In production this route refuses every request. */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!/^[a-z0-9-]{1,64}$/.test(name)) return new Response("Bad name", { status: 400 });
  const body = await req.text();
  const dir = path.join(process.cwd(), "public", "examples");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.tracking.json`), body);
  return Response.json({ ok: true, file: `/examples/${name}.tracking.json`, bytes: body.length });
}
