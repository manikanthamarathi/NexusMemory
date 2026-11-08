"use client";

export default function KnowledgeVault({ solutions }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "16px" }}>
      {solutions.map((sol) => (
        <div key={sol.id} className="card-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="status-pill rose">{sol.incident_id}</span>
            <span className="status-pill emerald">{sol.confidence_score}% Conf</span>
          </div>
          <h4 style={{ fontSize: "15px", color: "var(--text-primary)", marginTop: "10px" }}>{sol.service} Failure Mode</h4>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
            Resolved by: <strong>{sol.resolver_name}</strong> ({sol.resolver_role})
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            Contact: {sol.resolver_email}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "8px" }}>
            <strong>Root Cause:</strong> {sol.root_cause}
          </div>
          <div className="diff-box" style={{ marginTop: "10px" }}>
            {sol.code_diff}
          </div>
          <div style={{ marginTop: "10px", display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)" }}>
            <span>Occurrences: {sol.occurrence_count} times</span>
            <span>Rating: ★ {sol.user_rating} / 5.0</span>
          </div>
        </div>
      ))}
    </div>
  );
}
