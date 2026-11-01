import { useId, useState, type ReactNode } from "react";

// Phone layouts collapse busy sections by default; larger screens start expanded.
export const COLLAPSIBLE_EXPANDED_MEDIA = "(min-width: 700px)";

export function CollapsibleSection({ title, className, inert = false, open, onToggle, children }: {
  title: string;
  className?: string;
  inert?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(() =>
    window.matchMedia(COLLAPSIBLE_EXPANDED_MEDIA).matches,
  );
  const expanded = open ?? uncontrolledOpen;
  const contentId = useId();
  return (
    <section className={className} aria-label={title} inert={inert}>
      <h2 className="eyebrow mb-2">
        <button
          type="button"
          className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-moss"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => {
            if (onToggle) onToggle(!expanded);
            else setUncontrolledOpen(!expanded);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <svg
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m3 4.5 3 3 3-3" />
          </svg>
        </button>
      </h2>
      <div id={contentId} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
