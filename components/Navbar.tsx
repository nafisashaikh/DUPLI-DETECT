"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/",         label: "Home" },
  { href: "/compare",  label: "Compare" },
  { href: "/search",   label: "Search" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function Navbar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(10,11,20,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        {/* Logo */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span style={{ fontSize: 22 }}>🔍</span>
          <span style={{ fontWeight: 800, fontSize: "1.1rem", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            Dupli<span style={{ color: "var(--accent)" }}>Detect</span>
          </span>
        </Link>

        {/* Desktop links */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }} className="desktop-nav">
          {LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  padding: "7px 16px",
                  borderRadius: 8,
                  fontWeight: 500,
                  fontSize: "0.875rem",
                  textDecoration: "none",
                  color: active ? "var(--accent)" : "var(--text-secondary)",
                  background: active ? "rgba(99,120,255,0.12)" : "transparent",
                  border: active ? "1px solid rgba(99,120,255,0.25)" : "1px solid transparent",
                  transition: "all 0.2s",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        {/* Mobile burger */}
        <button
          onClick={() => setOpen(!open)}
          className="mobile-burger"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 22, display: "none" }}
          aria-label="Toggle menu"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div
          style={{
            background: "var(--bg-card)",
            borderTop: "1px solid var(--border)",
            padding: "12px 24px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  fontWeight: 500,
                  fontSize: "0.9rem",
                  textDecoration: "none",
                  color: active ? "var(--accent)" : "var(--text-secondary)",
                  background: active ? "rgba(99,120,255,0.1)" : "transparent",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      )}

      <style>{`
        @media (max-width: 640px) {
          .desktop-nav { display: none !important; }
          .mobile-burger { display: block !important; }
        }
      `}</style>
    </nav>
  );
}
