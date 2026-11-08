"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import WhatIfSimulator from "../../components/WhatIfSimulator";
import KnowledgeVault from "../../components/KnowledgeVault";
import InteractiveRemediationStepper from "../../components/InteractiveRemediationStepper";

const API = process.env.NEXT_PUBLIC_API || "http://localhost:8000";

const apiFetch = async (endpoint, body = null, method = "POST") => {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(API + endpoint, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `HTTP ${res.status}`);
  }
  return res.json();
};

export default function RealEnterpriseConsole() {
  const [activeModule, setActiveModule] = useState("triage");
  const [currentTheme, setCurrentTheme] = useState("obsidian"); // obsidian, slate, tokyo, light
  
  // Real SQLite Data
  const [employees, setEmployees] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedPrj, setSelectedPrj] = useState("PRJ-PAYCORE");
  const [solutions, setSolutions] = useState([]);
  
  // Live Triage State
  const [promptText, setPromptText] = useState(
    "ALERT: payment-service p99 latency > 6000ms for 5m. Ingress HTTP 504 Gateway Timeout spiking on /v2/charge. Logs: 'HikariPool-1 - Connection is not available, request timed out after 30000ms'. Deploy 4601 completed 35 minutes ago."
  );
  const [triageData, setTriageData] = useState(null);
  const [statelessData, setStatelessData] = useState(null);

  // Systemic Risk Patterns
  const [patternsReport, setPatternsReport] = useState(null);

  // Ingestion state
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");

  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState({ online: true, mode: "Hindsight Cloud Live" });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", currentTheme);
  }, [currentTheme]);

  useEffect(() => {
    // Check if session user cached
    const cached = localStorage.getItem("nexus_active_user");
    let cachedUser = null;
    if (cached) {
      try { 
        cachedUser = JSON.parse(cached);
        setSelectedUser(cachedUser);
      } catch (e) {}
    }

    // Fetch from real SQLite backend
    apiFetch("/api/employees", null, "GET").then((data) => {
      setEmployees(data);
      if (!cachedUser && data.length > 0) {
        setSelectedUser(data[0]);
      }
    }).catch(() => {});

    apiFetch("/api/projects", null, "GET").then(setProjects).catch(() => {});
    apiFetch("/api/solutions", null, "GET").then(setSolutions).catch(() => {});

    apiFetch("/api/health", null, "GET")
      .then((data) => setStatus({ online: true, mode: data.hindsight_live ? "Hindsight Cloud Live" : "Hindsight Fallback" }))
      .catch(() => setStatus({ online: false, mode: "Offline" }));
  }, []);

  const handleTriage = async () => {
    setBusy("triage");
    try {
      const [resMem, resStateless] = await Promise.all([
        apiFetch("/api/triage", {
          user_id: selectedUser?.id || "EMP-1042",
          project_id: selectedPrj,
          alert_text: promptText,
          proposed_step: null,
          use_memory: true
        }),
        apiFetch("/api/triage", {
          user_id: selectedUser?.id || "EMP-1042",
          project_id: selectedPrj,
          alert_text: promptText,
          proposed_step: null,
          use_memory: false
        })
      ]);
      setTriageData(resMem);
      setStatelessData(resStateless);
    } catch (err) {
      alert("Triage error: " + err.message);
    } finally {
      setBusy("");
    }
  };

  const handleRunPatterns = async () => {
    setBusy("patterns");
    try {
      const data = await apiFetch("/api/patterns");
      setPatternsReport(data);
    } catch (err) {
      alert("Pattern reflection error: " + err.message);
    } finally {
      setBusy("");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadStatus(`Parsing & ingesting ${file.name}...`);
    const formData = new FormData();
    formData.append("file", file);
    if (uploadNotes) formData.append("notes", uploadNotes);

    try {
      const res = await fetch(API + "/api/upload-multimodal", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setUploadStatus(`✅ ${file.name} ingested & retained in Hindsight memory graph!`);
    } catch (err) {
      setUploadStatus(`❌ Ingestion failed: ${err.message}`);
    }
  };

  return (
    <div className="app-shell">
      {/* 1. LEFT SIDEBAR */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-symbol">N</div>
          <div className="brand-details">
            <h2>NexusMemory</h2>
            <span>Enterprise SRE Core</span>
          </div>
        </div>

        {/* User Identity Card from SQLite */}
        {selectedUser && (
          <div className="user-widget">
            <div className="user-profile">
              <img 
                src={selectedUser.avatar || "https://api.dicebear.com/7.x/bottts/svg?seed=User"} 
                alt="Avatar" 
                className="user-avatar" 
                style={{ width: "44px", height: "44px", borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
              />
              <div className="user-meta" style={{ minWidth: 0, overflow: "hidden" }}>
                <h4 style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedUser.name}</h4>
                <p>{selectedUser.id}</p>
              </div>
            </div>
            
            <div className="office-verified-badge">
              <span>●</span> {selectedUser.verified_campus || "In-Office (Hyderabad Campus)"}
            </div>

            <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
              <span>Role: <strong style={{ color: "var(--text-primary)" }}>{selectedUser.role?.split(" ")[0]}</strong></span>
              <span>Dist: <strong>{selectedUser.verified_distance_km || 0.3} km</strong></span>
            </div>

            {/* Switch Active User Dropdown */}
            <select
              style={{ marginTop: "8px", padding: "6px 8px", fontSize: "11px", background: "var(--bg-base)" }}
              value={selectedUser.id}
              onChange={(e) => {
                const u = employees.find(x => x.id === e.target.value);
                if (u) {
                  setSelectedUser(u);
                  localStorage.setItem("nexus_active_user", JSON.stringify(u));
                  setSelectedPrj(u.current_project_id || "PRJ-PAYCORE");
                }
              }}
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.id})</option>
              ))}
            </select>
          </div>
        )}

        {/* Navigation Modules (Vertical List) */}
        <nav className="sidebar-nav">
          <button className={`nav-button ${activeModule === "triage" ? "active" : ""}`} onClick={() => setActiveModule("triage")}>
            <div className="nav-item-left">
              <span>⚡</span>
              <span>Triage Center</span>
            </div>
            <span className="status-pill emerald" style={{ fontSize: "9px" }}>Core</span>
          </button>

          <button className={`nav-button ${activeModule === "simulator" ? "active" : ""}`} onClick={() => setActiveModule("simulator")}>
            <div className="nav-item-left">
              <span>🔬</span>
              <span>What-If Lab</span>
            </div>
            <span className="status-pill emerald" style={{ fontSize: "9px" }}>Diff</span>
          </button>

          <button className={`nav-button ${activeModule === "vault" ? "active" : ""}`} onClick={() => setActiveModule("vault")}>
            <div className="nav-item-left">
              <span>📚</span>
              <span>Knowledge Vault</span>
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{solutions.length}</span>
          </button>

          <button className={`nav-button ${activeModule === "projects" ? "active" : ""}`} onClick={() => setActiveModule("projects")}>
            <div className="nav-item-left">
              <span>🏢</span>
              <span>Client Workspaces</span>
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{projects.length}</span>
          </button>

          <button className={`nav-button ${activeModule === "patterns" ? "active" : ""}`} onClick={() => { setActiveModule("patterns"); if (!patternsReport) handleRunPatterns(); }}>
            <div className="nav-item-left">
              <span>🧠</span>
              <span>Systemic Risk</span>
            </div>
          </button>

          <button className={`nav-button ${activeModule === "ingest" ? "active" : ""}`} onClick={() => setActiveModule("ingest")}>
            <div className="nav-item-left">
              <span>📁</span>
              <span>Asset Ingestion</span>
            </div>
          </button>
        </nav>

        {/* Live Theme Switcher */}
        <div style={{ marginTop: "auto", paddingTop: "14px", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: "600" }}>
            🎨 UI COLOR THEME:
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <button 
              type="button" 
              className={`theme-select-btn ${currentTheme === "obsidian" ? "active" : ""}`}
              onClick={() => setCurrentTheme("obsidian")}
            >
              Obsidian Zinc
            </button>
            <button 
              type="button" 
              className={`theme-select-btn ${currentTheme === "slate" ? "active" : ""}`}
              onClick={() => setCurrentTheme("slate")}
            >
              Slate FinTech
            </button>
            <button 
              type="button" 
              className={`theme-select-btn ${currentTheme === "tokyo" ? "active" : ""}`}
              onClick={() => setCurrentTheme("tokyo")}
            >
              Tokyo Night
            </button>
            <button 
              type="button" 
              className={`theme-select-btn ${currentTheme === "light" ? "active" : ""}`}
              onClick={() => setCurrentTheme("light")}
            >
              Clean Light
            </button>
          </div>

          <div style={{ marginTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
            <Link href="/" style={{ color: "var(--status-emerald)", textDecoration: "none" }}>← Public Portal</Link>
            <Link href="/register" style={{ color: "var(--text-muted)", textDecoration: "none" }}>Register Badge</Link>
          </div>
        </div>
      </aside>

      {/* 2. MAIN CONSOLE CONTENT */}
      <main className="app-main">
        {/* Top Header */}
        <header className="app-header">
          <div className="header-title">
            <h3>
              {activeModule === "triage" && "⚡ Real-Time Triage Command Center"}
              {activeModule === "simulator" && "🔬 Interactive Blast Radius Simulator"}
              {activeModule === "vault" && "📚 SQLite Institutional Knowledge Vault"}
              {activeModule === "projects" && "🏢 Workspaces & Client Project Registry"}
              {activeModule === "patterns" && "🧠 Systemic Risk & Recurring Pattern Analysis"}
              {activeModule === "ingest" && "📁 Multimodal Ingestion (Logs, Code & Screenshots)"}
            </h3>
            <p>
              {activeModule === "triage" && "Grounded in persistent SQLite employee records & live Hindsight Cloud memory"}
              {activeModule === "simulator" && "Simulate commands and code modifications before running them in production"}
              {activeModule === "vault" && "Searchable database of past incident post-mortems and verified line patches"}
              {activeModule === "projects" && "Production client environments with SLA tracking and assigned leads"}
              {activeModule === "patterns" && "Autonomous cross-incident synthesis powered by Hindsight reflect()"}
              {activeModule === "ingest" && "Ingest error screenshots, architecture specs, or code files into memory"}
            </p>
          </div>

          <div className="header-badges">
            <span className="status-pill emerald">● {status.mode}</span>
            <span className="status-pill silver">Groq OSS-120B</span>
            <span className="status-pill amber">{selectedPrj}</span>
          </div>
        </header>

        {/* MODULE 1: TRIAGE */}
        {activeModule === "triage" && (
          <div className="module-container">
            {/* Quick-Select Outage Scenario Pills */}
            <div style={{ marginBottom: "16px" }}>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "700" }}>
                Select Outage Scenario:
              </span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                <button
                  type="button"
                  className="scenario-btn"
                  onClick={() => setPromptText("ALERT: payment-service p99 latency > 6000ms for 5m. Ingress HTTP 504 Gateway Timeout spiking on /v2/charge. Logs: 'HikariPool-1 - Connection is not available, request timed out after 30000ms'. Deploy 4601 completed 35 minutes ago.")}
                >
                  HikariPool DB Leak (SEV1)
                </button>
                <button
                  type="button"
                  className="scenario-btn"
                  onClick={() => setPromptText("ALERT: Bank payment webhook callback failure rate > 40%. Logs: 'SSL: CERTIFICATE_VERIFY_FAILED: certificate has expired' on webhooks.paynest.io endpoint during Razorpay callback.")}
                >
                  Ingress TLS Cert Expired (SEV2)
                </button>
                <button
                  type="button"
                  className="scenario-btn"
                  onClick={() => setPromptText("ALERT: Redis primary memory at 98.7%. Eviction counter climbing at 1200 keys/sec. Customers reporting premature session logouts across iOS and Web apps.")}
                >
                  Redis Infinite TTL Bloat (SEV2)
                </button>
                <button
                  type="button"
                  className="scenario-btn"
                  onClick={() => setPromptText("Error: Kubernetes node kernel OOM-killer invoked on pod checkout-service-v2 with exit code 137. Cgroup memory limit exceeded.")}
                >
                  Novel Bug: Docker Kernel OOM (Web Search)
                </button>
              </div>
            </div>

            {/* Input Card */}
            <div className="card-panel">
              <div className="card-header-bar">
                <h4>Active Incident Telemetry & Stack Trace</h4>
                <span className="status-pill emerald">Hindsight Semantic Recall</span>
              </div>

              <textarea
                rows={3}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Paste incoming incident alert, stack trace, or describe the bug..."
              />

              <div style={{ marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <button type="button" className="btn-solid-primary" onClick={handleTriage} disabled={!!busy}>
                  {busy === "triage" ? "Triage in Progress..." : "Execute Autonomous Triage & Self-Healing ➔"}
                </button>

                <button
                  type="button"
                  className="btn-outline-neutral"
                  onClick={() => setActiveModule("simulator")}
                >
                  Test Action in What-If Lab ➔
                </button>
              </div>
            </div>

            {/* Auto-Healing Banner */}
            {triageData?.self_healing?.attempted && (
              <div style={{ background: "var(--status-emerald-bg)", border: "1px solid var(--status-emerald-border)", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong style={{ color: triageData.self_healing.auto_healed ? "var(--status-emerald)" : "var(--status-amber)", fontSize: "14px" }}>
                    {triageData.self_healing.auto_healed ? "AUTONOMOUS SELF-HEALING EXECUTED (Confidence ≥ 90%)" : "SAFETY THRESHOLD: HUMAN ESCALATION DISPATCHED"}
                  </strong>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {triageData.self_healing.message}
                  </p>
                  <div style={{ fontSize: "12px", color: "var(--text-primary)", marginTop: "4px" }}>
                    <strong>Action:</strong> {triageData.self_healing.action_taken}
                  </div>
                </div>
                <span className={`status-pill ${triageData.self_healing.auto_healed ? "emerald" : "amber"}`}>
                  Score: {triageData.self_healing.confidence}%
                </span>
              </div>
            )}

            {/* Dual Triage Grid */}
            <div className="dual-triage-grid">
              {/* Left: Stateless Bot */}
              <div className="triage-column stateless">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div>
                    <h4 style={{ fontSize: "15px", color: "var(--text-primary)" }}>Stateless AI Agent</h4>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Zero Institutional Memory</span>
                  </div>
                  <span className="status-pill rose">Amnesic Model</span>
                </div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: "1.6", color: "var(--text-secondary)" }}>
                  {statelessData?.answer || "Execute triage to see the baseline response without historical company memory."}
                </div>
              </div>

              {/* Right: NexusMemory Agent */}
              <div className="triage-column memory">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div>
                    <h4 style={{ fontSize: "15px", color: "var(--text-primary)" }}>NexusMemory Autonomous Agent</h4>
                    <span style={{ fontSize: "11px", color: "var(--status-emerald)" }}>Backed by Hindsight Persistent Memory</span>
                  </div>
                  <span className="status-pill emerald">Enterprise Brain</span>
                </div>

                {/* Internal Match Card from Real SQLite */}
                {triageData?.internal_match && (
                  <div style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderLeft: "3px solid var(--status-emerald)", borderRadius: "8px", padding: "16px", marginBottom: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "12px", color: "var(--status-emerald)", fontWeight: "700" }}>
                        EXACT MATCH: RESOLVED PREVIOUSLY BY TEAM MEMBER
                      </span>
                      <span className="status-pill emerald">Confidence: {triageData.internal_match.confidence_score}%</span>
                    </div>

                    <div style={{ marginTop: "8px", fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>
                      Resolved by: {triageData.internal_match.resolver_name} ({triageData.internal_match.resolver_role})
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      Contact: <strong>{triageData.internal_match.resolver_email}</strong>
                    </div>

                    <div style={{ marginTop: "10px", fontSize: "13px", color: "var(--text-primary)" }}>
                      <strong>Verified Root Cause:</strong> {triageData.internal_match.root_cause}
                    </div>

                    <div style={{ background: "var(--status-rose-bg)", color: "var(--status-rose)", padding: "10px", borderRadius: "6px", marginTop: "10px", fontSize: "12px" }}>
                      <strong>WHAT WAS TRIED AND FAILED:</strong> {triageData.internal_match.failed_attempts}
                    </div>

                    <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--status-emerald)" }}>
                      <strong>Target:</strong> {triageData.internal_match.file_path} (Line {triageData.internal_match.exact_line})
                    </div>

                    <div className="code-diff-block">
                      {triageData.internal_match.code_diff}
                    </div>

                    <div style={{ marginTop: "10px", display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)" }}>
                      <span>Occurrences: <strong>{triageData.internal_match.occurrence_count} times</strong></span>
                      <span>Peer Rating: <strong>★ {triageData.internal_match.user_rating} / 5.0</strong></span>
                      <a href={triageData.internal_match.external_docs_link} target="_blank" rel="noreferrer" style={{ color: "var(--status-emerald)", textDecoration: "none" }}>
                        Official Docs ↗
                      </a>
                    </div>
                  </div>
                )}

                {/* External Solution Card */}
                {triageData?.external_solution && !triageData?.internal_match && (
                  <div style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", borderLeft: "3px solid var(--status-emerald)", borderRadius: "8px", padding: "16px", marginBottom: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "12px", color: "var(--status-emerald)", fontWeight: "700" }}>
                        NOVEL BUG: GLOBAL INTERNET INTELLIGENCE ACTIVATED
                      </span>
                      <span className="status-pill emerald">Worldwide Source</span>
                    </div>

                    <div style={{ marginTop: "8px", fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>
                      {triageData.external_solution.title}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                      Author: <strong>{triageData.external_solution.author}</strong> ({triageData.external_solution.author_contact})
                    </div>

                    <div style={{ marginTop: "10px", fontSize: "13px", color: "var(--text-primary)" }}>
                      <strong>What They Faced:</strong> {triageData.external_solution.what_they_faced}
                    </div>

                    <div style={{ marginTop: "6px", fontSize: "13px", color: "var(--text-secondary)" }}>
                      <strong>Summary:</strong> {triageData.external_solution.summary}
                    </div>

                    <div style={{ marginTop: "10px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--text-muted)" }}>
                      <span>Global Matches: <strong>~{triageData.external_solution.occurrences_worldwide}+</strong></span>
                      <span>Rating: <strong>★ {triageData.external_solution.user_rating} / 5.0</strong></span>
                      <a href={triageData.external_solution.url} target="_blank" rel="noreferrer" style={{ color: "var(--status-emerald)", fontWeight: "600", textDecoration: "none" }}>
                        Community Source ↗
                      </a>
                    </div>
                  </div>
                )}

                {/* STEP-BY-STEP GUIDED REMEDIATION, DISCUSSION & WORKAROUNDS DIRECTLY INSIDE NEXUSMEMORY AGENT */}
                {triageData ? (
                  <div style={{ marginTop: "16px" }}>
                    <InteractiveRemediationStepper 
                      promptText={promptText} 
                      triageData={triageData} 
                      selectedUser={selectedUser} 
                    />
                  </div>
                ) : (
                  <div style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: "1.6", color: "var(--text-secondary)", marginTop: "10px" }}>
                    Execute triage to activate institutional memory recall and step-by-step verified remediation runbook.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODULE 2: WHAT-IF LAB */}
        {activeModule === "simulator" && (
          <div className="module-container">
            <WhatIfSimulator apiFetch={apiFetch} />
          </div>
        )}

        {/* MODULE 3: KNOWLEDGE VAULT */}
        {activeModule === "vault" && (
          <div className="module-container">
            <KnowledgeVault solutions={solutions} />
          </div>
        )}

        {/* MODULE 4: WORKSPACES */}
        {activeModule === "projects" && (
          <div className="module-container">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
              {projects.map((p) => (
                <div key={p.id} className="card-panel">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="status-pill emerald">{p.id}</span>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "600" }}>{p.sla}</span>
                  </div>
                  <h4 style={{ fontSize: "15px", color: "var(--text-primary)", marginTop: "10px" }}>{p.name}</h4>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>Client: <strong>{p.client}</strong></div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Env: <strong>{p.environment}</strong></div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "8px" }}>
                    <strong>Services:</strong> {p.active_services?.join(", ")}
                  </div>
                  <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn-outline-neutral"
                      style={{ padding: "4px 10px", fontSize: "11px" }}
                      onClick={() => { setSelectedPrj(p.id); setActiveModule("triage"); }}
                    >
                      Activate Workspace
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MODULE 5: PATTERNS */}
        {activeModule === "patterns" && (
          <div className="module-container">
            <div className="card-panel">
              <div className="card-header-bar">
                <div>
                  <h4>Hindsight reflect() — Institutional Risk Synthesis</h4>
                  <p style={{ color: "var(--text-muted)", fontSize: "12px" }}>Autonomous cross-incident pattern analysis over 300+ engineers' bug history</p>
                </div>
                <button type="button" className="btn-solid-primary" onClick={handleRunPatterns} disabled={!!busy}>
                  {busy === "patterns" ? "Synthesizing..." : "Re-Run Reflection"}
                </button>
              </div>

              <div style={{ background: "var(--bg-base)", padding: "20px", borderRadius: "8px", border: "1px solid var(--border-subtle)", whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: "1.6" }}>
                {patternsReport ? patternsReport.report : "Loading institutional risk analysis from Hindsight..."}
              </div>
            </div>
          </div>
        )}

        {/* MODULE 6: INGEST */}
        {activeModule === "ingest" && (
          <div className="module-container">
            <div className="card-panel" style={{ maxWidth: "600px" }}>
              <div className="card-header-bar">
                <div>
                  <h4>Multimodal Ingestion (Logs, Code, Screenshots)</h4>
                  <p style={{ color: "var(--text-muted)", fontSize: "12px" }}>Upload error screenshots, architecture specs, or code files to retain them into Hindsight</p>
                </div>
              </div>

              <div style={{ display: "grid", gap: "14px" }}>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>SELECT ASSET (LOG, CODE, OR SCREENSHOT)</label>
                  <input type="file" onChange={handleFileUpload} style={{ marginTop: "6px" }} />
                </div>

                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "600" }}>CONTEXT NOTES</label>
                  <textarea rows={3} value={uploadNotes} onChange={(e) => setUploadNotes(e.target.value)} placeholder="Describe what this screenshot or log represents..." />
                </div>

                {uploadStatus && (
                  <div style={{ background: "var(--status-emerald-bg)", color: "var(--status-emerald)", padding: "10px", borderRadius: "6px", fontSize: "12px" }}>
                    {uploadStatus}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
