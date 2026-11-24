import type { ReactNode } from "react";
import { previewDestinations, type PreviewId } from "../navigation";
import { VisualIcon } from "../VisualIcon";
import { findSource } from "./fixtures";
import { LabBannerMotif } from "./LabVisuals";

export type NavigatePreview = (id: PreviewId) => void;

export function LabHero({
  preview,
  description,
  scenarioControl,
}: {
  preview: PreviewId;
  description: string;
  scenarioControl: ReactNode;
}) {
  const entry = previewDestinations.find((item) => item.id === preview)!;
  return (
    <header className="lab-hero">
      <LabBannerMotif id={preview} />
      <div className="lab-hero-copy">
        <div className="lab-hero-eyebrow">
          <span className="eyebrow">
            <VisualIcon name={entry.icon} /> {entry.group}
          </span>
          <span className="lab-milestone-badge">
            {entry.milestone} · Prévia
          </span>
        </div>
        <h1>{entry.label}</h1>
        <p>{description}</p>
      </div>
      <div className="lab-hero-controls">{scenarioControl}</div>
    </header>
  );
}

export function PreviewLinks({
  ids,
  navigate,
}: {
  ids: readonly PreviewId[];
  navigate: NavigatePreview;
}) {
  return (
    <nav className="preview-related" aria-label="Experiências relacionadas">
      <span className="related-label">Seguir para</span>
      <div className="related-pills">
        {ids.map((id) => {
          const entry = previewDestinations.find((item) => item.id === id)!;
          return (
            <button
              type="button"
              className="related-pill"
              key={id}
              onClick={() => navigate(id)}
            >
              <VisualIcon name={entry.icon} />
              <span>{entry.label}</span>
              <VisualIcon name="forward" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function PreviewSection({
  title,
  eyebrow,
  aside,
  children,
}: {
  title: string;
  eyebrow?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="preview-section">
      <header className="preview-section-head">
        <div>
          {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
          <h2>{title}</h2>
        </div>
        {aside && <div className="section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function PreviewRow({
  title,
  detail,
  badge,
  active,
  onClick,
}: {
  title: string;
  detail: string;
  badge?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="preview-row"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
    >
      <span className="preview-row-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {badge && <span className="lab-row-badge">{badge}</span>}
      <VisualIcon name="chevron" />
    </button>
  );
}

export function Evidence({ id }: { id: string }) {
  const source = findSource(id);
  if (!source) return null;
  return (
    <figure className="preview-evidence" data-kind={source.kind}>
      <figcaption>
        <span className="evidence-path">
          <VisualIcon name="file" /> <code>{source.path}</code>
        </span>
        <span className="evidence-chips">
          <span className="lab-chip">{source.kind}</span>
          <span className="lab-chip mono">{source.digest}</span>
          <span className="lab-chip">
            {source.lines} linhas · {source.tokens} tok
          </span>
        </span>
      </figcaption>
      <blockquote>{source.excerpt}</blockquote>
    </figure>
  );
}
