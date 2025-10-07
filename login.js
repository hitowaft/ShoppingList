import { signInWithGoogle, observeAuthState } from "./auth.js";
import { db, doc, getDoc, updateDoc, arrayUnion, serverTimestamp } from "./firebase.js";

const loginButton = document.getElementById("loginWithGoogle");
const statusLabel = document.getElementById("loginStatus");

let isProcessing = false;
let pendingInviteCode = '';
const ACTIVE_LIST_STORAGE_KEY = 'shopping-list.activeListId';

const setStatus = (message) => {
  if (statusLabel) {
    statusLabel.textContent = message;
  }
};

const params = new URLSearchParams(window.location.search);
pendingInviteCode = (params.get('invite') ?? '').trim();

if (pendingInviteCode) {
  setStatus('招待リンクを受け取りました。Googleでログインしてリストに参加しましょう。');
}

const clearInviteFromUrl = () => {
  if (!pendingInviteCode) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, document.title, url.toString());
};

const navigateToApp = (delayMs = 0) => {
  window.setTimeout(() => {
    window.location.replace('index.html');
  }, delayMs);
};

const acceptInvite = async (code, user) => {
  const inviteRef = doc(db, 'invites', code);
  const inviteSnapshot = await getDoc(inviteRef);

  if (!inviteSnapshot.exists()) {
    throw new Error('招待リンクが見つかりませんでした。');
  }

  const inviteData = inviteSnapshot.data();

  if (inviteData.status && inviteData.status !== 'active') {
    throw new Error('招待リンクは使用済みか無効です。');
  }

  if (inviteData.expiresAt && inviteData.expiresAt.toDate() < new Date()) {
    try {
      await updateDoc(inviteRef, { status: 'expired', expiredAt: serverTimestamp() });
    } catch (error) {
      console.warn('招待リンクの期限切れステータス更新に失敗しました:', error);
    }
    throw new Error('招待リンクの有効期限が切れています。');
  }

  if (!inviteData.listId) {
    throw new Error('招待先のリスト情報が見つかりませんでした。');
  }

  const listRef = doc(db, 'lists', inviteData.listId);
  const listSnapshot = await getDoc(listRef);

  if (!listSnapshot.exists()) {
    throw new Error('招待先のリストが削除されています。');
  }

  try {
    await updateDoc(listRef, {
      members: arrayUnion(user.uid)
    });
  } catch (error) {
    console.error('リストへの追加に失敗しました:', error);
    throw new Error('リストへの参加に失敗しました。権限をご確認ください。');
  }

  try {
    await updateDoc(inviteRef, {
      status: 'used',
      usedAt: serverTimestamp(),
      usedBy: user.uid
    });
  } catch (error) {
    console.warn('招待リンクのステータス更新に失敗しました:', error);
  }

  return inviteData.listId;
};

loginButton?.addEventListener("click", async () => {
  if (isProcessing) return;

  isProcessing = true;
  if (loginButton) {
    loginButton.disabled = true;
  }
  setStatus("ログイン処理を行っています…");

  try {
    await signInWithGoogle();
    setStatus("ログインが完了しました。アプリに移動します…");
  } catch (error) {
    console.error("ログインに失敗しました:", error);
    setStatus("ログインに失敗しました。時間をおいて再度お試しください。");
    if (loginButton) {
      loginButton.disabled = false;
    }
    isProcessing = false;
  }
});

observeAuthState(async (user) => {
  if (user) {
    const displayName = user.displayName ?? 'ユーザー';

    if (pendingInviteCode) {
      setStatus('招待リンクを確認しています…');
      try {
        const joinedListId = await acceptInvite(pendingInviteCode, user);
        if (joinedListId) {
          sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, joinedListId);
        }
        setStatus('招待が承認されました。アプリに移動します…');
        clearInviteFromUrl();
        pendingInviteCode = '';
        navigateToApp(800);
        return;
      } catch (error) {
        console.error('招待の処理に失敗しました:', error);
        setStatus(error.message ?? '招待の処理に失敗しました。');
        clearInviteFromUrl();
        pendingInviteCode = '';
        sessionStorage.removeItem(ACTIVE_LIST_STORAGE_KEY);
        navigateToApp(1500);
        return;
      }
    } else {
      setStatus(`${displayName}でログインしています。アプリに移動します…`);
    }
    navigateToApp(500);
  } else {
    if (pendingInviteCode) {
      setStatus('招待リンクを受け取りました。Googleでログインしてリストに参加しましょう。');
    } else {
      setStatus('Google アカウントでログインしてください。');
    }
    if (loginButton) {
      loginButton.disabled = false;
    }
    isProcessing = false;
  }
});
