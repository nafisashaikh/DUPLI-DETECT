"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { searchSimilar, listRecords, exportCSV } from "@/lib/api";
import type { Record as DDRecord, SearchMatch } from "@/lib/types";
import styles from "./dashboard.module.css";

// ─── D3 graph types (minimal, avoid full import in SSR) ───────────────────
interface GraphNode extends DDRecord {
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

// Groups are now built using DBSCAN dynamically via /cluster API


export default function DashboardPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [records, setRecords] = useState<DDRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
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

      // Use actual DBSCAN implementation from the /cluster API instead of naive union-find
      const clusterResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: recs.map(r => r.text), eps: Math.max(0.01, 1 - (thresh / 100)) })
      });
      const clusterData = await clusterResponse.json();
      
      const nodeToGroup: number[] = new Array(recs.length).fill(-1);
      let maxGroup = 0;
      if (clusterData.groups) {
        clusterData.groups.forEach((g: any) => {
          if (g.group_id > maxGroup) maxGroup = g.group_id;
          g.items.forEach((item: any) => {
            const i = parseInt(item.id, 10);
            if (!isNaN(i)) nodeToGroup[i] = g.group_id;
          });
        });
      }
      
      // Assign DBSCAN noise points (-1) to their own isolated clusters
      nodeToGroup.forEach((g, i) => {
        if (g === -1) {
          maxGroup++;
          nodeToGroup[i] = maxGroup;
        }
      });
      const groups = nodeToGroup;
      const W = canvasRef.current?.width ?? 800;
      const H = canvasRef.current?.height ?? 500;
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.35;

      const nodes: GraphNode[] = recs.map((r, i) => {
        const angle = (2 * Math.PI * i) / recs.length - Math.PI / 2;
        return {
          ...r,
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to build graph");
      setGraphNodes([]);
      setGraphEdges([]);
      nodesRef.current = [];
      setStats({ nodes: recs.length, edges: 0, groups: 0 });
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
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load records");
      setRecords([]);
      setGraphNodes([]);
      setGraphEdges([]);
      nodesRef.current = [];
      setStats({ nodes: 0, edges: 0, groups: 0 });
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

  const clusterClass = (group: number) => {
    const g = ((group % GROUP_COLORS.length) + GROUP_COLORS.length) % GROUP_COLORS.length;
    return (styles as Record<string, string>)[`cluster${g}`] ?? "";
  };

  return (
    <div className={styles.container}>
      <div className={`${styles.header} animate-fade-up`}>
        <p className="section-label">Feature 5 — Visual Dashboard</p>
        <h1 className={styles.headerTitle}>Similarity Graph</h1>
        <p className={styles.headerSubtitle}>
          Nodes are records. Edges connect duplicates. Same color = same cluster.
        </p>
      </div>

      {/* Stats */}
      <div className={styles.statsRow}>
        {[
          { v: stats.nodes, label: "Records", icon: "⬡" },
          { v: stats.edges, label: "Edges", icon: "—" },
          { v: stats.groups, label: "Clusters", icon: "◉" },
        ].map((s) => (
          <div key={s.label} className={`card ${styles.statCard}`}>
            <span className={styles.statIcon}>{s.icon}</span>
            <div>
              <div className={styles.statValue}>{s.v}</div>
              <div className={styles.statLabel}>{s.label}</div>
            </div>
          </div>
        ))}

        {/* Controls */}
        <div className={`card ${styles.controlsCard}`}>
          <div className={styles.controlsLeft}>
            <div className={styles.controlsMeta}>
              <span>Edge threshold</span>
              <span className={styles.thresholdValue}>{threshold}%</span>
            </div>
            <input
              type="range" min={30} max={99} step={1}
              value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
              className={styles.range}
              aria-label="Edge threshold"
              title="Edge threshold"
            />
          </div>
          <div className={styles.controlsRight}>
            <button
              className={`btn btn-secondary ${styles.downloadButton}`}
              onClick={async () => {
                try {
                  const csv = await exportCSV();
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'records.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  alert('Failed to download CSV: ' + (e instanceof Error ? e.message : String(e)));
                }
              }}
            >
              📥 Download CSV
            </button>
            <button
              className={`btn btn-primary ${styles.rebuildButton}`}
              onClick={() => buildGraph(records, threshold)}
              disabled={loading}
            >
              {loading ? "…" : "↻ Rebuild"}
            </button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        className={`card ${styles.canvasCard}`}
      >
        {error && !loading && (
          <div
            className={styles.overlay}
          >
            <span className={styles.overlayWarnIcon}>⚠</span>
            <p className={styles.overlayWarnTitle}>Backend unreachable</p>
            <p className={styles.overlayBody}>{error}</p>
            <p className={styles.overlayHint}>
              Start the FastAPI server on port 8000, then refresh this page.
            </p>
          </div>
        )}
        {records.length === 0 && !loading && !error && (
          <div
            className={`${styles.overlay} ${styles.overlayMuted}`}
          >
            <span className={styles.overlayWarnIcon}>📭</span>
            <p>No records yet — add some in the Search page!</p>
          </div>
        )}
        {loading && (
          <div
            className={`${styles.overlay} ${styles.overlayBackdrop}`}
          >
            <div className={styles.loadingStack}>
              <span className={`animate-spin ${styles.loadingIcon}`}>⟳</span>
              <span className={styles.loadingText}>Building similarity graph…</span>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          onMouseLeave={() => setHovered(null)}
        />
      </div>

      {/* Selected node detail */}
      {selected && (
        <div className={`card animate-fade-up ${styles.selectedCard}`}>
          <div className={styles.selectedTop}>
            <div>
              <p className="section-label">Selected Record</p>
              <h3 className={styles.selectedTitle}>{selected.text}</h3>
              {(selected.item || selected.description || selected.amount) && (
                <div className={styles.recordDetails}>
                  {selected.item && <div><strong>Item:</strong> {selected.item}</div>}
                  {selected.description && <div><strong>Description:</strong> {selected.description}</div>}
                  {selected.amount && <div><strong>Amount:</strong> {selected.amount}</div>}
                </div>
              )}
              <div className={styles.selectedBadges}>
                <span className="badge badge-info">{selected.language}</span>
                <span className={`badge ${styles.clusterBadge} ${clusterClass(selected.group)}`}>
                  Cluster {selected.group + 1}
                </span>
              </div>
            </div>
            <button onClick={() => setSelected(null)} className={styles.closeButton}>✕</button>
          </div>
          <div className={styles.connections}>
            <p className={styles.connectionsLabel}>Connected to:</p>
            {graphEdges.filter((e) => e.source.id === selected.id || e.target.id === selected.id).map((e, i) => {
              const peer = e.source.id === selected.id ? e.target : e.source;
              return (
                <div key={i} className={styles.connectionRow}>
                  <span className={styles.connectionText}>{peer.text}</span>
                  <span className={styles.connectionWeight}>{Math.round(e.weight * 100)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className={styles.legend}>
        {Array.from(new Set(graphNodes.map((n) => n.group))).map((g) => (
          <div key={g} className={styles.legendItem}>
            <div className={`${styles.legendDot} ${clusterClass(g)}`} />
            <span className={styles.legendText}>Cluster {g + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
