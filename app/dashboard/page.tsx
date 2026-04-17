"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { searchSimilar, listRecords } from "@/lib/api";
import type { Record as DDRecord, SearchMatch } from "@/lib/types";

// ─── D3 graph types (minimal, avoid full import in SSR) ───────────────────
interface GraphNode {
  id: string;
  text: string;
  language: string;
  x: number;
  y: number;
  color: string;
  group: number;
  radius: number;
}

interface GraphEdge {
  source: GraphNode;
  target: GraphNode;
  weight: number;
}

const GROUP_COLORS = [
  "#6378ff", "#a855f7", "#22d3ee", "#f59e0b",
  "#10b981", "#f43f5e", "#ec4899", "#8b5cf6",
];

function getColor(group: number) {
  return GROUP_COLORS[group % GROUP_COLORS.length];
}

// Assign groups via union-find
function buildGroups(nodes: DDRecord[], edges: { a: number; b: number }[]) {
  const parent = nodes.map((_, i) => i);
  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(x: number, y: number) {
    parent[find(x)] = find(y);
  }
  edges.forEach(({ a, b }) => union(a, b));
  const rootToGroup: Record<number, number> = {};
  let g = 0;
  return nodes.map((_, i) => {
    const r = find(i);
    if (!(r in rootToGroup)) rootToGroup[r] = g++;
    return rootToGroup[r];
  });
}

