import { Capacitor, registerPlugin } from "@capacitor/core";

export interface InternalBrowserOpenOptions {
  url: string;
  title?: string;
}

export interface InternalBrowserOpenResult {
  action: "download" | "closed";
  url?: string;
  title?: string;
  lastUrl?: string;
}

interface InternalBrowserPluginInterface {
  open(options: InternalBrowserOpenOptions): Promise<InternalBrowserOpenResult>;
}

const InternalBrowserPlugin = registerPlugin<InternalBrowserPluginInterface>(
  "InternalBrowser"
);

export interface BrowserNovelEventDetail {
  url: string;
  title?: string;
}

export function isInternalBrowserAvailable(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.isPluginAvailable("InternalBrowser")
    );
  } catch {
    return false;
  }
}

/**
 * Opens the native Android In-App WebView Browser (with site tabs, R18 cookies,
 * and automatic 1-tap novel download detection). Falls back to opening a new
 * browser tab when running on the web.
 */
export async function openInternalBrowser(
  url: string,
  title?: string
): Promise<InternalBrowserOpenResult> {
  if (isInternalBrowserAvailable()) {
    return await InternalBrowserPlugin.open({ url, title });
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return { action: "closed", lastUrl: url };
}
