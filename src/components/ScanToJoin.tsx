import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Dialog } from "./GameUi";
import { useTranslation } from "../localization";
import { appTranslations } from "../translations/app";
import { parseInvitationUrl } from "../multiplayer/invitation";

type ScanNotice = "scanning" | "joining" | "invalid" | "foreign";
type CameraFailure = "permission" | "unavailable" | null;

/** Scans the host's invitation QR with this device's camera and opens the join flow. */
export function ScanToJoin({ onClose }: { onClose: () => void }) {
  const translateText = useTranslation(appTranslations);
  const videoReference = useRef<HTMLVideoElement>(null);
  const [cameraFailure, setCameraFailure] = useState<CameraFailure>(null);
  const [notice, setNotice] = useState<ScanNotice>("scanning");

  useEffect(() => {
    const video = videoReference.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const scan = () => {
      if (!video.videoWidth || !context) return;
      const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
      if (!code) return;
      const invitation = parseInvitationUrl(code.data);
      if (!invitation) {
        setNotice("invalid");
        return;
      }
      if (invitation.url.origin !== window.location.origin) {
        setNotice("foreign");
        return;
      }
      setNotice("joining");
      window.clearInterval(timer);
      window.location.assign(invitation.url.href);
    };
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraFailure("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch (failure) {
        setCameraFailure(
          failure instanceof DOMException && (failure.name === "NotAllowedError" || failure.name === "SecurityError")
            ? "permission"
            : "unavailable",
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      timer = window.setInterval(scan, 250);
    };
    void start();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    };
  }, []);

  return (
    <Dialog title={translateText("Scan to join a board")} onClose={onClose}>
      {cameraFailure ? (
        <p role="alert" className="text-sm leading-6 text-clay">
          {translateText(cameraFailure === "permission"
            ? "Allow camera access to scan, or use your phone's camera app on the host's code."
            : "In-app scanning needs camera access over HTTPS. Use your phone's camera app on the host's code instead.")}
        </p>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-xl bg-ink">
            <video ref={videoReference} muted playsInline className="aspect-square w-full object-cover" />
            {notice === "joining" && (
              <p role="status" className="absolute inset-0 flex items-center justify-center bg-ink/60 p-6 text-center font-serif text-xl text-white">
                {translateText("Invitation found. Joining...")}
              </p>
            )}
          </div>
          <p aria-live="polite" className={`mt-4 text-sm leading-6 ${notice === "scanning" ? "text-muted" : "text-clay"}`}>
            {translateText(notice === "invalid"
              ? "This code is not a Catania invitation."
              : notice === "foreign"
                ? "This invitation belongs to another address. Scan the code on this game's host screen."
                : "Point your camera at the invitation code on the host's screen.")}
          </p>
        </>
      )}
    </Dialog>
  );
}
