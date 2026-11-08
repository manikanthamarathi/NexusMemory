"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

export default function HeroTerminal() {
  const [activeStep, setActiveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [selectedScenario, setSelectedScenario] = useState("db-leak");

  const scenarios = {
    "db-leak": {
      title: "Production SEV1: Payment Gateway Database Pool Starvation",
      alert: "ALERT: payment-service p99 latency > 6200ms. Ingress HTTP 504 Gateway Timeouts. Logs: 'HikariPool-1 - Connection is not available, request timed out after 30000ms'. Deploy 4601 completed 35m ago.",
      matchId: "INC-101",
      resolver: "Manikanta Marathi (Principal SRE)",
      confidence: "98.6%",
      failedAction: "DO NOT restart pods (temporary 8-min relief). DO NOT scale replicas (exhausted Postgres max_connections).",
      fix: "Revert commit #4412 and set pool.maxLifetime=600000 in application.properties line 42.",
      diff: "- spring.datasource.hikari.maxLifetime=0\n+ spring.datasource.hikari.maxLifetime=600000",
      mttr: "4 minutes"
    },
    "cert-expiry": {
      title: "Production SEV2: Bank Webhook TLS Certificate Expiration",
      alert: "ALERT: Bank webhook settlement callbacks dropping. Ingress logs: 'SSL: CERTIFICATE_VERIFY_FAILED: certificate has expired' on webhooks.paynest.io.",
      matchId: "INC-107",
      resolver: "David Chen (Security Lead)",
      confidence: "99.2%",
      failedAction: "Bypassing proxy TLS verification was rejected by audit compliance filter.",
      fix: "Execute Certbot DNS challenge renewal and reload Envoy ingress secret.",
      diff: "+ ssl_certificate /etc/letsencrypt/live/webhooks.paynest.io/fullchain.pem;",
      mttr: "6 minutes"
    },
    "hydration": {
      title: "Frontend Anomaly: Next.js Server Component Hydration Mismatch",
      alert: "Error: Hydration failed because the initial UI does not match what was rendered on the server. Warning: Text content did not match server HTML.",
      matchId: "COMMUNITY-884",
      resolver: "Autonomous Web Intelligence (Next.js Core)",
      confidence: "98.1%",
      failedAction: "Accessing window or localStorage during initial SSR render pass.",
      fix: "Wrap browser-dependent calls in React useEffect() and declare 'use client'.",
      diff: "- const token = window.localStorage.getItem('auth');\n+ useEffect(() => { setToken(localStorage.getItem('auth')); }, []);",
      mttr: "2 minutes"
    }
  };

  const current = scenarios[selectedScenario];

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev >= 4 ? 0 : prev + 1));
    }, 2800);
    return () => clearInterval(interval);
  }, [isPlaying, selectedScenario]);

  return (
    <div className="terminal-window">
      <div className="terminal-header">
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div className="terminal-dots">
            <div className="terminal-dot red"></div>
            <div className="terminal-dot yellow"></div>
            <div className="terminal-dot green"></div>
          </div>
          <span className="mono" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            nexus-sre-agent --cluster=prod-us-east-1 --memory=hindsight-cloud
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <select
            style={{ width: "170px", padding: "4px 8px", fontSize: "11px", background: "#06080d", border: "1px solid var(--border-default)" }}
            value={selectedScenario}
            onChange={(e) => {
              setSelectedScenario(e.target.value);
              setActiveStep(0);
            }}
          >
            <option value="db-leak">Scenario: DB Pool Leak</option>
            <option value="cert-expiry">Scenario: TLS Cert Expiry</option>
            <option value="hydration">Scenario: React Hydration</option>
          </select>

          <button
            type="button"
            className="btn-executive-outline"
            style={{ padding: "4px 10px", fontSize: "11px" }}
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? "❚❚ Pause" : "▶ Resume"}
          </button>

          <button
            type="button"
            className="btn-executive-outline"
            style={{ padding: "4px 10px", fontSize: "11px" }}
            onClick={() => setActiveStep(0)}
          >
            ↺ Replay
          </button>
        </div>
      </div>

      <div className="terminal-body">
        <div style={{ opacity: activeStep >= 0 ? 1 : 0.3, transition: "opacity 0.4s" }}>
          <span style={{ color: "var(--status-rose)", fontWeight: "700" }}>[02:14:02 UTC] 🚨 INCOMING ANOMALY DETECTED:</span>
          <p style={{ color: "#f87171", marginTop: "2px" }}>{current.alert}</p>
        </div>

        {activeStep >= 1 && (
          <div style={{ marginTop: "14px", borderTop: "1px solid var(--border-subtle)", paddingTop: "10px" }}>
            <span style={{ color: "var(--text-muted)" }}>[02:14:03 UTC] 🔍 QUERYING HINDSIGHT CLOUD MEMORY BANK...</span>
            <p style={{ color: "var(--text-primary)" }}>
              Matched with <strong style={{ color: "var(--status-emerald)" }}>{current.matchId}</strong> (Previously resolved by <strong>{current.resolver}</strong> • Confidence: <strong style={{ color: "var(--status-emerald)" }}>{current.confidence}</strong>)
            </p>
          </div>
        )}

        {activeStep >= 2 && (
          <div style={{ marginTop: "14px", background: "rgba(244, 63, 94, 0.08)", border: "1px solid var(--status-rose-border)", borderRadius: "6px", padding: "10px" }}>
            <span style={{ color: "var(--status-rose)", fontWeight: "700" }}>⛔ NEGATIVE KNOWLEDGE CHECK (DO NOT REPEAT):</span>
            <p style={{ color: "#fca5a5", marginTop: "2px" }}>{current.failedAction}</p>
          </div>
        )}

        {activeStep >= 3 && (
          <div style={{ marginTop: "14px" }}>
            <span style={{ color: "var(--accent-white)", fontWeight: "700" }}>🔬 VERIFIED PATCH GENERATED BY AGENT:</span>
            <p style={{ color: "var(--text-muted)", marginTop: "2px" }}>{current.fix}</p>
            <div className="diff-box">
              {current.diff}
            </div>
          </div>
        )}

        {activeStep >= 4 && (
          <div style={{ marginTop: "14px", background: "var(--status-emerald-bg)", border: "1px solid var(--status-emerald-border)", borderRadius: "6px", padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong style={{ color: "var(--status-emerald)", fontSize: "14px" }}>
                ✅ AUTONOMOUS HEALING APPLIED • CLUSTER RESTORED
              </strong>
              <p style={{ color: "#a7f3d0", fontSize: "12px", marginTop: "2px" }}>
                p99 latency normalized to 280ms. Total resolution time: <strong>{current.mttr}</strong> (vs 45 min baseline).
              </p>
            </div>
            <Link href="/console" className="btn-executive-solid" style={{ padding: "6px 14px", fontSize: "12px" }}>
              Explore Console ➔
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
