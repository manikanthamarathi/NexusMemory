"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
const tok = () => { try { return localStorage.getItem("nexus_token") || ""; } catch { return ""; } };
const msg = (d, fallback) => (typeof d === "string" ? d : d?.message || d?.detail?.message || (typeof d?.detail === "string" ? d.detail : "") || fallback);

async function call(path, { method = "GET", body, form } = {}) {
  const headers = { Authorization: `Bearer ${tok()}` };
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try { res = await fetch(API + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) }); }
  catch { throw new Error("Cannot reach the server. Is the backend running?"); }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(msg(data, `Request failed (${res.status})`)); e.status = res.status; throw e; }
  return data;
}
const fmtMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + " min" : ""}`);
const ago = (iso) => { const s = (Date.now() - new Date(iso + "Z").getTime()) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };

function Uploader({ value, onChange, max = 5, label }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");
  async function add(files) {
    setError("");
    let next = [...value];
    for (const f of Array.from(files).slice(0, Math.max(max - value.length, 0))) {
      setBusy((b) => b + 1);
      try { const fd = new FormData(); fd.append("file", f); next = [...next, await call("/api/guided/files", { method: "POST", form: fd })]; onChange(next); }
      catch (e) { setError(`${f.name}: ${e.message}`); }
      finally { setBusy((b) => b - 1); }
    }
  }
  const remove = async (a) => { onChange(value.filter((x) => x.id !== a.id)); try { await call(`/api/guided/files/${a.id}`, { method: "DELETE" }); } catch { /* ignore */ } };
  return (
    <div onPaste={(e) => { const fs = Array.from(e.clipboardData?.files || []); if (fs.length) { e.preventDefault(); add(fs); } }}>
      <div className={`gt-drop ${over ? "over" : ""}`} tabIndex={0} role="button" onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <span style={{ fontSize: 20 }}>⬆</span>
        <div><strong>{label}</strong><div style={{ fontSize: 11, color: "var(--text-muted)" }}>Drop files, click, or paste a screenshot. Images, PDF, Word, logs and text up to 10 MB.</div></div>
        <input ref={input} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>
      {error && <div className="gt-note error" role="alert">{error}</div>}
      {(value.length > 0 || busy > 0) && (
        <ul className="gt-files">
          {value.map((a) => (
            <li key={a.id}><span className="gt-ext">{a.kind === "image" ? "IMG" : (a.filename.split(".").pop() || "DOC").slice(0, 4).toUpperCase()}</span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{a.filename}<span style={{ color: "var(--text-muted)" }}> · {(a.size / 1024).toFixed(0)} KB{a.kind === "document" && a.extraction === "ok" ? " · text read" : ""}</span></span>
              <button type="button" className="gt-link" onClick={() => remove(a)}>Remove</button></li>))}
          {busy > 0 && <li><span className="gt-spin" /> Uploading and checking {busy} file{busy > 1 ? "s" : ""}…</li>}
        </ul>
      )}
    </div>
  );
}

function Cmd({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="gt-cmd"><pre>{text}</pre>
      <button type="button" onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); }).catch(() => {})}>{ok ? "Copied" : "Copy"}</button></div>
  );
}

function Evidence({ list, sources }) {
  if (!list?.length) return null;
  return <>{list.map((l) => <span key={l} className="gt-chip" title={sources.find((s) => s.label === l)?.title}>{l}</span>)}</>;
}
const Grounding = ({ g }) => g === "memory" ? <span className="gt-badge ok">From your history</span> : <span className="gt-badge">General guidance</span>;

function ReportView({ r, sources }) {
  const a = r.response;
  return (
    <div className="gt-report">
      <div className="gt-meta">{r.user_name} · {ago(r.created_at)}</div>
      <p style={{ margin: "6px 0" }}>{r.message}</p>
      {r.attachments.length > 0 && <div className="gt-chips">{r.attachments.map((x) => <a key={x.id} className="gt-chip file" href={`${API}/api/guided/files/${x.id}?token=${tok()}`} target="_blank" rel="noreferrer">{x.filename}</a>)}</div>}
      {r.error && <div className="gt-note warn">{r.error} Your report is saved. You can send another.</div>}
      {a && (
        <div className="gt-answer">
          <h6>What we understood</h6><p>{a.understanding}</p>
          {a.likely_reason && <><h6>Most likely reason</h6><p>{a.likely_reason}</p></>}
          <h6>Try this</h6>
          <ol>{a.fixes.map((f, i) => <li key={i}><strong>{f.title}</strong> <Evidence list={f.evidence} sources={sources} /><p>{f.how}</p>{f.command && <Cmd text={f.command} />}{f.expected && <p className="gt-meta">You should see: {f.expected}</p>}</li>)}</ol>
          {a.then && <p><strong>Then:</strong> {a.then}</p>}
          {a.escalate && <div className="gt-note error"><strong>Escalate now.</strong> {a.escalate_reason}</div>}
          {a.missing_info?.length > 0 && <><h6>It would help to know</h6><ul>{a.missing_info.map((m, i) => <li key={i}>{m}</li>)}</ul></>}
        </div>
      )}
    </div>
  );
}

function Step({ s, sid, closed, sources, reports, setData, isNext }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = reports.filter((r) => r.step_id === s.id);
  const tick = async () => { try { setData(await call(`/api/guided/sessions/${sid}/steps/${s.id}`, { method: "PUT", body: { done: !s.done } })); } catch (e) { setError(e.message); } };
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try { setData(await call(`/api/guided/sessions/${sid}/steps/${s.id}/reports`, { method: "POST", body: { message: text, attachment_ids: files.map((f) => f.id) } })); setText(""); setFiles([]); setOpen(false); }
    catch (er) { setError(er.message); }
    setBusy(false);
  };
  return (
    <li className={`gt-step ${s.done ? "done" : ""} ${isNext ? "next" : ""}`} style={{ animationDelay: `${s.number * 70}ms` }}>
      <div className="gt-rail"><button type="button" role="checkbox" aria-checked={s.done} disabled={closed} className="gt-tick" onClick={tick} aria-label={`Mark step ${s.number} ${s.done ? "not done" : "done"}`}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></button><span className="gt-line" /></div>
      <div className="gt-body">
        <div className="gt-top"><span className="gt-num">Step {s.number}</span><Grounding g={s.grounding} />{s.risk !== "low" && <span className={`gt-badge ${s.risk === "high" ? "bad" : "warn"}`}>{s.risk} risk</span>}<Evidence list={s.evidence} sources={sources} />{isNext && !s.done && <span className="gt-badge accent">Do this next</span>}</div>
        <h4>{s.title}</h4>
        {s.why && <p className="gt-why">{s.why}</p>}
        <p>{s.how}</p>
        {s.command && <Cmd text={s.command} />}
        {s.expected && <p className="gt-expect"><strong>You should see:</strong> {s.expected}</p>}
        {mine.map((r) => <ReportView key={r.id} r={r} sources={sources} />)}
        {error && !open && <div className="gt-note error">{error}</div>}
        {!closed && !open && <button type="button" className="gt-ghost" onClick={() => setOpen(true)}>{mine.length ? "Report another problem" : "Problem with this step?"}</button>}
        {open && (
          <form className="gt-form" onSubmit={send}>
            <strong>Problem with step {s.number}: {s.title}</strong>
            {error && <div className="gt-note error" role="alert">{error}</div>}
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} minLength={3} maxLength={6000} required autoFocus placeholder="What happened? Paste the exact error or describe what you saw instead." />
            <Uploader value={files} onChange={setFiles} max={6} label="Add a screenshot, log or document" />
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="submit" className="btn-solid-primary" disabled={busy || text.trim().length < 3}>{busy ? "Reading your report…" : "Send and get help"}</button>
              <button type="button" className="gt-ghost" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

function Chart({ chart }) {
  const max = Math.max(...chart.bars.map((b) => b.minutes), chart.median, 1);
  return (
    <div className="gt-chart">
      {chart.bars.map((b, i) => (
        <div className="gt-bar" key={b.label}>
          <div className="gt-bl"><span>{b.label}</span><small title={b.title}>{b.title}</small></div>
          <div className="gt-track" role="img" aria-label={`${b.label} took ${fmtMin(b.minutes)}`}>
            <div className="gt-fill" style={{ width: `${Math.max((b.minutes / max) * 100, 2)}%`, animationDelay: `${i * 90}ms` }} />
            {chart.bars.length > 1 && <i className="gt-median" style={{ left: `${(chart.median / max) * 100}%` }} />}
          </div>
          <div className="gt-bv">{fmtMin(b.minutes)}</div>
        </div>
      ))}
      {chart.bars.length > 1 && <div className="gt-meta">Median {fmtMin(chart.median)} across {chart.bars.length} earlier sessions</div>}
    </div>
  );
}

export default function GuidedTriage({ alertText, user }) {
  const [signedIn, setSignedIn] = useState(true);
  const [cfg, setCfg] = useState(null);
  const [list, setList] = useState([]);
  const [t, setT] = useState(null);
  const [files, setFiles] = useState([]);
  const [service, setService] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState("");
  const topRef = useRef(null);

  const refresh = useCallback(async () => {
    try { const [c, l] = await Promise.all([call("/api/guided/status"), call("/api/guided/sessions")]); setCfg(c); setList(l.items); setSignedIn(true); }
    catch (e) { if (e.status === 401) setSignedIn(false); else setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!busy) return; setPhase(0); const i = setInterval(() => setPhase((p) => Math.min(p + 1, 2)), 2600); return () => clearInterval(i); }, [busy]);

  async function build() {
    setBusy(true); setError("");
    try { const s = await call("/api/guided/sessions", { method: "POST", body: { alert_text: alertText, service: service || null, attachment_ids: files.map((f) => f.id) } }); setT(s); setFiles([]); refresh(); setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }
  async function open(id) { try { setT(await call(`/api/guided/sessions/${id}`)); setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); } catch (e) { setError(e.message); } }
  async function finish(path) { try { const r = await call(`/api/guided/sessions/${t.id}/${path}`, { method: "POST" }); setT(r); refresh(); } catch (e) { setError(e.message); } }

  if (!signedIn) return (
    <div className="card-panel gt-root"><div className="card-header-bar"><h4>Guided step-by-step remediation</h4></div>
      <p style={{ color: "var(--text-secondary)" }}>Sign in to build a plan, tick steps and report problems. <Link href="/login" style={{ color: "var(--brand-accent)" }}>Go to sign in</Link></p></div>
  );

  const nextIdx = t ? t.steps.findIndex((s) => !s.done) : -1;
  const closed = t?.status === "resolved";
  const memKind = { used: "ok", empty: "warn", unavailable: "error" }[t?.memory.state] || "warn";
  const PH = ["Reading your alert", "Searching your team's memory", "Writing your plan"];

  return (
    <div className="gt-root" ref={topRef}>
      <div className="card-panel">
        <div className="card-header-bar"><h4>Guided step-by-step remediation</h4><span className="status-pill emerald">Tick each step as you go</span></div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>Builds an ordered plan from the alert above, grounded in what your team has recorded. If a step fails, report it on that step with a screenshot or log.</p>
        {cfg && !cfg.ai_configured && <div className="gt-note error">The AI model is not configured on this server (GROQ_API_KEY is missing). Plans cannot be built yet.</div>}
        {cfg && cfg.ai_configured && !cfg.memory_live && <div className="gt-note warn">Hindsight is not connected, so memory only contains what this server has recorded since it started.</div>}
        {error && <div className="gt-note error" role="alert">{error}</div>}
        <input className="gt-input" value={service} onChange={(e) => setService(e.target.value)} placeholder="Service (optional), for example payment-service" maxLength={100} />
        <Uploader value={files} onChange={setFiles} max={5} label="Attach screenshots, logs or documents for this alert" />
        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn-solid-primary" onClick={build} disabled={busy || alertText.trim().length < 10 || (cfg && !cfg.ai_configured)}>{busy ? "Building your plan…" : "Build step-by-step plan ➔"}</button>
          {busy && <div className="gt-phases">{PH.map((p, i) => <span key={p} className={i < phase ? "done" : i === phase ? "now" : ""}>{p}</span>)}</div>}
        </div>
        {list.length > 0 && (
          <div className="gt-recent"><span className="gt-meta">Recent sessions</span>
            {list.slice(0, 6).map((s) => <button key={s.id} type="button" className={`gt-sess ${t?.id === s.id ? "on" : ""}`} onClick={() => open(s.id)}><b>{s.reference}</b><span>{s.headline}</span><small>{s.progress.done}/{s.progress.total} · {s.status}</small></button>)}
          </div>
        )}
      </div>

      {t && (
        <div className="gt-plan">
          <div className="card-panel gt-head">
            <div className="gt-top"><span className="gt-num">{t.reference}</span>{t.service && <span className="gt-badge">{t.service}</span>}<span className={`gt-badge ${closed ? "ok" : "warn"}`}>{t.status}</span></div>
            <h3 className="gt-headline">{t.headline}</h3>
            <div className="gt-progress-wrap"><div className="gt-prog-text"><strong>{t.progress.done} of {t.progress.total} steps complete</strong><span>{t.progress.done === t.progress.total ? "All steps done" : "Tick each step when finished"}</span></div>
              <div className="gt-progress" role="progressbar" aria-valuenow={t.progress.done} aria-valuemax={t.progress.total}><div style={{ width: `${(t.progress.done / Math.max(t.progress.total, 1)) * 100}%` }} /></div></div>
            <div className={`gt-note ${memKind}`}><strong>{t.memory.state === "used" ? "Based on your team's history." : t.memory.state === "empty" ? "No related history found." : "Memory unavailable."}</strong> {t.memory.note}</div>
          </div>

          <div className="gt-two">
            <div className="card-panel"><h5 className="gt-h">What we know</h5><ul className="gt-list">{t.what_we_know.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
            <div className="card-panel gt-cause"><div className="gt-top"><h5 className="gt-h" style={{ margin: 0 }}>Most likely cause</h5><Grounding g={t.likely_cause.grounding} /><Evidence list={t.likely_cause.evidence} sources={t.memory.sources} /></div><p style={{ margin: "8px 0 0" }}>{t.likely_cause.text}</p></div>
          </div>

          {t.chart && <div className="card-panel"><h5 className="gt-h">How long earlier sessions took</h5><p className="gt-meta" style={{ margin: "0 0 10px" }}>From triage sessions your team closed before. Real durations only.</p><Chart chart={t.chart} /></div>}

          <h5 className="gt-h" style={{ margin: "22px 0 10px" }}>Do these in order</h5>
          <ol className="gt-steps">{t.steps.map((s, i) => <Step key={s.id} s={s} sid={t.id} closed={closed} sources={t.memory.sources} reports={t.reports} setData={setT} isNext={i === nextIdx} />)}</ol>

          {t.avoid.length > 0 && <div className="card-panel gt-avoid"><h5 className="gt-h">Do not do this</h5><ul className="gt-list">{t.avoid.map((a, i) => <li key={i}><strong>{a.action}.</strong> {a.reason} <Evidence list={a.evidence} sources={t.memory.sources} /></li>)}</ul></div>}
          {t.escalate_if.length > 0 && <div className="card-panel gt-escalate"><h5 className="gt-h">Escalate if</h5><ul className="gt-list">{t.escalate_if.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
          {t.gaps.length > 0 && <div className="card-panel"><h5 className="gt-h">What we could not tell</h5><ul className="gt-list">{t.gaps.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
          {t.memory.sources.length > 0 && <div className="card-panel"><h5 className="gt-h">Sources from memory</h5><ul className="gt-list">{t.memory.sources.map((s) => <li key={s.label}><span className="gt-chip">{s.label}</span> {s.title}{s.resolved_by && <span className="gt-meta"> · resolved by {s.resolved_by}</span>}</li>)}</ul></div>}

          <div className="card-panel gt-finish">
            {closed ? <><strong>Session closed.</strong> <span className="gt-meta">What you did and the problems you hit were saved to memory.</span> <button type="button" className="gt-ghost" onClick={() => finish("reopen")}>Reopen</button></>
              : <><div><strong>{t.progress.done === t.progress.total ? "All steps done. Is the problem fixed?" : "Finished early?"}</strong><div className="gt-meta">Closing saves the steps you completed and the problems you reported, so the next engineer benefits.</div></div><button type="button" className="btn-solid-primary" onClick={() => finish("complete")}>Mark resolved</button></>}
          </div>
        </div>
      )}
    </div>
  );
}
