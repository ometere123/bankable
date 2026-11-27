"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="16" r="10.4" fill="none" stroke="currentColor" strokeWidth=".8" opacity=".55" />
      <path d="M10.6 16.4l3.7 3.7 7-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="square" />
      <circle cx="27" cy="5" r="2.2" fill="var(--ink-blue)" />
    </svg>
  );
}

export type Tone = "pass" | "fail" | "inconclusive" | "not-checked";
/** Decorative: the adjacent word always carries the meaning (never colour or shape alone). */
export function StatusIcon({ tone }: { tone: Tone }) {
  const d = { pass: "M3.5 8.4l3 3 6-6.8", fail: "M4 4l8 8M12 4l-8 8", inconclusive: "M8 3.6v5.2M8 11.4v1", "not-checked": "M4 8h8" }[tone];
  return (
    <svg className={`sicon ${tone}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <>
      <button type="button" className="copy" aria-label={`Copy ${label}`} onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); clearTimeout(t.current); t.current = setTimeout(() => setDone(false), 1800); } catch { /* clipboard unavailable: value stays selectable */ }
      }}>{done ? "Copied" : "Copy"}</button>
      <span className="sr-only" role="status">{done ? `${label} copied` : ""}</span>
    </>
  );
}

/** Labelled monospaced value with a copy control. */
export function HashRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="hashrow">
      <span className="k">{label}</span>
      <span className="v mono">{href ? <a href={href}>{value}</a> : value}</span>
      <CopyButton value={value} label={label.toLowerCase()} />
    </div>
  );
}

export function Plate({ folio, title, aside, children, className = "" }: { folio?: string; title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`plate ${className}`}>
      {(folio || title) && (
        <header className="plate-head">
          <div>{folio && <span className="folio">{folio}</span>}{title && <h3>{title}</h3>}</div>
          {aside && <div className="plate-aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <div className="sk-row" key={i} style={{ ["--i" as string]: i }}><span /><span /><span /></div>)}
    </div>
  );
}
