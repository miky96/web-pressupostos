import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';

/** Projecte "demo-*": l'emulador no necessita cap projecte real ni credencials. */
export const DEMO_PROJECT_ID = 'demo-pressupostos';

const env = import.meta.env;
const useEmulators = env.MODE === 'emulator' || env.VITE_USE_EMULATORS === 'true';

function config(): FirebaseOptions | null {
  if (env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_API_KEY && !useEmulators) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    };
  }
  if (useEmulators) return { apiKey: 'demo-key', authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`, projectId: DEMO_PROJECT_ID };
  return null;
}

/** Retorna null si no hi ha configuració de Firebase: l'app funciona amb localStorage. */
export function initFirebase() {
  const options = config();
  if (!options) return null;
  const app = initializeApp(options);
  const auth = getAuth(app);
  // Firestore no accepta `undefined`: així els camps opcionals buits simplement no s'escriuen.
  // Long polling en lloc de streaming: alguns proxies corporatius, VPN i bloquejadors tallen el
  // canal de streaming i el client es queda "offline". Per a aquesta app (poques lectures) no hi ha diferència.
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true, experimentalForceLongPolling: true });
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { app, auth, db, emulated: useEmulators };
}

export type FirebaseHandles = NonNullable<ReturnType<typeof initFirebase>>;
