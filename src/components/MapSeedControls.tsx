import { useId } from "react";
import { useTranslation } from "../localization";
import { appTranslations } from "../translations/app";

export function MapSeedControls({ value, onChange, onLoad, onShuffle, disabled = false, error }: {
  value: string;
  onChange: (value: string) => void;
  onLoad: (value: string) => void;
  onShuffle: () => void;
  disabled?: boolean;
  error?: string;
}) {
  const translateText = useTranslation(appTranslations);
  const errorId = useId();

  return <><form className="map-seed-controls" aria-label={translateText("Map code")} onSubmit={event => {
    event.preventDefault();
    onLoad(value);
  }}>
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
