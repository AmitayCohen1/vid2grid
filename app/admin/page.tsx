import Link from "next/link";
import { SignOutButton, UserButton } from "@clerk/nextjs";
import { adminUser } from "@/lib/admin";
import { sql } from "@/lib/db";

/* Product analytics for the people on ADMIN_EMAILS. proxy.ts sends anyone
   signed out to Clerk; this page refuses anyone signed in but not on the list.
   Everything here reads the `events` table written by app/api/track. */

const RANGES = [1, 7, 30, 90] as const;
type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const fmt = (v: unknown) => n(v).toLocaleString("en-US");
const pct = (a: unknown, b: unknown) => (n(b) ? `${Math.round((n(a) / n(b)) * 100)}%` : "–");

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { user, isAdmin } = await adminUser();
  if (!isAdmin) {
    return (
      <main className="min-h-screen grid place-items-center p-8">
        <div className="max-w-sm text-center space-y-4">
          <h1 className="text-xl font-semibold">Not allowed</h1>
          <p className="text-muted-foreground text-sm">{user?.primaryEmailAddress?.emailAddress ?? "This account"} is not an admin of Visual Elbow.</p>
          <SignOutButton redirectUrl="/admin"><button className="btn">Sign out</button></SignOutButton>
        </div>
      </main>
    );
  }

  const asked = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 7;
  const q = sql();
  const since = `now() - make_interval(days => $1)`;
  const [[k], daily, funnel, names, sources, errors, countries, devices, looks, referrers, recent] = await Promise.all([
    q.query(`SELECT count(DISTINCT visitor) visitors, count(DISTINCT session) sessions, count(*) events,
      count(*) FILTER (WHERE name = 'dance_ready') dances,
      count(DISTINCT visitor) FILTER (WHERE name = 'dance_ready') creators,
      count(*) FILTER (WHERE name = 'live_start') live,
      count(*) FILTER (WHERE name = 'dance_saved') saves,
      count(*) FILTER (WHERE name = 'dancer_added') added
      FROM events WHERE ts > ${since}`, [days]),
    q.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
      (SELECT count(DISTINCT visitor) FROM events WHERE ts >= d AND ts < d + interval '1 day') visitors,
      (SELECT count(*) FROM events WHERE name = 'dance_ready' AND ts >= d AND ts < d + interval '1 day') dances
      FROM generate_series(date_trunc('day', now() - make_interval(days => $1 - 1)), date_trunc('day', now()), interval '1 day') d ORDER BY d`, [days]),
    q.query(`SELECT step, count(DISTINCT visitor) visitors FROM events
      CROSS JOIN LATERAL (VALUES (CASE name WHEN 'app_open' THEN 1 WHEN 'studio_open' THEN 2 WHEN 'dance_ready' THEN 3 WHEN 'play' THEN 4 WHEN 'dance_saved' THEN 5 END)) s(step)
      WHERE ts > ${since} AND step IS NOT NULL GROUP BY step ORDER BY step`, [days]),
    q.query(`SELECT name, count(*) events, count(DISTINCT visitor) visitors FROM events WHERE ts > ${since} GROUP BY name ORDER BY events DESC`, [days]),
    q.query(`SELECT coalesce(props->>'from', '?') label, count(*) c FROM events WHERE name = 'dance_ready' AND ts > ${since} GROUP BY 1 ORDER BY c DESC`, [days]),
    q.query(`SELECT name, coalesce(props->>'error', '') label, count(*) c FROM events WHERE name IN ('dance_failed', 'live_failed', 'dancer_add_failed', 'live_too_short') AND ts > ${since} GROUP BY 1, 2 ORDER BY c DESC LIMIT 12`, [days]),
    q.query(`SELECT coalesce(country, '?') label, count(DISTINCT visitor) c FROM events WHERE ts > ${since} GROUP BY 1 ORDER BY c DESC LIMIT 12`, [days]),
    q.query(`SELECT device || ' · ' || browser label, count(DISTINCT visitor) c FROM events WHERE ts > ${since} GROUP BY 1 ORDER BY c DESC LIMIT 10`, [days]),
    q.query(`SELECT props->>'look' label, count(*) c FROM events WHERE name = 'character_chosen' AND ts > ${since} GROUP BY 1 ORDER BY c DESC LIMIT 12`, [days]),
    q.query(`SELECT coalesce(substring(referrer from '^https?://([^/]+)'), 'direct') label, count(DISTINCT visitor) c FROM events WHERE ts > ${since} GROUP BY 1 ORDER BY c DESC LIMIT 10`, [days]),
    q.query(`SELECT ts, name, props, visitor, country, device FROM events ORDER BY ts DESC LIMIT 60`),
  ]);

  const steps = ["Opened the site", "Entered the studio", "Made a dance", "Pressed play", "Saved a dance"];
  const byStep = new Map(funnel.map((r) => [n(r.step), n(r.visitors)]));
  const first = byStep.get(1) ?? 0;

  return (
    <main className="min-h-screen px-6 py-8 md:px-10 max-w-7xl mx-auto space-y-8 text-sm">
      <header className="flex flex-wrap items-center gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Visual Elbow · analytics</h1>
          <p className="text-muted-foreground">Anonymous visitors, last {days === 1 ? "24 hours" : `${days} days`}. Page views and Web Vitals are on the Vercel Analytics dashboard.</p>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex rounded-md border border-border overflow-hidden" aria-label="Range">
            {RANGES.map((d) => (
              <Link key={d} href={`/admin?days=${d}`} aria-current={d === days ? "page" : undefined}
                className={`px-3 py-1.5 ${d === days ? "bg-foreground text-background" : "hover:bg-muted"}`}>{d === 1 ? "24h" : `${d}d`}</Link>
            ))}
          </nav>
          <UserButton />
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Stat label="Visitors" value={fmt(k.visitors)} />
        <Stat label="Sessions" value={fmt(k.sessions)} />
        <Stat label="Dances made" value={fmt(k.dances)} />
        <Stat label="Made a dance" value={pct(k.creators, k.visitors)} note={`${fmt(k.creators)} visitors`} />
        <Stat label="Live takes" value={fmt(k.live)} />
        <Stat label="Dancers added" value={fmt(k.added)} />
        <Stat label="Dances saved" value={fmt(k.saves)} />
        <Stat label="Events" value={fmt(k.events)} />
      </section>

      {days > 1 && (
        <section className="grid md:grid-cols-2 gap-6">
          <Bars title="Visitors per day (UTC)" rows={daily} field="visitors" />
          <Bars title="Dances made per day (UTC)" rows={daily} field="dances" />
        </section>
      )}

      <section className="grid lg:grid-cols-3 gap-6">
        <Card title="Funnel (unique visitors)">
          <table className="w-full"><tbody>
            {steps.map((s, i) => {
              const v = byStep.get(i + 1) ?? 0;
              return (
                <tr key={s} className="border-t border-border first:border-0">
                  <td className="py-1.5">{s}</td>
                  <td className="py-1.5 w-32"><div className="h-2 rounded-sm bg-foreground/70" style={{ width: `${first ? (v / first) * 100 : 0}%` }} /></td>
                  <td className="py-1.5 text-right tabular-nums w-14">{fmt(v)}</td>
                  <td className="py-1.5 text-right tabular-nums w-12 text-muted-foreground">{i ? pct(v, first) : ""}</td>
                </tr>
              );
            })}
          </tbody></table>
        </Card>
        <Tally title="Where dances come from" rows={sources} />
        <Tally title="Characters chosen" rows={looks} />
        <Tally title="Countries (visitors)" rows={countries} />
        <Tally title="Devices (visitors)" rows={devices} />
        <Tally title="Referrers (visitors)" rows={referrers} />
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <Card title="Events">
          <table className="w-full">
            <thead className="text-muted-foreground text-left"><tr><th className="font-normal pb-1">Event</th><th className="font-normal pb-1 text-right">Count</th><th className="font-normal pb-1 text-right">Visitors</th></tr></thead>
            <tbody>{names.map((r) => (
              <tr key={String(r.name)} className="border-t border-border"><td className="py-1 font-mono text-xs">{String(r.name)}</td><td className="py-1 text-right tabular-nums">{fmt(r.events)}</td><td className="py-1 text-right tabular-nums">{fmt(r.visitors)}</td></tr>
            ))}</tbody>
          </table>
          {!names.length && <Empty />}
        </Card>
        <Card title="Problems people hit">
          <table className="w-full"><tbody>{errors.map((r, i) => (
            <tr key={i} className="border-t border-border first:border-0 align-top"><td className="py-1 pr-3 font-mono text-xs whitespace-nowrap">{String(r.name)}</td><td className="py-1">{String(r.label) || "–"}</td><td className="py-1 text-right tabular-nums">{fmt(r.c)}</td></tr>
          ))}</tbody></table>
          {!errors.length && <Empty text="No failures in this range." />}
        </Card>
      </section>

      <Card title="Latest activity">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-muted-foreground text-left"><tr>{["Time (UTC)", "Event", "Details", "Visitor", "Where"].map((h) => <th key={h} className="font-normal pb-1 pr-4">{h}</th>)}</tr></thead>
            <tbody>{recent.map((r, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="py-1 pr-4 whitespace-nowrap tabular-nums text-muted-foreground">{new Date(String(r.ts)).toISOString().slice(5, 19).replace("T", " ")}</td>
                <td className="py-1 pr-4 font-mono text-xs whitespace-nowrap">{String(r.name)}</td>
                <td className="py-1 pr-4 text-xs text-muted-foreground">{describeProps(r.props)}</td>
                <td className="py-1 pr-4 font-mono text-xs">{String(r.visitor).slice(0, 8)}</td>
                <td className="py-1 whitespace-nowrap">{[r.country, r.device].filter(Boolean).join(" · ")}</td>
              </tr>
            ))}</tbody>
          </table>
          {!recent.length && <Empty />}
        </div>
      </Card>
    </main>
  );
}

function describeProps(p: unknown) {
  if (!p || typeof p !== "object") return "";
  return Object.entries(p as Row).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}: ${v}`).join(", ");
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-medium mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {note && <div className="text-muted-foreground text-xs mt-0.5">{note}</div>}
    </div>
  );
}

