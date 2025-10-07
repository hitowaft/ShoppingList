import { signInWithGoogle, observeAuthState } from "./auth.js";
import { acceptInvite as acceptInviteViaApi } from "./api.js";

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
        const { listId: joinedListId, alreadyMember } = await acceptInviteViaApi(pendingInviteCode);
        if (joinedListId) {
          sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, joinedListId);
        }
        setStatus(alreadyMember ? 'すでに共有リストに参加済みです。アプリに移動します…' : '招待が承認されました。アプリに移動します…');
        clearInviteFromUrl();
        pendingInviteCode = '';
        navigateToApp(800);
        return;
      } catch (error) {
        console.error('招待の処理に失敗しました:', error);
        const friendlyMessage = error?.message ?? error?.details?.message ?? '招待の処理に失敗しました。';
        setStatus(friendlyMessage);
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
