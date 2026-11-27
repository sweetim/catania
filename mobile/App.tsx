import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { CATANIA_WEB_BUNDLE_HTML } from "./generated/webBundle";

const WEB_ORIGIN = "https://catania.timx.co";
const DEFAULT_URL = `${WEB_ORIGIN}/`;
const PAPER_BACKGROUND = "#f6f3eb";

type WebToNativeMessage =
  | { type: "haptic"; pattern: "turnStart" | "incomingTrade" }
  | { type: "scanQr" };

function parseInvitationToAppUrl(rawText: string): string | null {
  try {
    const parsedUrl = new URL(rawText);
    if (!parsedUrl.searchParams.has("multiplayer")) return null;
    const hashParameters = new URLSearchParams(parsedUrl.hash.slice(1));
    const hostId = hashParameters.get("host");
    const secret = hashParameters.get("secret");
    if (!hostId || !secret) return null;
    return `${WEB_ORIGIN}/?multiplayer=1#host=${encodeURIComponent(hostId)}&secret=${encodeURIComponent(secret)}`;
  } catch {
    return null;
  }
}

function normalizeDeepLinkUrl(incomingUrl: string): string | null {
  const invitationUrl = parseInvitationToAppUrl(incomingUrl);
  if (invitationUrl) return invitationUrl;

  try {
    const parsedUrl = new URL(incomingUrl);
    if (parsedUrl.origin === WEB_ORIGIN) {
      return `${WEB_ORIGIN}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    }
    if (parsedUrl.protocol === "catania:") {
      const normalizedPath = parsedUrl.pathname.startsWith("/") ? parsedUrl.pathname : `/${parsedUrl.pathname}`;
      return `${WEB_ORIGIN}${normalizedPath}${parsedUrl.search}${parsedUrl.hash}`;
    }
  } catch {
    return null;
  }
  return null;
}

function CataniaMobileShell() {
  const webViewReference = useRef<ComponentRef<typeof WebView>>(null);
  const [currentUrl, setCurrentUrl] = useState<string>(DEFAULT_URL);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [scannerVisible, setScannerVisible] = useState<boolean>(false);
  const [scannerMessage, setScannerMessage] = useState<string>("Point your camera at the invitation code on the host's screen.");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const hasScannedReference = useRef<boolean>(false);

  const navigateOffline = useCallback((targetUrl: string) => {
    setCurrentUrl(targetUrl);
    setReloadKey((previousKey) => previousKey + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void Linking.getInitialURL().then((initialUrl) => {
      if (!active || !initialUrl) return;
      const normalized = normalizeDeepLinkUrl(initialUrl);
      if (normalized && normalized !== DEFAULT_URL) {
        navigateOffline(normalized);
      }
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const normalized = normalizeDeepLinkUrl(url);
      if (normalized) {
        navigateOffline(normalized);
      }
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [navigateOffline]);

  const closeScanner = useCallback(() => {
    setScannerVisible(false);
    hasScannedReference.current = false;
    webViewReference.current?.injectJavaScript(
      'window.dispatchEvent(new Event("catania-native-scan-closed")); true;',
    );
  }, []);

  const openScanner = useCallback(async () => {
    hasScannedReference.current = false;
    setScannerMessage("Point your camera at the invitation code on the host's screen.");
    if (!cameraPermission?.granted) {
      await requestCameraPermission();
    }
    setScannerVisible(true);
  }, [cameraPermission?.granted, requestCameraPermission]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (hasScannedReference.current) return;
      const invitationUrl = parseInvitationToAppUrl(result.data);
      if (!invitationUrl) {
        setScannerMessage("This code is not a Catania invitation.");
        return;
      }
      hasScannedReference.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScannerVisible(false);
      navigateOffline(invitationUrl);
    },
    [navigateOffline],
  );

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: WebToNativeMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as WebToNativeMessage;
      } catch {
        return;
      }

      if (message.type === "haptic") {
        if (message.pattern === "turnStart") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        return;
      }

      if (message.type === "scanQr") {
        void openScanner();
      }
    },
    [openScanner],
  );

  const handleShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      const requestUrl = request.url;
      if (requestUrl === "about:blank" || requestUrl === currentUrl) {
        return true;
      }
      if (requestUrl.startsWith(WEB_ORIGIN)) {
        navigateOffline(requestUrl);
        return false;
      }
      if (requestUrl.startsWith("http://") || requestUrl.startsWith("https://")) {
        void Linking.openURL(requestUrl);
        return false;
      }
      return true;
    },
    [currentUrl, navigateOffline],
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="dark" />
      <WebView
        ref={webViewReference}
        key={reloadKey}
        source={{ html: CATANIA_WEB_BUNDLE_HTML, baseUrl: currentUrl }}
        style={styles.webView}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        bounces={false}
        overScrollMode="never"
        onMessage={handleWebViewMessage}
        onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
      />

      <Modal visible={scannerVisible} animationType="slide" onRequestClose={closeScanner}>
        <SafeAreaView style={styles.scannerContainer} edges={["top", "left", "right", "bottom"]}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>Scan to join a board</Text>
            <Pressable onPress={closeScanner} style={styles.closeButton} accessibilityRole="button">
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>

          {cameraPermission?.granted ? (
            <View style={styles.cameraFrame}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={handleBarcodeScanned}
              />
            </View>
          ) : (
            <View style={styles.permissionBox}>
              <Text style={styles.permissionText}>
                Allow camera access to scan the host's invitation QR code.
              </Text>
              <Pressable onPress={() => void requestCameraPermission()} style={styles.primaryButton} accessibilityRole="button">
                <Text style={styles.primaryButtonText}>Allow camera</Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.scannerNotice}>{scannerMessage}</Text>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CataniaMobileShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PAPER_BACKGROUND,
  },
  webView: {
    flex: 1,
    backgroundColor: PAPER_BACKGROUND,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: "#1c2f2b",
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  scannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  scannerTitle: {
    color: "#f6f3eb",
    fontSize: 20,
    fontWeight: "600",
  },
  closeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(246, 243, 235, 0.16)",
  },
  closeButtonText: {
    color: "#f6f3eb",
    fontSize: 15,
    fontWeight: "600",
  },
  cameraFrame: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#0e1917",
  },
  permissionBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  permissionText: {
    color: "#f6f3eb",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  primaryButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#b0cdc1",
  },
  primaryButtonText: {
    color: "#1c2f2b",
    fontSize: 16,
    fontWeight: "700",
  },
  scannerNotice: {
    marginTop: 16,
    color: "#d9e3df",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
