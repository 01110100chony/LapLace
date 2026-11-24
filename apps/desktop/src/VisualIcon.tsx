import type { ReactNode } from "react";

const strokes = {
  workspace: <path d="M3.5 4.5h17v15h-17z M3.5 9h17 M9 9v10.5" />,
  folder: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  download: <path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" />,
  forward: <path d="M4.5 12h14m-5-5 5 5-5 5" />,
  back: <path d="M19.5 12h-14m5 5-5-5 5-5" />,
  refresh: <path d="M20 5v5h-5m5 0a8 8 0 1 0-.65 6" />,
  pause: <path d="M9 5v14m6-14v14" />,
  play: <path d="m9 5 10 7-10 7z" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  overview: <path d="M4 5h16v14H4z M4 12h16 M12 5v7" />,
  archive: <path d="M4 4.5h16v4H4z M5.5 8.5v11h13v-11 M10 12h4" />,
  tasks: (
    <path d="M9 5h11M9 12h11M9 19h11M3 5l1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2" />
  ),
  decision: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm-4 9 2.5 2.5L16 9" />,
  panel: <path d="M3.5 5h17v14h-17zM9 5v14m4-10 3 3-3 3" />,
  panelCollapse: <path d="M3.5 5h17v14h-17zM9 5v14m7-10-3 3 3 3" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  fit: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5M9 9h6v6H9z" />,
  minus: <path d="M5 12h14" />,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  git: (
    <>
      <circle cx="7" cy="5" r="2" />
      <circle cx="7" cy="19" r="2" />
      <circle cx="17" cy="6" r="2" />
      <path d="M7 7v10m0-3h3c4 0 7-2.5 7-6" />
    </>
  ),
  search: <path d="M15.5 15.5 20 20m-2.5-9.5a7 7 0 1 0-14 0 7 7 0 0 0 14 0" />,
  file: <path d="M6 3.5h8l4 4v13H6z M14 3.5v4h4 M9 12h6 M9 16h6" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  lab: (
    <path d="M9 3h6m-5 0v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 15h8" />
  ),
  settings: <path d="M5 7h14M5 12h14M5 17h14M9 5v4m6 1v4m-5 1v4" />,
  graph: (
    <path d="M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm1-8 6 2m-1 4-4 3m-3-8 1 7" />
  ),
  layers: <path d="m3 8 9-5 9 5-9 5-9-5zm0 4 9 5 9-5M3 16l9 5 9-5" />,
  inbox: <path d="M4 5h16l2 10v4H2v-4L4 5zm-2 10h6l2 2h4l2-2h6" />,
  agent: <path d="M6 8h12l2 3v6H4v-6l2-3zm6 0V5m-4 8h.01m8 0h.01m-6 2h4" />,
  clock: <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4v5h4" />,
  split: <path d="M4 5h16v14H4z M12 5v14m-6-8h4m4 2h4" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof strokes;

export function VisualIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="visual-icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {strokes[name]}
      </g>
    </svg>
  );
}

export function LambdaMark() {
  return (
    <svg
      className="lambda-mark"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10 7c4.5-1.5 7.5.7 9.3 5L28 31c.8 1.8 1.9 2.5 3.5 2.5M20.6 15 10 33"
        stroke="currentColor"
        strokeWidth="2.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
