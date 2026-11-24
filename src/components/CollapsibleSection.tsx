import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./Icons";

// Phone layouts omit the collapsible header and keep controls visible; larger screens can collapse the section.
export const COLLAPSIBLE_EXPANDED_MEDIA = "(min-width: 700px)";

export function CollapsibleSection({ title, className, inert = false, defaultOpen, open, onToggle, children }: {
  title: string;
  className?: string;
  inert?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [collapsible, setCollapsible] = useState(() =>
    window.matchMedia(COLLAPSIBLE_EXPANDED_MEDIA).matches,
  );
  const [uncontrolledOpen, setUncontrolledOpen] = useState(() => defaultOpen ?? true);
  useEffect(() => {
    const mediaQuery = window.matchMedia(COLLAPSIBLE_EXPANDED_MEDIA);
    const update = () => setCollapsible(mediaQuery.matches);
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);
  const expanded = !collapsible || (open ?? uncontrolledOpen);
  const contentId = useId();
  return (
    <section className={className} aria-label={title} inert={inert}>
      {collapsible && (
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
            <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </h2>
      )}
      <div id={contentId} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
