import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.torikoto.app',
  appName: 'トリコト',
  webDir: 'dist',
  // The native shells load the same built web app; only the platform adapters
  // under src/platform differ at runtime.
  ios: {
    contentInset: 'never',
  },
  android: {
    // Required so getUserMedia() is reachable from the WebView origin.
    allowMixedContent: false,
  },
  plugins: {
    CapacitorHttp: { enabled: false },
  },
};

export default config;
