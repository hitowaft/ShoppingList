import {
  auth,
  signInWithPopup,
  signOut,
  googleAuthProvider,
  onAuthStateChanged,
} from "./firebase.js";

googleAuthProvider.setCustomParameters({ prompt: "select_account" });

export const signInWithGoogle = async () => {
  const provider = googleAuthProvider;
  return signInWithPopup(auth, provider);
};

export const signOutUser = () => signOut(auth);

export const observeAuthState = (callback) => onAuthStateChanged(auth, callback);

export const getCurrentUser = () => auth.currentUser;
