/* ============================================================
   FIREBASE CONFIG — real backend (Auth, Firestore, Storage)
   ============================================================
   Requires the Firebase compat SDK <script> tags (app, auth,
   firestore, storage) to be loaded before this file — see the
   <head>/script block of any page that includes this file.
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyBkGSjwewBHTwf1SSNb7hbNkLaD89X-onk",
  authDomain: "glorykidsministries-3d279.firebaseapp.com",
  projectId: "glorykidsministries-3d279",
  storageBucket: "glorykidsministries-3d279.firebasestorage.app",
  messagingSenderId: "654046022854",
  appId: "1:654046022854:web:65faf55f0fc735bcc29bc7",
  measurementId: "G-LXLLC9HVD6"
};

firebase.initializeApp(firebaseConfig);

window.auth = firebase.auth();
window.db = firebase.firestore();
window.storage = firebase.storage();
window.googleProvider = new firebase.auth.GoogleAuthProvider();
