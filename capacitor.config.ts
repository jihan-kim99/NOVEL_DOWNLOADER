import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.noveldownloader.app",
  appName: "Novel Downloader",
  webDir: "out",
  plugins: {
    CapacitorHttp: {
      // Keep global fetch unpatched; we call CapacitorHttp.request() explicitly
      enabled: false,
    },
    CapacitorCookies: {
      enabled: true,
    },
  },
};

export default config;
