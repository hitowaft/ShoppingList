import { auth, onAuthStateChanged, signOut, signInAnonymously } from "./firebase.js";

let pendingAnonymousSignIn = null;

const ensureAnonymousUser = () => {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }
  if (pendingAnonymousSignIn) {
    return pendingAnonymousSignIn;
  }

  pendingAnonymousSignIn = signInAnonymously(auth)
    .then((credential) => credential.user)
    .catch((error) => {
      console.error("匿名サインインに失敗しました:", error);
      throw error;
    })
    .finally(() => {
      pendingAnonymousSignIn = null;
    });

  return pendingAnonymousSignIn;
};

export const ensureAuthUser = () => ensureAnonymousUser();

export const observeAuthState = (callback) => {
  ensureAnonymousUser().catch(() => {});
  return onAuthStateChanged(auth, callback);
};

export const getCurrentUser = () => auth.currentUser;

export const signOutUser = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("サインアウトに失敗しました:", error);
    throw error;
  }
  try {
    await ensureAnonymousUser();
  } catch (error) {
    console.error("サインアウト後の匿名サインインに失敗しました:", error);
  }
};

// 初期化時に匿名ユーザーを確保しておく
ensureAnonymousUser().catch((error) => {
  console.error("初期匿名サインインに失敗しました:", error);
});
