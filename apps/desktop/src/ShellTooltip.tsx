import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { createPortal } from "react-dom";
import { VisualIcon, type IconName } from "./VisualIcon";

export function NavButton({
  label,
  icon,
  compact,
  current,
  onClick,
  children,
  ...attributes
}: ComponentPropsWithoutRef<"button"> & {
  label: string;
  icon: IconName;
  compact: boolean;
  current?: boolean;
}) {
  const [tip, setTip] = useState<{ left: number; top: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const over = useRef(false);

  useEffect(() => {
    if (!compact || !tip) return;
    function dismiss() {
      window.clearTimeout(timer.current);
      setTip(undefined);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [compact, tip]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function show() {
    window.clearTimeout(timer.current);
    const rect = trigger.current?.getBoundingClientRect();
    if (compact && rect)
      setTip({
        left: rect.right + 8,
        top: Math.max(
          20,
          Math.min(window.innerHeight - 20, rect.top + rect.height / 2),
        ),
      });
  }

  function leave() {
    window.clearTimeout(timer.current);
    if (!over.current && !trigger.current?.matches(":focus-visible"))
      timer.current = window.setTimeout(() => setTip(undefined), 160);
  }

  return (
    <>
      <button
        {...attributes}
        ref={trigger}
        type="button"
        className="shell-link"
        aria-label={label}
        aria-current={current ? "page" : undefined}
        onClick={(event) => {
          setTip(undefined);
          onClick?.(event);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          over.current = true;
          show();
        }}
        onPointerLeave={() => {
          over.current = false;
          leave();
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={leave}
      >
        <VisualIcon name={icon} />
        {!compact && <span className="shell-link-label">{label}</span>}
        {children}
      </button>
      {compact &&
        tip &&
        createPortal(
          <span
            className="shell-tooltip"
            role="tooltip"
            style={tip}
            onPointerEnter={() => window.clearTimeout(timer.current)}
            onPointerLeave={leave}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