export default function DashboardPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [records, setRecords] = useState<DDRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(65);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0, groups: 0 });
  const nodesRef = useRef<GraphNode[]>([]);

  const buildGraph = useCallback(async (recs: DDRecord[], thresh: number) => {
    if (recs.length === 0) { setGraphNodes([]); setGraphEdges([]); return; }
    setLoading(true);
    try {
      // For each record, get its similar matches
      const edgesRaw: { a: number; b: number; w: number }[] = [];
      const promises = recs.map((r, i) =>
        searchSimilar(r.text, thresh / 100).then((res) => ({ i, matches: res.matches }))
      );
      const results = await Promise.all(promises);
      results.forEach(({ i, matches }) => {
        matches.forEach((m: SearchMatch) => {
          const j = recs.findIndex((r) => r.id === m.id);
          if (j !== -1 && j !== i && !edgesRaw.find((e) => (e.a === j && e.b === i))) {
            edgesRaw.push({ a: i, b: j, w: m.similarity / 100 });
          }
        });
      });

      const groups = buildGroups(recs, edgesRaw.map((e) => ({ a: e.a, b: e.b })));
      const W = canvasRef.current?.width ?? 800;
      const H = canvasRef.current?.height ?? 500;
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.35;

      const nodes: GraphNode[] = recs.map((r, i) => {
        const angle = (2 * Math.PI * i) / recs.length - Math.PI / 2;
        return {
          id: r.id, text: r.text, language: r.language,
          x: cx + R * Math.cos(angle),
          y: cy + R * Math.sin(angle),
          color: getColor(groups[i]),
          group: groups[i],
          radius: 22,
        };
      });

      const edges: GraphEdge[] = edgesRaw.map((e) => ({
        source: nodes[e.a],
        target: nodes[e.b],
        weight: e.w,
      }));

      const uniqueGroups = new Set(groups).size;
      setGraphNodes(nodes);
      setGraphEdges(edges);
      nodesRef.current = nodes;
      setStats({ nodes: nodes.length, edges: edges.length, groups: uniqueGroups });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAndBuild = useCallback(async () => {
    setLoading(true);
    try {
      const recs = await listRecords();
      setRecords(recs);
      await buildGraph(recs, threshold);
    } finally {
      setLoading(false);
    }
  }, [buildGraph, threshold]);

  useEffect(() => { fetchAndBuild(); }, [fetchAndBuild]);

  // Canvas render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    cancelAnimationFrame(animFrameRef.current);
    function draw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Grid
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 50) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 50) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // Edges
      graphEdges.forEach((e) => {
        const alpha = 0.15 + e.weight * 0.6;
        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);
        ctx.strokeStyle = `rgba(99,120,255,${alpha})`;
        ctx.lineWidth = 1 + e.weight * 3;
        ctx.stroke();
        // Weight label
        const mx = (e.source.x + e.target.x) / 2;
        const my = (e.source.y + e.target.y) / 2;
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "10px Inter";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(e.weight * 100)}%`, mx, my);
      });

      // Nodes
      graphNodes.forEach((n) => {
        const isHov = hovered?.id === n.id;
        const isSel = selected?.id === n.id;
        const r = n.radius + (isHov || isSel ? 4 : 0);

        // Glow
        if (isHov || isSel) {
          const grad = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, r * 2);
          grad.addColorStop(0, `${n.color}44`);
          grad.addColorStop(1, "transparent");
          ctx.beginPath(); ctx.arc(n.x, n.y, r * 2, 0, Math.PI * 2);
          ctx.fillStyle = grad; ctx.fill();
        }

        // Circle
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color + "33";
        ctx.fill();
        ctx.strokeStyle = n.color;
        ctx.lineWidth = isHov || isSel ? 3 : 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = "#f0f2ff";
        ctx.font = `${isHov ? "600 " : ""}11px Inter`;
        ctx.textAlign = "center";
        const label = n.text.length > 18 ? n.text.slice(0, 16) + "…" : n.text;
        ctx.fillText(label, n.x, n.y + r + 14);

        // Lang
        ctx.fillStyle = n.color;
        ctx.font = "10px Inter";
        ctx.fillText(n.language, n.x, n.y + r + 26);
      });

      animFrameRef.current = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [graphNodes, graphEdges, hovered, selected]);

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    });
    observer.observe(canvas);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    return () => observer.disconnect();
  }, []);

  // Mouse events
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = nodesRef.current.find((n) => Math.hypot(n.x - mx, n.y - my) < n.radius + 6) ?? null;
    setHovered(hit);
    canvasRef.current!.style.cursor = hit ? "pointer" : "default";
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = nodesRef.current.find((n) => Math.hypot(n.x - mx, n.y - my) < n.radius + 6) ?? null;
    setSelected(hit);
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px 80px" }}>
      <div className="animate-fade-up" style={{ marginBottom: 28 }}>
        <p className="section-label" style={{ marginBottom: 8 }}>Feature 5 — Visual Dashboard</p>
        <h1 style={{ fontSize: "clamp(1.6rem,4vw,2.4rem)", marginBottom: 8 }}>Similarity Graph</h1>
        <p style={{ color: "var(--text-secondary)" }}>
          Nodes are records. Edges connect duplicates. Same color = same cluster.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
        {[
          { v: stats.nodes, label: "Records", icon: "⬡" },
          { v: stats.edges, label: "Edges", icon: "—" },
          { v: stats.groups, label: "Clusters", icon: "◉" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 22px", display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 18, color: "var(--accent)" }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{s.v}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{s.label}</div>
            </div>
          </div>
        ))}

        {/* Controls */}
        <div className="card" style={{ padding: "14px 22px", display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 260 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 4 }}>
              <span>Edge threshold</span>
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>{threshold}%</span>
            </div>
            <input
              type="range" min={30} max={99} step={1}
              value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent)" }}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ padding: "9px 18px", whiteSpace: "nowrap" }}
            onClick={() => buildGraph(records, threshold)}
            disabled={loading}
          >
            {loading ? "…" : "↻ Rebuild"}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="card"
        style={{
          padding: 0,
          overflow: "hidden",
          position: "relative",
          height: 520,
        }}
      >
        {records.length === 0 && !loading && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)", gap: 12,
            }}
          >
            <span style={{ fontSize: 40 }}>📭</span>
            <p>No records yet — add some in the Search page!</p>
          </div>
        )}
        {loading && (
          <div
            style={{
              position: "absolute", inset: 0, zIndex: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(10,11,20,0.7)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <span className="animate-spin" style={{ display: "inline-block", fontSize: 28, color: "var(--accent)" }}>⟳</span>
              <span style={{ color: "var(--text-secondary)" }}>Building similarity graph…</span>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onMouseLeave={() => setHovered(null)}
        />
      </div>

      {/* Selected node detail */}
      {selected && (
        <div className="card animate-fade-up" style={{ padding: 20, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <p className="section-label" style={{ marginBottom: 4 }}>Selected Record</p>
              <h3 style={{ fontSize: "1.1rem" }}>{selected.text}</h3>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <span className="badge badge-info">{selected.language}</span>
                <span className="badge" style={{ background: `${selected.color}22`, color: selected.color, border: `1px solid ${selected.color}44` }}>
                  Cluster {selected.group + 1}
                </span>
              </div>
            </div>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18 }}>✕</button>
          </div>
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 8 }}>Connected to:</p>
            {graphEdges.filter((e) => e.source.id === selected.id || e.target.id === selected.id).map((e, i) => {
              const peer = e.source.id === selected.id ? e.target : e.source;
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: "0.875rem" }}>{peer.text}</span>
                  <span style={{ color: "var(--success)", fontWeight: 700, fontSize: "0.85rem" }}>{Math.round(e.weight * 100)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {Array.from(new Set(graphNodes.map((n) => n.group))).map((g) => (
          <div key={g} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 99, background: getColor(g) }} />
            <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Cluster {g + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
