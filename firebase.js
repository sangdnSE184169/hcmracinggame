//=========================================================================
// Firebase Realtime Database Setup
//=========================================================================

// Firebase is loaded via script tags in HTML files
// This module provides a wrapper for Firebase functions

// Get Firebase config from window or environment
function getFirebaseConfig() {
  // Check if config is set in window (by inline script)
  if (window.FIREBASE_CONFIG) {
    return window.FIREBASE_CONFIG;
  }
  
  // Fallback: read from meta tags or use environment variables
  // For Vercel: these should be injected at build time or via meta tags
  const metaTags = {
    apiKey: document.querySelector('meta[name="firebase-api-key"]')?.content,
    authDomain: document.querySelector('meta[name="firebase-auth-domain"]')?.content,
    databaseURL: document.querySelector('meta[name="firebase-database-url"]')?.content,
    projectId: document.querySelector('meta[name="firebase-project-id"]')?.content,
    storageBucket: document.querySelector('meta[name="firebase-storage-bucket"]')?.content,
    messagingSenderId: document.querySelector('meta[name="firebase-messaging-sender-id"]')?.content,
    appId: document.querySelector('meta[name="firebase-app-id"]')?.content
  };
  
  // Return config if all fields are present
  if (Object.values(metaTags).every(v => v)) {
    return metaTags;
  }
  
  // Last resort: empty config (will need to be set)
  return {
    apiKey: '',
    authDomain: '',
    databaseURL: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  };
}

// Initialize Firebase
let app, auth, db;

export function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK not loaded. Include Firebase scripts in HTML.');
    return false;
  }

  try {
    const config = getFirebaseConfig();
    if (!config.apiKey) {
      console.error('Firebase config not found. Set FIREBASE_CONFIG in window or use meta tags.');
      return false;
    }

    // Initialize if not already initialized
    if (!app) {
      app = firebase.initializeApp(config);
      auth = firebase.auth();
      db = firebase.database();
    }
    return true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    return false;
  }
}

// Auto-initialize when module loads (if Firebase is already available)
if (typeof firebase !== 'undefined') {
  initFirebase();
}

// Export Firebase functions
export function getAuth() {
  if (!auth) initFirebase();
  return auth;
}

export function getDatabase() {
  if (!db) initFirebase();
  return db;
}

export function ref(path) {
  return getDatabase().ref(path);
}

export function set(ref, value) {
  return ref.set(value);
}

export function update(ref, updates) {
  return ref.update(updates);
}

export function push(ref, value) {
  return ref.push(value);
}

export function onValue(ref, callback) {
  return ref.on('value', callback);
}

export function get(ref) {
  return ref.once('value');
}

export function off(ref, eventType, callback) {
  if (callback) {
    return ref.off(eventType, callback);
  }
  return ref.off();
}

export function signInAnonymously() {
  return getAuth().signInAnonymously();
}

export function onAuthStateChanged(callback) {
  return getAuth().onAuthStateChanged(callback);
}
