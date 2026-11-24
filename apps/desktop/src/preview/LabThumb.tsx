import type { PreviewId } from "../navigation";

export function LabThumb({ id }: { id: PreviewId }) {
  switch (id) {
    case "memory":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-grid" d="M6 15h76M6 27h76M6 39h76" />
          <path className="lv-accent" d="M12 15h46" strokeWidth="3" />
          <path className="lv-source" d="M18 27h56" strokeWidth="3" />
          <path className="lv-task" d="M26 39h38" strokeWidth="3" />
          <circle className="lv-dot-accent" cx="58" cy="15" r="3.5" />
          <circle className="lv-dot-source" cx="74" cy="27" r="3.5" />
          <circle className="lv-dot-task" cx="64" cy="39" r="3.5" />
        </svg>
      );
    case "graph":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <ellipse className="lv-orbit" cx="44" cy="26" rx="22" ry="15" />
          <ellipse className="lv-orbit" cx="44" cy="26" rx="36" ry="22" />
          <path
            className="lv-source"
            d="M14 14 C28 14 30 26 44 26 S62 14 74 14"
          />
          <path className="lv-accent" d="M44 26 C56 26 58 40 72 40" />
          <circle className="lv-dot-source" cx="14" cy="14" r="3" />
          <circle className="lv-dot-task" cx="72" cy="40" r="3" />
          <circle className="lv-hub" cx="44" cy="26" r="7" />
          <text className="lv-lambda" x="44" y="29">
            λ
          </text>
        </svg>
      );
    case "compiler":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            className="lv-panel"
            x="6"
            y="14"
            width="76"
            height="18"
            rx="4"
          />
          <rect
            className="lv-fill-accent"
            x="9"
            y="17"
            width="18"
            height="12"
            rx="2"
          />
          <rect
            className="lv-fill-source"
            x="29"
            y="17"
            width="22"
            height="12"
            rx="2"
          />
          <rect
            className="lv-fill-muted"
            x="54"
            y="17"
            width="24"
            height="12"
            rx="2"
          />
          <path className="lv-accent" d="M52 8v32" strokeWidth="1.6" />
          <circle className="lv-dot-accent" cx="52" cy="8" r="2.5" />
        </svg>
      );
    case "inbox":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-source" d="M8 14 C24 14 26 26 42 26" />
          <path className="lv-warn" d="M8 26 L36 26" strokeDasharray="3 2" />
          <path className="lv-source" d="M8 38 C24 38 26 26 42 26" />
          <path className="lv-accent" d="M44 8v36" strokeWidth="1.8" />
          <path className="lv-green" d="M46 26 C60 26 64 18 80 18" />
          <circle className="lv-hub" cx="44" cy="26" r="6.5" />
          <text className="lv-lambda" x="44" y="29">
            λ
          </text>
        </svg>
      );
    case "agents":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <circle className="lv-orbit" cx="24" cy="26" r="15" />
          <circle className="lv-accent" cx="24" cy="26" r="9" />
          <path
            className="lv-green"
            d="M42 28 C47 16 51 36 56 26 S64 14 70 28 S76 34 82 22"
          />
          <circle className="lv-dot-accent" cx="24" cy="26" r="3" />
        </svg>
      );
    case "planner":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-grid" d="M8 38h72" strokeWidth="1.6" />
          <path
            className="lv-accent"
            d="M18 38 C28 38 28 16 40 16 H70"
            strokeWidth="1.8"
          />
          <circle className="lv-dot-source" cx="18" cy="38" r="3" />
          <circle className="lv-dot-accent" cx="42" cy="16" r="3" />
          <circle className="lv-dot-accent" cx="56" cy="16" r="3" />
          <circle className="lv-dot-green" cx="70" cy="16" r="3.5" />
        </svg>
      );
    case "preflight":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <circle className="lv-orbit" cx="44" cy="26" r="19" />
          <path
            className="lv-green"
            d="M44 7 A19 19 0 0 1 63 26"
            strokeWidth="2.4"
          />
          <path
            className="lv-accent"
            d="M63 26 A19 19 0 0 1 44 45"
            strokeWidth="2.4"
          />
          <path
            className="lv-source"
            d="M44 45 A19 19 0 0 1 25 26"
            strokeWidth="2.4"
          />
          <circle className="lv-hub" cx="44" cy="26" r="6" />
          <text className="lv-lambda" x="44" y="29">
            λ
          </text>
        </svg>
      );
    case "arena":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-accent" d="M18 26 C32 26 36 13 74 13" />
          <path className="lv-source" d="M18 26 C32 26 36 39 74 39" />
          <path className="lv-task" d="M18 26 H74" />
          <circle className="lv-hub" cx="16" cy="26" r="6" />
          <circle className="lv-dot-accent" cx="74" cy="13" r="3" />
          <circle className="lv-dot-source" cx="74" cy="39" r="3" />
          <circle className="lv-dot-task" cx="74" cy="26" r="3" />
        </svg>
      );
    case "replay":
      return (
        <svg
          className="lab-thumb"
          viewBox="0 0 88 52"
          aria-hidden="true"
          focusable="false"
        >
          <path className="lv-accent" d="M10 17h68" />
          <path className="lv-source" d="M10 36h68" />
          <path className="lv-grid" d="M22 17v19M44 17v19M66 17v19" />
          <path
            className="lv-accent"
            d="M22 17 C36 6 52 6 66 17"
            strokeDasharray="2.5 2.5"
          />
          <circle className="lv-dot-accent" cx="22" cy="17" r="3" />
          <circle className="lv-dot-accent" cx="66" cy="17" r="3.5" />
          <circle className="lv-dot-source" cx="66" cy="36" r="3" />
        </svg>
      );
  }
}
