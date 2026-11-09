"use client";

/** Renders the plain-text triage answer as clear sections (no raw symbols). Headings are lines in CAPS ending with optional colon. */
export default function AnswerText({ text }) {
  if (!text) return null;
  const lines = text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").split("\n");
  const blocks = [];
  let cur = { title: null, rows: [] };
  const flush = () => { if (cur.title || cur.rows.length) blocks.push(cur); cur = { title: null, rows: [] }; };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (!l.trim()) continue;
    if (/^[A-Z][A-Z0-9 &/()'-]{3,60}:?$/.test(l.trim())) { flush(); cur.title = l.trim().replace(/:$/, ""); continue; }
    cur.rows.push(l.trim());
  }
  flush();
  return (
    <div className="answer-text">
      {blocks.map((b, i) => (
        <section key={i} className="answer-block" style={{ animationDelay: `${i * 80}ms` }}>
          {b.title && <h5>{b.title}</h5>}
          {b.rows.map((r, j) => {
            if (r.startsWith("$")) return <pre key={j} className="answer-cmd">{r}</pre>;
            const num = r.match(/^(\d+)[.)]\s+(.*)/);
            if (num) return <div key={j} className="answer-step"><span>{num[1]}</span><p>{num[2]}</p></div>;
            if (/^[-•*]\s+/.test(r)) return <div key={j} className="answer-bullet"><i />{r.replace(/^[-•*]\s+/, "")}</div>;
            return <p key={j}>{r}</p>;
          })}
        </section>
      ))}
    </div>
  );
}
