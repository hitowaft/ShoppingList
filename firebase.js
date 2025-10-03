// Firebaseの基本機能をインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
// Firestoreの機能をインポート
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, writeBatch, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyD3sGjRILvQQmXBCXuaDW2Lv1b_3w46Ku8",
    authDomain: "my-shopping-list-a22e0.firebaseapp.com",
    projectId: "my-shopping-list-a22e0",
    storageBucket: "my-shopping-list-a22e0.firebasestorage.app",
    messagingSenderId: "255447189589",
    appId: "1:255447189589:web:168750e727ea270805ecdc"
  };

// --- 初期化処理 ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- このファイルから他のファイルへ提供する機能 ---
// db と、よく使うFirestoreの関数をまとめてエクスポートする
export { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, writeBatch, onSnapshot, orderBy };