function Empty({ text = "Nothing recorded yet." }: { text?: string }) {
  return <p className="text-muted-foreground">{text}</p>;
}

function Tally({ title, rows }: { title: string; rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => n(r.c)));
  return (
    <Card title={title}>
      <table className="w-full"><tbody>{rows.map((r) => (
        <tr key={String(r.label)} className="border-t border-border first:border-0">
          <td className="py-1.5 pr-3 truncate max-w-48">{String(r.label ?? "?")}</td>
          <td className="py-1.5 w-28"><div className="h-2 rounded-sm bg-foreground/70" style={{ width: `${(n(r.c) / max) * 100}%` }} /></td>
          <td className="py-1.5 text-right tabular-nums w-14">{fmt(r.c)}</td>
        </tr>
      ))}</tbody></table>
      {!rows.length && <Empty />}
    </Card>
  );
}

/* One series per chart, so no legend: the title names it. Each bar has a
   hover title with its day and value; the tallest day is labelled directly. */
function Bars({ title, rows, field }: { title: string; rows: Row[]; field: string }) {
  const values = rows.map((r) => n(r[field]));
  const max = Math.max(1, ...values);
  const W = 600, H = 140, gap = 2, bw = Math.max(1, (W - gap * (rows.length - 1)) / rows.length);
  const peak = values.indexOf(Math.max(...values));
  return (
    <Card title={title}>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full h-auto" role="img" aria-label={title}>
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-border" strokeWidth={1} />
        {rows.map((r, i) => {
          const h = (values[i] / max) * (H - 16);
          const x = i * (bw + gap);
          return (
            <g key={String(r.day)}>
              <title>{`${r.day}: ${fmt(values[i])}`}</title>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {h > 0 && <path d={`M${x},${H} V${H - h + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, bw / 2)},-${Math.min(4, h)} H${x + bw - Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)} V${H} Z`} className="fill-foreground/70" />}
              {i === peak && values[i] > 0 && <text x={x + bw / 2} y={H - h - 4} textAnchor="middle" className="fill-muted-foreground text-[11px]">{fmt(values[i])}</text>}
            </g>
          );
        })}
        <text x={0} y={H + 14} className="fill-muted-foreground text-[11px]">{String(rows[0]?.day ?? "")}</text>
        <text x={W} y={H + 14} textAnchor="end" className="fill-muted-foreground text-[11px]">{String(rows.at(-1)?.day ?? "")}</text>
      </svg>
    </Card>
  );
}
