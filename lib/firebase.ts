import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export type FirebaseServices = {
  auth: Auth;
  db: Firestore;
};

function configFromWindow(): FirebaseOptions | null {
  if (typeof window === "undefined") return null;
  const config = window.__LIFETIME_FIREBASE_CONFIG__;
  if (!config || !config.apiKey || !config.projectId || !config.appId) return null;
  return config;
}

export function firebaseConfigured() {
  return Boolean(configFromWindow());
}

export function getFirebaseServices(): FirebaseServices | null {
  const config = configFromWindow();
  if (!config) return null;
  const app = getApps().length ? getApp() : initializeApp(config);
  return { auth: getAuth(app), db: getFirestore(app) };
}
