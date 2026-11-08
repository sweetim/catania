import type { Invitation } from "./types";

/** Parses a Catania invitation link (`?multiplayer=1#host=...&secret=...`); returns null for anything else. */
export function parseInvitationUrl(text: string): (Invitation & { url: URL }) | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!url.searchParams.has("multiplayer")) return null;
  const parameters = new URLSearchParams(url.hash.slice(1));
  const hostId = parameters.get("host");
  const secret = parameters.get("secret");
  return hostId && secret ? { hostId, secret, url } : null;
}
