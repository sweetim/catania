import { useEffect, useId, useState } from "react";
import { useTranslation } from "../localization";
import { appTranslations } from "../translations/app";
import { CheckIcon, CopyIcon, ShuffleIcon } from "./Icons";

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
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
    </div>
    <button type="button" className="map-seed-shuffle" aria-label={translateText("Shuffle island preview")} title={translateText("Shuffle")} disabled={disabled} onClick={onShuffle}>
      <ShuffleIcon />
      <span>{translateText("Shuffle")}</span>
    </button>
  </form>
    {error && <p id={errorId} className="map-seed-error" role="alert">{error}</p>}
  </>;
}
