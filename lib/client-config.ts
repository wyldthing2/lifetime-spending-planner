declare global {
  interface Window {
    __LIFETIME_WORKSPACE_API__?: string;
    __LIFETIME_FIREBASE_CONFIG__?: {
      apiKey: string;
      authDomain: string;
      projectId: string;
      storageBucket: string;
      messagingSenderId: string;
      appId: string;
    };
  }
}

export function workspaceApiBase() {
  return typeof window === "undefined" ? "" : window.__LIFETIME_WORKSPACE_API__ ?? "";
}

export {};
