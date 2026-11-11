import Link from "next/link";
import { SCENES } from "@/lib/examples";

export const metadata = {
  title: "Examples",
  description: "Gal Gorfung's dance, five ways: solo, group, canon, traces, and inside the video.",
};

/** /example — every scene, each opening straight into the studio. */
export default function ExamplesIndex() {
  return (
    <main className="ex-index">
      <style>{`
        .ex-index { min-height: 100vh; background: #050505; color: #f2f2ee; padding: 56px 24px 80px; font-family: var(--font-geist-sans), system-ui, sans-serif; }
        .ex-wrap { max-width: 1180px; margin: 0 auto; }
        .ex-top { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 48px; }
        .ex-top a { color: #b8b8b2; text-decoration: none; font-size: 15px; }
        .ex-top a:hover { color: #fff; }
        .ex-head h1 { font-size: clamp(40px, 6vw, 72px); line-height: 1; letter-spacing: -0.03em; font-weight: 600; margin: 0 0 16px; }
        .ex-head p { color: #a3a39d; font-size: 18px; max-width: 620px; margin: 0 0 48px; line-height: 1.5; }
        .ex-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
        .ex-card { display: block; color: inherit; text-decoration: none; background: #111113; border: 1px solid #222226; border-radius: 16px; overflow: hidden; transition: border-color .15s, transform .15s; }
        .ex-card:hover { border-color: #55555c; transform: translateY(-2px); }
        .ex-card:focus-visible { outline: 2px solid #8cc4ff; outline-offset: 3px; }
        .ex-shot { aspect-ratio: 16 / 10; background: #000; overflow: hidden; }
        .ex-shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .ex-body { padding: 18px 20px 22px; }
        .ex-body h2 { font-size: 20px; font-weight: 600; margin: 0 0 6px; }
        .ex-body p { color: #a3a39d; font-size: 15px; line-height: 1.45; margin: 0; }
        .ex-body span { display: inline-block; margin-top: 14px; font-size: 14px; color: #8cc4ff; }
        .ex-foot { margin-top: 56px; color: #6f6f69; font-size: 14px; }
      `}</style>
      <div className="ex-wrap">
        <nav className="ex-top" aria-label="Site">
          <Link href="/">← Visual Elbow</Link>
          <Link href="/">Create your own dance</Link>
        </nav>
        <header className="ex-head">
          <h1>One dance, five ways.</h1>
          <p>Gal Gorfung dancing in his living room, tracked once and opened five ways. Each one opens in the studio, ready to play.</p>
        </header>
        <div className="ex-grid">
          {Object.entries(SCENES).map(([id, s]) => (
            <Link key={id} href={`/example/${id}`} className="ex-card">
              <div className="ex-shot">
                {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots */}
                <img src={`/examples/scenes/${id}.jpg`} alt={`${s.title}: ${s.detail}`} loading="lazy" />
              </div>
              <div className="ex-body">
                <h2>{s.title}</h2>
                <p>{s.detail}</p>
                <span>Open →</span>
              </div>
            </Link>
          ))}
        </div>
        <p className="ex-foot">Everything runs in your browser. Nothing is uploaded.</p>
      </div>
    </main>
  );
}
