import type { ReactNode } from "react";
import { previewDestinations, type PreviewId } from "../navigation";
import { VisualIcon } from "../VisualIcon";
import { findSource } from "./fixtures";

export type NavigatePreview = (id: PreviewId) => void;

export function PreviewLinks({
  ids,
  navigate,
}: {
  ids: readonly PreviewId[];
  navigate: NavigatePreview;
}) {
  return (
    <div className="preview-related" aria-label="Experiências relacionadas">
      {ids.map((id) => {
        const entry = previewDestinations.find((item) => item.id === id)!;
        return (
          <button
            type="button"
            className="text-button"
            key={id}
            onClick={() => navigate(id)}
          >
            {entry.label} <VisualIcon name="forward" />
          </button>
        );
      })}
    </div>
  );
}

export function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="preview-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function PreviewRow({
  title,
  detail,
  active,
  onClick,
}: {
  title: string;
  detail: string;
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
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <VisualIcon name="chevron" />
    </button>
  );
}

export function Evidence({ id }: { id: string }) {
  const source = findSource(id);
  if (!source) return null;
  return (
    <figure className="preview-evidence">
      <figcaption>
        <VisualIcon name="file" /> <code>{source.path}</code>{" "}
        <span>{source.kind} · fixture</span>
      </figcaption>
      <blockquote>{source.excerpt}</blockquote>
    </figure>
  );
}
