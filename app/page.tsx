import Link from "next/link";

const FEATURES = [
  {
    icon: "⚡",
    title: "Instant Comparison",
    desc: "Compare any two texts in any language and get a precise similarity score in milliseconds.",
    href: "/compare",
    gradient: "linear-gradient(135deg,#6378ff,#a855f7)",
  },
  {
    icon: "🔎",
    title: "Real-Time Search",
    desc: "Type a new record and instantly surface similar existing entries above your threshold.",
    href: "/search",
    gradient: "linear-gradient(135deg,#22d3ee,#6378ff)",
  },
  {
    icon: "📊",
    title: "Graph Dashboard",
    desc: "Visualise your entire dataset as a similarity graph—clusters reveal duplicate groups at a glance.",
    href: "/dashboard",
    gradient: "linear-gradient(135deg,#f59e0b,#f43f5e)",
  },
];

const LANGS = ["English", "日本語", "中文", "ภาษาไทย", "Bahasa", "العربية", "한국어", "हिन्दी", "Français", "Deutsch"];

export default function HomePage() {
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* ── Hero ── */}
      <section style={{ textAlign: "center", padding: "80px 0 64px" }}>
        <div
          className="animate-fade-up"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 16px",
            borderRadius: 99,
            background: "rgba(99,120,255,0.12)",
            border: "1px solid rgba(99,120,255,0.25)",
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--accent)",
            marginBottom: 28,
            letterSpacing: "0.04em",
          }}
        >
          <span>✦</span> MULTILINGUAL DUPLICATE DETECTION
        </div>
        <h1
          className="animate-fade-up"
          style={{
            fontSize: "clamp(2.2rem, 6vw, 4rem)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            marginBottom: 18,
            animationDelay: "0.08s",
            background: "linear-gradient(135deg, #f0f2ff 30%, var(--accent) 70%, var(--accent-2) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Find Duplicates Across
          <br />
          Any Language
        </h1>
        <p
          className="animate-fade-up"
          style={{
            color: "var(--text-secondary)",
            fontSize: "clamp(1rem, 2.5vw, 1.2rem)",
            maxWidth: 560,
            margin: "0 auto 36px",
            animationDelay: "0.16s",
          }}
        >
          Powered by multilingual sentence embeddings. Detect typos, semantic duplicates, and cross-language matches in your dataset instantly.
        </p>
        <div
          className="animate-fade-up"
          style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", animationDelay: "0.24s" }}
        >
          <Link href="/compare" className="btn btn-primary">
            🔍 Compare Records
          </Link>
          <Link href="/search" className="btn btn-ghost">
            🔎 Search Dataset
          </Link>
        </div>
      </section>

      {/* ── Language ticker ── */}
      <section style={{ overflow: "hidden", marginBottom: 72, position: "relative" }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            animation: "ticker 20s linear infinite",
            width: "max-content",
          }}
        >
          {[...LANGS, ...LANGS].map((l, i) => (
            <span
              key={i}
              style={{
                padding: "7px 18px",
                borderRadius: 99,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                fontSize: "0.85rem",
                fontWeight: 500,
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
              }}
            >
              {l}
            </span>
          ))}
        </div>
        <style>{`@keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
      </section>

      {/* ── Feature cards ── */}
      <section style={{ marginBottom: 80 }}>
        <p className="section-label" style={{ textAlign: "center", marginBottom: 12 }}>
          Core Features
        </p>
        <h2
          style={{
            textAlign: "center",
            fontSize: "clamp(1.4rem, 3vw, 2rem)",
            marginBottom: 40,
            color: "var(--text-primary)",
          }}
        >
          Everything you need to clean your data
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
          }}
        >
          {FEATURES.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              style={{ textDecoration: "none" }}
            >
              <div className="card" style={{ padding: 28, cursor: "pointer" }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: f.gradient,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    marginBottom: 18,
                  }}
                >
                  {f.icon}
                </div>
                <h3 style={{ fontSize: "1.1rem", marginBottom: 8, color: "var(--text-primary)" }}>{f.title}</h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.6 }}>{f.desc}</p>
                <div style={{ marginTop: 20, color: "var(--accent)", fontSize: "0.85rem", fontWeight: 600 }}>
                  Open →
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section style={{ marginBottom: 80 }}>
        <div className="card" style={{ padding: "48px 40px", textAlign: "center" }}>
          <p className="section-label" style={{ marginBottom: 12 }}>How it Works</p>
          <h2 style={{ fontSize: "1.6rem", marginBottom: 36 }}>Multilingual embeddings at the core</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 28,
            }}
          >
            {[
              { n: "1", title: "Preprocess", desc: "Lowercase, normalise Unicode, strip whitespace" },
              { n: "2", title: "Embed", desc: "paraphrase-multilingual-MiniLM-L12-v2 → 384-d vector" },
              { n: "3", title: "Compare", desc: "Cosine similarity on L2-normalised vectors" },
              { n: "4", title: "Classify", desc: "Typo / Language / Semantic / Not duplicate" },
            ].map((s) => (
              <div key={s.n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 99,
                    background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: "1rem",
                  }}
                >
                  {s.n}
                </div>
                <h4 style={{ fontSize: "0.95rem", color: "var(--text-primary)" }}>{s.title}</h4>
                <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
