type NativeWebViewBridge = {
  postMessage: (message: string) => void;
};

type NativeWindow = Window & {
  ReactNativeWebView?: NativeWebViewBridge;
  __CATANIA_NATIVE_APP__?: boolean;
};

export type NativeHapticPattern = "turnStart" | "incomingTrade";

type NativeBridgeMessage =
  | { type: "haptic"; pattern: NativeHapticPattern }
  | { type: "scanQr" };

export const NATIVE_SCAN_CLOSED_EVENT = "catania-native-scan-closed";

function getNativeWebView(): NativeWebViewBridge | null {
  if (typeof window === "undefined") return null;
  const nativeWindow = window as NativeWindow;
  return nativeWindow.__CATANIA_NATIVE_APP__ && nativeWindow.ReactNativeWebView
    ? nativeWindow.ReactNativeWebView
    : null;
}

/** Returns true when running inside the Catania iOS/Android Expo WebView shell. */
export function isNativeMobileApp(): boolean {
  return getNativeWebView() !== null;
}

function postNativeMessage(message: NativeBridgeMessage): boolean {
  const nativeWebView = getNativeWebView();
  if (!nativeWebView) return false;
  nativeWebView.postMessage(JSON.stringify(message));
  return true;
}

/** Triggers a native iOS/Android haptic feedback pattern when running in the mobile app. */
export function triggerNativeHaptic(pattern: NativeHapticPattern): boolean {
  return postNativeMessage({ type: "haptic", pattern });
}

/** Opens the native Expo Camera QR scanner when running in the mobile app. */
export function requestNativeQrScan(): boolean {
  return postNativeMessage({ type: "scanQr" });
}
