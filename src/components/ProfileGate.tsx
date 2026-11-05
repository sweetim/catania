import { useState } from "react";
import { Logo } from "./GameUi";
import { useTranslation } from "../localization";
import { profileTranslations } from "../translations/profile";
import { createProfile, profileStats, validProfileName, type PlayerProfile } from "../profile";

function nameErrorKey(name: string, profiles: PlayerProfile[], ignore?: PlayerProfile): keyof typeof profileTranslations | null {
  const normalized = name.trim().normalize("NFC");
  if (!validProfileName(name)) return "Use 1 to 20 characters, without control characters.";
  if (profiles.some(profile => profile !== ignore && profile.name.toLowerCase() === normalized.toLowerCase())) {
    return "That name is already in use. Choose another name.";
  }
  return null;
}

/** Entry screen: pick an existing device profile, create one, or rename one. Rendered before play when none is active. */
export function ProfileGate({ profiles, onSelect, onCreate, onRename, onDismiss }: {
  profiles: PlayerProfile[];
  onSelect: (profile: PlayerProfile) => void;
  onCreate: (profile: PlayerProfile) => void;
  onRename: (profile: PlayerProfile, name: string) => void;
  onDismiss?: () => void;
}) {
  const translateText = useTranslation(profileTranslations);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<PlayerProfile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const createError = nameErrorKey(name, profiles);
  const renameError = renaming ? nameErrorKey(renameValue, profiles, renaming) : null;
  return (
    <div className="min-h-dvh px-4 pb-10 pt-10 sm:pt-16">
      <section className="panel mx-auto max-w-xl p-6 sm:p-8" aria-label={translateText("Who's playing?")}>
        <Logo />
        <p className="eyebrow mt-4">{translateText("Who's playing?")}</p>
        <h1 className="mt-2 font-serif text-3xl">{translateText("Your player profile")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{translateText("Game history is stored on this device only and shared with the shared board after each game.")}</p>
        {profiles.length > 0 && (
          <ul className="mt-5 space-y-2" aria-label={translateText("Your player profile")}>
            {profiles.map(profile => (
              <li key={profile.id} className="flex items-center gap-2">
                {renaming?.id === profile.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onSubmit={event => {
                      event.preventDefault();
                      if (renameError) return;
                      onRename(profile, renameValue.trim().normalize("NFC"));
                      setRenaming(null);
                    }}
                  >
                    <input
                      className="field min-w-0 flex-1"
                      maxLength={20}
                      autoComplete="nickname"
                      value={renameValue}
                      aria-label={translateText("Profile name")}
                      aria-invalid={Boolean(renameError)}
                      aria-describedby="profile-rename-help"
                      onChange={event => setRenameValue(event.target.value)}
                    />
                    <button className="button-secondary shrink-0 px-3 text-xs" type="submit" disabled={Boolean(renameError)}>
                      {translateText("Save name")}
                    </button>
                    <button className="button-secondary shrink-0 px-3 text-xs" type="button" onClick={() => setRenaming(null)}>
                      {translateText("Cancel")}
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="button-secondary flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 px-4 text-left"
                      onClick={() => onSelect(profile)}
                    >
                      <strong className="min-w-0 truncate">{profile.name}</strong>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {translateText("{games} games / {wins} wins / {points} total points", profileStats(profile))}
                      </span>
                    </button>
                    <button
                      className="button-secondary shrink-0 px-3 text-xs"
                      aria-label={translateText("Rename {name}", { name: profile.name })}
                      onClick={() => { setRenaming(profile); setRenameValue(profile.name); }}
                    >
                      {translateText("Rename")}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {renaming && renameError && (
          <p id="profile-rename-help" role="alert" className="mt-2 text-xs text-clay">{translateText(renameError)}</p>
        )}
        <form
          className="mt-5 space-y-3"
          onSubmit={event => {
            event.preventDefault();
            if (createError) return;
            onCreate(createProfile(name));
          }}
        >
          <label className="block text-sm font-semibold">
            {translateText("Profile name")}
            <input
              className="field mt-2"
              maxLength={20}
              autoComplete="nickname"
              value={name}
              aria-invalid={Boolean(createError)}
              aria-describedby="profile-name-help"
              onChange={event => setName(event.target.value)}
            />
          </label>
          <p id="profile-name-help" aria-live="polite" className={`text-xs ${createError ? "text-clay" : "text-muted"}`}>
            {translateText(createError ?? "Use 1 to 20 characters, without control characters.")}
          </p>
          <button className="button-primary w-full" disabled={Boolean(createError)}>
            {translateText("Create and continue")}
          </button>
        </form>
        {onDismiss && (
          <button className="button-secondary mt-4 w-full" onClick={onDismiss}>
            {translateText("Keep current profile")}
          </button>
        )}
      </section>
    </div>
  );
}
