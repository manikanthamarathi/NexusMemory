"use client";
import { useState } from "react";

export default function WhatIfSimulator({ apiFetch }) {
  const [simContext, setSimContext] = useState(
    "ALERT: payment-service p99 latency > 6000ms for 5m. HikariPool-1 connection timeout."
  );
  const [simAction, setSimAction] = useState("I want to restart the payment-service pods to clear hung worker threads.");
  const [impactResult, setImpactResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleRunSimulator = async () => {
    if (!simAction) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/simulate-what-if", {
        user_action: simAction,
        incident_context: simContext
      });
      setImpactResult(res);
    } catch (err) {
      alert("Simulation error: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card-panel">
        <div style={{ marginBottom: "16px" }}>
          <h4 style={{ fontSize: "16px", fontWeight: "700", color: "#fff" }}>Interactive Blast Radius Simulator</h4>
          <p style={{ color: "var(--text-muted)", fontSize: "12px" }}>Test commands, Kubernetes actions, or code modifications before running them in production.</p>
        </div>

        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>INCIDENT CONTEXT / ERROR MESSAGE</label>
            <input value={simContext} onChange={(e) => setSimContext(e.target.value)} />
          </div>

          <div>
            <label style={{ fontSize: "11px", color: "var(--accent-white)", fontWeight: "600" }}>ACTION YOU WANT TO TEST</label>
            <input value={simAction} onChange={(e) => setSimAction(e.target.value)} placeholder="e.g. restart pods / scale replicas / flush redis..." />
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn-executive-solid" onClick={handleRunSimulator} disabled={busy}>
              {busy ? "Evaluating Blast Radius..." : "Run What-If Impact Analysis"}
            </button>
          </div>
        </div>
      </div>

      {impactResult && (
        <div className="card-panel" style={{ borderLeft: "3px solid var(--accent-white)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div>
              <h4 style={{ fontSize: "15px", fontWeight: "700", color: "#fff" }}>Impact Analysis: {impactResult.risk_rating}</h4>
              <p style={{ color: "var(--text-muted)", fontSize: "12px" }}>Evaluated Action: "{impactResult.action}"</p>
            </div>
            <span className={`status-pill ${impactResult.confidence_score > 70 ? 'emerald' : 'rose'}`}>
              Confidence: {impactResult.confidence_score}%
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div style={{ background: "var(--bg-base)", padding: "16px", borderRadius: "8px" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "700" }}>PREDICTED OUTCOME:</div>
              <div style={{ fontSize: "13px", marginTop: "6px", color: "var(--text-primary)" }}>{impactResult.predicted_outcome}</div>

              <div style={{ fontSize: "11px", color: "var(--status-rose)", marginTop: "14px", fontWeight: "700" }}>WHAT HAPPENS IF EXECUTED:</div>
              <div style={{ fontSize: "13px", marginTop: "4px", color: "#fca5a5" }}>{impactResult.what_happens_if_changed}</div>
            </div>

            <div style={{ background: "var(--bg-base)", padding: "16px", borderRadius: "8px" }}>
              <div style={{ fontSize: "11px", color: "var(--accent-white)", fontWeight: "700" }}>TARGET FILE & LINE DIFF:</div>
              <div style={{ fontSize: "13px", marginTop: "6px", color: "#fff", fontFamily: "monospace" }}>
                File: <strong>{impactResult.target_file}</strong> (Line {impactResult.target_line})
              </div>

              <div className="diff-box">
                {impactResult.code_impact_diff}
              </div>

              <div style={{ fontSize: "11px", color: "var(--status-emerald)", marginTop: "12px", fontWeight: "700" }}>RECOMMENDED ALTERNATIVE:</div>
              <div style={{ fontSize: "13px", marginTop: "4px", color: "#86efac" }}>{impactResult.recommended_fix}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
