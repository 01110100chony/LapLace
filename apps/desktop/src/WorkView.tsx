import type { ReactNode, Ref } from "react";
import { VisualIcon, type IconName } from "./VisualIcon";

export function WorkHeading({
  id,
  title,
  description,
  actions,
}: {
  id: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="work-heading">
      <div>
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="work-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <VisualIcon name={icon} />
      </div>
      <div>
        <p className="empty-state-title">{title}</p>
        {children && <div className="empty-state-detail">{children}</div>}
      </div>
    </div>
  );
}

export function WorkDisclosure({
  ref,
  id,
  icon,
  title,
  detail,
  onOpen,
  children,
}: {
  ref?: Ref<HTMLDetailsElement>;
  id?: string;
  icon: IconName;
  title: string;
  detail?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <details
      ref={ref}
      id={id}
      className="panel work-disclosure"
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen?.();
      }}
    >
      <summary>
        <VisualIcon name={icon} />
        <span>
          <strong>{title}</strong>
          {detail && <small>{detail}</small>}
        </span>
        <span className="disclosure-indicator">
          <VisualIcon name="chevron" />
        </span>
      </summary>
      <div className="work-disclosure-body">{children}</div>
    </details>
  );
}
