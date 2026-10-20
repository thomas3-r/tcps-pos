// Paste the web app config from Firebase console > Project settings > Your apps.
// These values are public by design; the Firestore rules protect the data.
export const firebaseConfig = {
  apiKey: 'AIzaSyACRksSLFO3iizF3fPLI0RbNR1E9E9i6dE',
  authDomain: 'tcps-pos.firebaseapp.com',
  projectId: 'tcps-pos',
  storageBucket: 'tcps-pos.firebasestorage.app',
  messagingSenderId: '594434312947',
  appId: '1:594434312947:web:80d8dcdc518936789a4586',
};

// Main managers always have manager access, even before any staff are set up.
// Stored as SHA-256 hashes of the lowercase emails so the addresses aren't public. Must match OWNERS in firestore.rules.
export const OWNER_EMAIL_SHA256 = [
  'c9d4159b74bc817918fef5ce5e8f8780380a0d875c47a4b97587d71af6576f64',
  'becf6931a640dfa4f8f0a686447349fd7d209f1b0e9e99ee039f277042b4378f',
  '4ad85369eaac5e0e3dbdfdd6ee341d4297bf186b2fa718944e6556f5eb114c64',
];

// Logins that may clear test sales (Account tab). Same hashing as above.
export const RESET_EMAIL_SHA256 = ['4ad85369eaac5e0e3dbdfdd6ee341d4297bf186b2fa718944e6556f5eb114c64'];

export const EVENT_NAME = 'Sidapur POS';
