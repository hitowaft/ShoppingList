// Firebaseの基本機能をインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
// Firestoreの機能をインポート
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  onSnapshot,
  orderBy,
  setDoc,
  getDoc,
  serverTimestamp,
  Timestamp,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
// Authの機能をインポート
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseApiKey = (typeof import.meta !== "undefined" && import.meta?.env?.VITE_FIREBASE_API_KEY)
  || (typeof window !== "undefined" && window.__ENV?.VITE_FIREBASE_API_KEY);

if (!firebaseApiKey) {
  throw new Error("Firebase API key is not defined. Please provide VITE_FIREBASE_API_KEY via env.js.");
}

const firebaseConfig = {
  apiKey: firebaseApiKey,
  authDomain: "my-shopping-list-a22e0.firebaseapp.com",
  projectId: "my-shopping-list-a22e0",
  storageBucket: "my-shopping-list-a22e0.firebasestorage.app",
  messagingSenderId: "255447189589",
  appId: "1:255447189589:web:168750e727ea270805ecdc"
};

// --- 初期化処理 ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleAuthProvider = new GoogleAuthProvider();
const functions = getFunctions(app);

// --- このファイルから他のファイルへ提供する機能 ---
// db と、よく使うFirestoreの関数をまとめてエクスポートする
export {
  db,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  onSnapshot,
  orderBy,
  setDoc,
  getDoc,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  functions,
  httpsCallable,
  auth,
  onAuthStateChanged,
  signInWithPopup,
  googleAuthProvider,
  signOut,
  signInAnonymously
};
