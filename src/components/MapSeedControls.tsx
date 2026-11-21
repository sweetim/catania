import { useEffect, useId, useState } from "react";
import { useTranslation } from "../localization";
import { appTranslations } from "../translations/app";

export function MapSeedControls({ value, onChange, onLoad, onShuffle, disabled = false, error, showCopy = false }: {
  value: string;
  onChange: (value: string) => void;
  onLoad: (value: string) => void;
  onShuffle: () => void;
  disabled?: boolean;
  error?: string;
  showCopy?: boolean;
}) {
  const translateText = useTranslation(appTranslations);
  const errorId = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [value]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyCode() {
    const code = value.trim().toUpperCase();
    if (!code) return;
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
    } catch {
      // Ignore clipboard failures in restricted browser contexts.
    }
  }

  return <><form className="map-seed-controls" aria-label={translateText("Map code")} onSubmit={event => {
    event.preventDefault();
    onLoad(value);
  }}>
    <div className="map-seed-group">
      <label className="map-seed-field">
        <span>{translateText("Map code")}</span>
        <input
          value={value}
          onChange={event => {
            const code = event.currentTarget.value;
            onChange(code);
            if (code.length === event.currentTarget.maxLength) onLoad(code);
          }}
          placeholder="XXXXXXXX"
          maxLength={8}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {showCopy && (
        <button
          type="button"
          className="map-seed-copy"
          aria-label={translateText(copied ? "Map code copied" : "Copy map code")}
          title={translateText(copied ? "Copied" : "Copy map code")}
          disabled={disabled || !value.trim()}
          onClick={copyCode}
        >
          {copied ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect width="13" height="13" x="9" y="9" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      )}
    </div>
    <button type="button" className="map-seed-shuffle" aria-label={translateText("Shuffle island preview")} title={translateText("Shuffle")} disabled={disabled} onClick={onShuffle}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m18 3 3 3-3 3M18 15l3 3-3 3M3 6h3c6 0 6 12 12 12h3M3 18h3c2 0 3.3-1.3 4.5-3.3M13.5 9.3C14.7 7.3 16 6 18 6h3" />
      </svg>
      <span>{translateText("Shuffle")}</span>
    </button>
  </form>
    {error && <p id={errorId} className="map-seed-error" role="alert">{error}</p>}
  </>;
}
