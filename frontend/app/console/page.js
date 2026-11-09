"use client";
import Link from "next/link";
import HeroTerminal from "../components/HeroTerminal";

export default function EnterpriseLandingPage() {
  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
      {/* 1. ENTERPRISE NAVBAR */}
      <nav className="enterprise-navbar">
        <div className="brand-wrapper">
          <div className="brand-dot"></div>
          <span className="brand-title">NexusMemory</span>
          <span className="status-pill emerald" style={{ fontSize: "10px" }}>Enterprise SRE v5.0</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <a href="#demo" style={{ color: "var(--text-secondary)", fontSize: "13px", fontWeight: "600" }}>Live Simulator</a>
          <a href="#features" style={{ color: "var(--text-secondary)", fontSize: "13px", fontWeight: "600" }}>Architecture</a>
          <Link href="/login" className="btn-executive-outline" style={{ padding: "8px 16px", fontSize: "13px" }}>
            Sign In with SSO
          </Link>
          <Link href="/register" className="btn-executive-solid" style={{ padding: "8px 18px", fontSize: "13px" }}>
            Verify In-Office Badge ➔
          </Link>
        </div>
      </nav>

      {/* 2. HERO SECTION */}
      <section className="hero-wrapper">
        <div className="hero-pill">
          <span style={{ color: "var(--status-emerald)" }}>●</span> HINDSIGHT AGENT MEMORY • ZERO OPERATIONAL AMNESIA
        </div>

        <h1 className="hero-title">
          Institutional Memory for SRE Teams.<br />
          Zero Repeat Production Outages.
        </h1>

        <p className="hero-subtitle">
          Stateless AI forgets every outage the second a ticket closes. NexusMemory connects your engineering teams to Hindsight Cloud memory—turning past post-mortems into an autonomous, self-healing knowledge graph.
        </p>

        <div className="hero-actions">
          <Link href="/console" className="btn-executive-solid" style={{ padding: "14px 28px", fontSize: "15px" }}>
            Launch SRE Command Console ➔
          </Link>
          <Link href="/register" className="btn-executive-outline" style={{ padding: "14px 28px", fontSize: "15px" }}>
            Verify Employee In-Office Badge
          </Link>
        </div>

        {/* 3. RUNNING LIVE INTERACTIVE SRE TERMINAL (HERO VIDEO WIDGET) */}
        <div id="demo">
          <HeroTerminal />
        </div>

        {/* 4. THREE PILLARS */}
        <div id="features" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px", marginTop: "80px", textAlign: "left" }}>
          <div className="card-panel">
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <span style={{ fontSize: "20px" }}>🧠</span>
              <span className="status-pill emerald">Continuous Retain</span>
            </div>
            <h3 style={{ fontSize: "17px", color: "#fff", fontWeight: "700" }}>Institutional Matchmaking</h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "8px", lineHeight: "1.6" }}>
              When an outage hits, instantly surfaces the exact engineer in your company who solved it previously, their verified line patch, and direct contact details.
            </p>
          </div>

          <div className="card-panel">
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <span style={{ fontSize: "20px" }}>🔬</span>
              <span className="status-pill silver">Blast Radius Lab</span>
            </div>
            <h3 style={{ fontSize: "17px", color: "#fff", fontWeight: "700" }}>What-If Line Diff Simulator</h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "8px", lineHeight: "1.6" }}>
              Simulates terminal commands and code modifications before running them in production—evaluating risk, predicting side-effects, and pinpointing exact line numbers.
            </p>
          </div>

          <div className="card-panel">
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <span style={{ fontSize: "20px" }}>⚡</span>
              <span className="status-pill amber">Self-Healing</span>
            </div>
            <h3 style={{ fontSize: "17px", color: "#fff", fontWeight: "700" }}>Autonomous Confidence Pipeline</h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "8px", lineHeight: "1.6" }}>
              Safely auto-applies verified patches when confidence exceeds 90%. When under threshold, automatically escalates to senior engineering leads with full research summaries.
            </p>
          </div>
        </div>

        {/* 5. PHYSICAL OFFICE SECURITY CALLOUT */}
        <div className="card-panel" style={{ marginTop: "40px", padding: "32px", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", flexWrap: "wrap", gap: "20px" }}>
          <div>
            <span className="status-pill emerald" style={{ marginBottom: "10px" }}>Zero-Trust Corporate Geofencing</span>
            <h3 style={{ fontSize: "20px", color: "#fff", fontWeight: "700", marginTop: "6px" }}>Physical In-Office Presence Verification</h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "6px", maxWidth: "600px" }}>
              Validates on-campus presence using real GPS geofencing and corporate Wi-Fi telemetry before granting access to mission-critical production memory banks.
            </p>
          </div>

          <Link href="/register" className="btn-executive-solid" style={{ padding: "12px 24px" }}>
            Verify Employee Badge ➔
          </Link>
        </div>
      </section>

      {/* 6. FOOTER */}
      <footer style={{ borderTop: "1px solid var(--border-subtle)", padding: "30px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", color: "var(--text-muted)", maxWidth: "1280px", margin: "0 auto" }}>
        <div>
          NexusMemory Enterprise Core • Powered by <a href="https://github.com/vectorize-io/hindsight" target="_blank" rel="noreferrer" style={{ color: "#fff", fontWeight: "600" }}>Hindsight Agent Memory</a> & <a href="https://groq.com" target="_blank" rel="noreferrer" style={{ color: "#fff", fontWeight: "600" }}>Groq LPU</a>.
        </div>
        <div style={{ display: "flex", gap: "20px" }}>
          <Link href="/console" style={{ color: "var(--text-secondary)" }}>Console</Link>
          <Link href="/login" style={{ color: "var(--text-secondary)" }}>Sign In</Link>
          <Link href="/register" style={{ color: "var(--text-secondary)" }}>Register</Link>
        </div>
      </footer>
    </div>
  );
}
