import { useState } from "react";
import { Dialog, Logo } from "./GameUi";
import { ProfileAvatar } from "./ProfileAvatar";
import { useLanguage, useTranslation } from "../localization";
import { profileTranslations } from "../translations/profile";
import { createProfile, validProfileName, type PlayerProfile, type ProfileGame } from "../profile";

function nameErrorKey(name: string, profiles: PlayerProfile[], ignore?: PlayerProfile): keyof typeof profileTranslations | null {
  const normalized = name.trim().normalize("NFC");
  if (!validProfileName(name)) return "Use 1 to 20 characters, without control characters.";
  if (profiles.some(profile => profile !== ignore && profile.name.toLowerCase() === normalized.toLowerCase())) {
    return "That name is already in use. Choose another name.";
  }
  return null;
}

/** Entry screen: pick an existing device profile, create one, or rename one. Rendered before play when none is active. */
export function ProfileGate({ profiles, activeProfileId, onSelect, onCreate, onRename, onDelete, onReplay }: {
  profiles: PlayerProfile[];
  activeProfileId?: string;
  onSelect: (profile: PlayerProfile) => void;
  onCreate: (profile: PlayerProfile) => void;
  onRename: (profile: PlayerProfile, name: string) => void;
  onDelete: (profile: PlayerProfile) => boolean;
  onReplay: (profile: PlayerProfile, game: ProfileGame) => void;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(profileTranslations);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [renaming, setRenaming] = useState<PlayerProfile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<PlayerProfile | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const createError = nameErrorKey(name, profiles);
  const showCreateError = Boolean(createError) && (name.length > 0 || nameTouched);
  const renameError = renaming ? nameErrorKey(renameValue, profiles, renaming) : null;
  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,_var(--color-moss),_transparent_65%)] px-4 pb-8 sm:px-8">
      <header className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 py-5 sm:py-8">
        <Logo />
      </header>
      <main className="mx-auto max-w-xl pt-5 sm:pt-10">
        <section aria-label={translateText("Who's playing?")}>
          <div className="mb-8">
            <p className="eyebrow">{translateText("Who's playing?")}</p>
            <h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{translateText("Your player profile")}</h1>
            <p className="mt-3 text-sm leading-6 text-muted">{translateText("Pick a profile and make yourself at home.")}</p>
          </div>
          {profiles.length > 0 && (
            <ul className="space-y-3" aria-label={translateText("Your player profile")}>
              {profiles.map(profile => (
                <li key={profile.id} className={`rounded-2xl border p-4 sm:p-5 ${profile.id === activeProfileId ? "border-forest bg-white/70" : "border-line bg-white/45"}`}>
                  {renaming?.id === profile.id ? (
                    <form
                      className="space-y-3"
                      onSubmit={event => {
                        event.preventDefault();
                        if (renameError) return;
                        onRename(profile, renameValue.trim().normalize("NFC"));
                        setRenaming(null);
                      }}
                    >
                      <label className="block text-sm font-semibold">
                        {translateText("Rename {name}", { name: profile.name })}
                        <input
                          className="field mt-2"
                          maxLength={20}
                          autoComplete="nickname"
                          autoFocus
                          value={renameValue}
                          aria-label={translateText("Profile name")}
                          aria-invalid={Boolean(renameError)}
                          aria-describedby={renameError ? "profile-rename-help" : undefined}
                          onChange={event => setRenameValue(event.target.value)}
                        />
                      </label>
                      {renameError && (
                        <p id="profile-rename-help" role="alert" className="text-xs text-clay">{translateText(renameError)}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button className="button-primary" type="submit" disabled={Boolean(renameError)}>
                          {translateText("Save name")}
                        </button>
                        <button className="button-secondary" type="button" onClick={() => setRenaming(null)}>
                          {translateText("Cancel")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="relative">
                      <button
                        className="absolute inset-0 w-full rounded-lg hover:bg-moss/40"
                        aria-label={translateText("Continue as {name}", { name: profile.name })}
                        onClick={() => onSelect(profile)}
                      />
                      <div className="pointer-events-none relative">
                        <div className="flex min-w-0 items-center gap-3">
                          <ProfileAvatar name={profile.name} />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1">
                              <strong className="min-w-0 truncate text-base">{profile.name}</strong>
                              <button
                                className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-moss hover:text-ink"
                                aria-label={translateText("Rename {name}", { name: profile.name })}
                                title={translateText("Rename")}
                                onClick={() => { setRenaming(profile); setRenameValue(profile.name); }}
                              >
                                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" strokeLinejoin="round" />
                                </svg>
                              </button>
                              <button
                                className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-clay/10 hover:text-clay"
                                aria-label={translateText("Delete {name}", { name: profile.name })}
                                title={translateText("Delete profile")}
                                onClick={() => { setDeleting(profile); setDeleteError(false); }}
                              >
                                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </div>
                            {profile.id === activeProfileId && <span className="mt-1 block text-xs text-muted">{translateText("Current profile")}</span>}
                          </div>
                          <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="m9 6 6 6-6 6" />
                          </svg>
                        </div>
                        <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line/70 pt-3">
                          {([
                            ["Games", profile.games],
                            ["Wins", profile.wins],
                            ["Win rate", `${profile.games > 0 ? Math.round((profile.wins / profile.games) * 100) : 0}%`],
                            ["Total points", profile.totalPoints],
                          ] as const).map(([label, value]) => (
                            <span key={label}>
                              <span className="block text-lg font-semibold tabular-nums">{value}</span>
                              <span className="block text-xs text-muted">{translateText(label)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <details className="mt-4 border-t border-line/70 pt-1">
                    <summary className="min-h-11 cursor-pointer content-center rounded-lg text-xs font-semibold text-muted">
                      {translateText("Game history")} <span className="tabular-nums">({profile.history.length})</span>
                    </summary>
                    {profile.history.length === 0 ? (
                      <p className="py-3 text-xs leading-5 text-muted">{translateText("Completed games will appear here.")}</p>
                    ) : (
                      <ol className="space-y-2 pb-2" aria-label={translateText("Game history for {name}", { name: profile.name })}>
                        {profile.history.map(game => (
                          <li key={game.gameId} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/60 px-3 py-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2.5">
                                <span
                                  role="img"
                                  aria-label={translateText(game.won ? "Won" : "Lost")}
                                  title={translateText(game.won ? "Won" : "Lost")}
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${game.won ? "bg-forest/50 text-ink" : "bg-clay/15 text-clay"}`}
                                >
                                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    {game.won ? <path d="m5 13 4 4L19 7" /> : <path d="M6 6l12 12M18 6 6 18" />}
                                  </svg>
                                </span>
                                <span className="truncate text-sm font-medium">{translateText(game.variant === "seafarers" ? "Seafarers" : "Original")}</span>
                              </div>
                              <time className="mt-1 block text-xs text-muted" dateTime={game.completedAt}>
                                {new Date(game.completedAt).toLocaleDateString(language === "ja" ? "ja-JP" : "en-US", { dateStyle: "medium" })}
                              </time>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <span
                                role="img"
                                aria-label={translateText("{turns} turns", { turns: game.turnCount })}
                                title={translateText("{turns} turns", { turns: game.turnCount })}
                                className="mr-3 flex items-center gap-1.5"
                              >
                                <svg aria-hidden="true" className="h-3.5 w-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" />
                                  <path d="M21 3v5h-5" />
                                </svg>
                                <span className="font-serif text-2xl leading-none tabular-nums">{game.turnCount}</span>
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="text-[9px] text-muted">{translateText("VP")}</span>
                                <span className="font-serif text-2xl leading-none tabular-nums">{game.points}</span>
                              </span>
                              <button
                                className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-moss hover:text-ink"
                                aria-label={translateText("Replay map")}
                                title={translateText("Replay map")}
                                onClick={() => onReplay(profile, game)}
                              >
                                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M8 5.5v13l10-6.5Z" />
                                </svg>
                              </button>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}
          <form
            className={`${profiles.length > 0 ? "mt-8 border-t border-line pt-7" : "panel p-5 sm:p-6"} space-y-4`}
            aria-label={translateText("Create a profile")}
            onSubmit={event => {
              event.preventDefault();
              if (createError) return;
              onCreate(createProfile(name));
            }}
          >
            <h2 className="font-serif text-xl">{translateText("Create a profile")}</h2>
            <label className="block text-sm font-semibold">
              {translateText("Profile name")}
              <input
                className="field mt-2"
                maxLength={20}
                autoComplete="nickname"
                value={name}
                aria-invalid={showCreateError}
                aria-describedby="profile-name-help"
                onBlur={() => setNameTouched(true)}
                onChange={event => setName(event.target.value)}
              />
            </label>
            <p id="profile-name-help" aria-live="polite" className={`text-xs leading-5 ${showCreateError ? "text-clay" : "text-muted"}`}>
              {translateText(showCreateError && createError ? createError : "Choose a name to use at the table.")}
            </p>
            <button className="button-primary w-full sm:w-auto" disabled={Boolean(createError)}>
              {translateText("Create and continue")}
            </button>
          </form>
          <p className="mt-8 text-xs leading-5 text-muted">{translateText("Profiles and game history stay on this device. Only lifetime totals are shared after multiplayer games.")}</p>
        </section>
      </main>
      {deleting && (
        <Dialog title={translateText("Delete profile?")} onClose={() => setDeleting(null)}>
          <p className="text-sm leading-6 text-muted">{translateText("This permanently deletes {name}, including all stats and game history on this device. This cannot be undone.", { name: deleting.name })}</p>
          {deleteError && <p role="alert" className="mt-3 text-sm text-clay">{translateText("The profile could not be deleted. Check browser storage and try again.")}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button className="button-secondary" onClick={() => setDeleting(null)}>{translateText("Cancel")}</button>
            <button className="button-primary bg-clay text-white" onClick={() => {
              if (!onDelete(deleting)) {
                setDeleteError(true);
                return;
              }
              setDeleting(null);
            }}>{translateText("Delete profile")}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
