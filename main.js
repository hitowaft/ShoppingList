import { db, collection, addDoc, onSnapshot, query, orderBy, where, getDocs, serverTimestamp, doc, setDoc, Timestamp, getDoc, functions, httpsCallable } from "./firebase.js";
import { state, toggleEditMode } from './state.js';
import { updateItemStatus, deleteDbItem, clearCompletedDbItems, updateDbItemText } from "./storage.js";
import { initUI, render } from "./ui.js";
import { signOutUser, observeAuthState } from "./auth.js";
import { acceptInvite as acceptInviteViaApi } from "./api.js";

// --- DOM要素の取得 ---
const inputElement = document.getElementById('itemInput');
const addButton = document.getElementById('addButton');
const listElement = document.getElementById('itemList');
const clearCompletedButton = document.getElementById('clearCompletedButton');
const editModeButton = document.getElementById('editModeButton');
const signOutButton = document.getElementById('signOutButton');
const userStatusLabel = document.getElementById('userStatus');
const shareControlsSection = document.getElementById('shareControlsSection');
const createInviteButton = document.getElementById('createInviteButton');
const inviteLinkContainer = document.getElementById('inviteLinkContainer');
const inviteLinkField = document.getElementById('inviteLinkField');
const copyInviteLinkButton = document.getElementById('copyInviteLink');
const inviteStatusLabel = document.getElementById('inviteStatus');
const alexaLinkSection = document.getElementById('alexaLinkSection');
const generateAlexaCodeButton = document.getElementById('generateAlexaCodeButton');
const alexaLinkCodeContainer = document.getElementById('alexaLinkCodeContainer');
const alexaLinkCodeField = document.getElementById('alexaLinkCodeField');
const copyAlexaLinkCodeButton = document.getElementById('copyAlexaLinkCode');
const alexaLinkStatusLabel = document.getElementById('alexaLinkStatus');

const urlParams = new URLSearchParams(window.location.search);
let pendingInviteCode = (urlParams.get('invite') ?? '').trim();

const clearInviteFromUrl = () => {
  if (!pendingInviteCode) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, document.title, url.toString());
};

const applyListStatus = (listId, listData) => {
  const originalName = listData?.name ?? '買い物リスト';
  const normalizedName = /^共有ユーザー\(.+\)のリスト$/.test(originalName)
    ? 'マイリスト'
    : originalName;
  state.activeListId = listId;
  state.activeListName = normalizedName;
  const rawMembers = Array.isArray(listData?.members) ? listData.members : [];
  const uniqueMembers = Array.from(new Set(rawMembers.filter((member) => typeof member === 'string' && member.length > 0)));
  const memberCount = Math.max(uniqueMembers.length, 1);
  const sharingDescription = memberCount <= 1 ? 'ひとりで利用中' : `${memberCount}人で共有中`;
  setUserStatusMessage(`${normalizedName}（${sharingDescription}）`);
};

const refreshListStatus = async (listId) => {
  if (!listId) {
    return;
  }
  try {
    const listSnapshot = await getDoc(doc(db, 'lists', listId));
    if (!listSnapshot.exists()) {
      setUserStatusMessage('リスト情報を取得できませんでした。');
      return;
    }
    applyListStatus(listId, listSnapshot.data());
  } catch (error) {
    console.error('リスト情報の取得に失敗しました:', error);
    setUserStatusMessage('リスト情報の取得に失敗しました。');
  }
};

let unsubscribeFromItems = null;

const getListItemsCollection = (listId) => collection(db, "lists", listId, "items");

const listsCollection = collection(db, "lists");

const ACTIVE_LIST_STORAGE_KEY = 'shopping-list.activeListId';

const setUserStatusMessage = (message) => {
  if (userStatusLabel) {
    userStatusLabel.textContent = message;
  }
};

const defaultInviteStatusMessage = 'リンクはここに表示されます。';
let inviteStatusResetTimer = null;

const setInviteStatusMessage = (message) => {
  if (inviteStatusLabel) {
    inviteStatusLabel.textContent = message;
  }
};

const defaultAlexaStatusMessage = 'Alexaアプリで入力するコードがここに表示されます。';
let alexaStatusResetTimer = null;
let alexaTtlMessage = defaultAlexaStatusMessage;

const setAlexaLinkStatusMessage = (message) => {
  if (alexaLinkStatusLabel) {
    alexaLinkStatusLabel.textContent = message;
  }
};

const updateShareControlsVisibility = () => {
  if (shareControlsSection) {
    const isEditing = Boolean(state.isEditing);
    shareControlsSection.classList.toggle('is-hidden', !isEditing);
    if (createInviteButton) {
      createInviteButton.disabled = !isEditing;
    }
  }
  if (alexaLinkSection) {
    const isEditing = Boolean(state.isEditing);
    alexaLinkSection.classList.toggle('is-hidden', !isEditing);
    if (generateAlexaCodeButton) {
      generateAlexaCodeButton.disabled = !isEditing;
    }
  }
};

const resetInviteUI = () => {
  if (createInviteButton) {
    createInviteButton.disabled = true;
  }
  if (inviteLinkContainer) {
    inviteLinkContainer.classList.add('is-hidden');
  }
  if (inviteLinkField) {
    inviteLinkField.value = '';
  }
  if (inviteStatusResetTimer) {
    clearTimeout(inviteStatusResetTimer);
    inviteStatusResetTimer = null;
  }
  setInviteStatusMessage(defaultInviteStatusMessage);
};

resetInviteUI();

const resetAlexaLinkUI = () => {
  if (generateAlexaCodeButton) {
    generateAlexaCodeButton.disabled = true;
  }
  if (alexaLinkCodeContainer) {
    alexaLinkCodeContainer.classList.add('is-hidden');
  }
  if (alexaLinkCodeField) {
    alexaLinkCodeField.value = '';
  }
  if (alexaStatusResetTimer) {
    clearTimeout(alexaStatusResetTimer);
    alexaStatusResetTimer = null;
  }
  alexaTtlMessage = defaultAlexaStatusMessage;
  setAlexaLinkStatusMessage(defaultAlexaStatusMessage);
};

const scheduleAlexaStatusReset = () => {
  if (alexaStatusResetTimer) {
    clearTimeout(alexaStatusResetTimer);
  }
  alexaStatusResetTimer = window.setTimeout(() => {
    setAlexaLinkStatusMessage(alexaTtlMessage);
    alexaStatusResetTimer = null;
  }, 3000);
};

resetAlexaLinkUI();

const createAlexaLinkCodeCallable = httpsCallable(functions, 'createAlexaLinkCode');

const INVITE_VALID_DAYS = 7;

const generateInviteCode = () => {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(-12);
};

const buildInviteUrl = (code) => {
  const baseUrl = new URL('index.html', window.location.href);
  baseUrl.searchParams.set('invite', code);
  return baseUrl.toString();
};

const scheduleInviteStatusReset = () => {
  if (inviteStatusResetTimer) {
    clearTimeout(inviteStatusResetTimer);
  }
  inviteStatusResetTimer = window.setTimeout(() => {
    setInviteStatusMessage(`リンクをコピーして共有してください（${INVITE_VALID_DAYS}日間有効）`);
  }, 3000);
};

const handleCopyInviteLink = async () => {
  const link = inviteLinkField?.value;
  if (!link) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      inviteLinkField?.select();
      document.execCommand('copy');
    }
    setInviteStatusMessage('リンクをコピーしました！');
    scheduleInviteStatusReset();
  } catch (error) {
    console.error('リンクのコピーに失敗しました:', error);
    alert('コピーに失敗しました。表示されているリンクを手動でコピーしてください。');
  }
};

const handleCreateInviteLink = async () => {
  if (!state.userId || !state.activeListId) {
    alert('共有リストが準備できていません。ページを再読み込みしてください。');
    return;
  }

  if (createInviteButton) {
    createInviteButton.disabled = true;
  }
  setInviteStatusMessage('共有リンクを作成しています…');

  try {
    const code = generateInviteCode();
    const inviteRef = doc(collection(db, 'invites'), code);
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000));

    await setDoc(inviteRef, {
      listId: state.activeListId,
      createdBy: state.userId,
      createdAt: serverTimestamp(),
      expiresAt,
      status: 'active'
    });

    const inviteUrl = buildInviteUrl(code);

    if (inviteLinkField) {
      inviteLinkField.value = inviteUrl;
    }
    if (inviteLinkContainer) {
      inviteLinkContainer.classList.remove('is-hidden');
    }

    setInviteStatusMessage(`リンクをコピーして共有してください（${INVITE_VALID_DAYS}日間有効）`);
  } catch (error) {
    console.error('共有リンクの作成に失敗しました:', error);
    alert('共有リンクの作成に失敗しました。時間をおいて再度お試しください。');
    resetInviteUI();
  } finally {
    if (createInviteButton) {
      createInviteButton.disabled = false;
    }
  }
};

const handleGenerateAlexaLinkCode = async () => {
  if (!state.userId || !state.activeListId) {
    alert('Alexa連携コードを発行するにはリストが読み込まれている必要があります。');
    return;
  }

  if (generateAlexaCodeButton) {
    generateAlexaCodeButton.disabled = true;
  }
  if (alexaLinkCodeField) {
    alexaLinkCodeField.value = '';
  }
  if (alexaLinkCodeContainer) {
    alexaLinkCodeContainer.classList.add('is-hidden');
  }
  setAlexaLinkStatusMessage('Alexa連携コードを発行しています…');

  try {
    const { data } = await createAlexaLinkCodeCallable({ listId: state.activeListId, userId: state.userId });
    const { code, ttlMinutes } = data ?? {};

    if (!code) {
      throw new Error('リンクコードが取得できませんでした。');
    }

    const displayTtl = typeof ttlMinutes === 'number' ? ttlMinutes : null;
    alexaTtlMessage = displayTtl
      ? `Alexaアプリでコードを入力してください（${displayTtl}分間有効）`
      : 'Alexaアプリでコードを入力してください。';

    if (alexaLinkCodeField) {
      alexaLinkCodeField.value = code;
      alexaLinkCodeField.focus();
      alexaLinkCodeField.select?.();
    }
    if (alexaLinkCodeContainer) {
      alexaLinkCodeContainer.classList.remove('is-hidden');
    }

    setAlexaLinkStatusMessage(alexaTtlMessage);
  } catch (error) {
    console.error('Alexaリンクコードの生成に失敗しました:', error);
    alert('Alexa連携コードの発行に失敗しました。時間をおいて再度お試しください。');
    resetAlexaLinkUI();
  } finally {
    if (generateAlexaCodeButton) {
      generateAlexaCodeButton.disabled = !state.isEditing;
    }
  }
};

const handleCopyAlexaLinkCode = async () => {
  const linkCode = alexaLinkCodeField?.value?.trim();
  if (!linkCode) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(linkCode);
    } else {
      alexaLinkCodeField?.select();
      document.execCommand('copy');
    }
    setAlexaLinkStatusMessage('コードをコピーしました！');
    scheduleAlexaStatusReset();
  } catch (error) {
    console.error('Alexaリンクコードのコピーに失敗しました:', error);
    alert('コピーに失敗しました。表示されているコードを手動でAlexaアプリに入力してください。');
  }
};

// --- 状態が更新された後のお決まり処理をまとめた関数 ---
const handleStateUpdate = () => {
  render(state);
  updateShareControlsVisibility();
};

function startItemsSubscription(listId) {
  if (!listId) return;

  const itemsQuery = query(getListItemsCollection(listId), orderBy("createdAt", "desc"));

  unsubscribeFromItems = onSnapshot(
    itemsQuery,
    (querySnapshot) => {
      const fetchedItems = [];
      querySnapshot.forEach((doc) => {
        const itemData = doc.data();

        fetchedItems.push({
          id: doc.id,
          text: itemData.name,
          completed: itemData.completed,
        });
      });

      state.items = fetchedItems;
      handleStateUpdate();
    },
    (error) => {
      console.error("買い物リストの購読中にエラーが発生しました:", error);
    }
  );
}

function stopItemsSubscription() {
  if (unsubscribeFromItems) {
    unsubscribeFromItems();
    unsubscribeFromItems = null;
  }
}

function resetListState() {
  state.activeListId = null;
  state.activeListName = '';
  state.items = [];
  sessionStorage.removeItem(ACTIVE_LIST_STORAGE_KEY);
}

async function ensureActiveList(user) {
  const userUid = user.uid;
  state.userId = userUid;
  const storedListId = sessionStorage.getItem(ACTIVE_LIST_STORAGE_KEY);

  if (storedListId) {
    try {
      const storedListSnapshot = await getDoc(doc(db, 'lists', storedListId));
      const storedListData = storedListSnapshot.data();

      if (storedListSnapshot.exists() && Array.isArray(storedListData?.members) && storedListData.members.includes(userUid)) {
        state.activeListId = storedListSnapshot.id;
        state.activeListName = storedListData.name ?? '共有買い物リスト';
        sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, storedListSnapshot.id);
        return storedListSnapshot.id;
      }
    } catch (error) {
      console.warn('保存済みリストの読み込みに失敗しました:', error);
    }

    sessionStorage.removeItem(ACTIVE_LIST_STORAGE_KEY);
  }

  const existingListsSnapshot = await getDocs(query(listsCollection, where('members', 'array-contains', userUid)));

  if (!existingListsSnapshot.empty) {
    const firstList = existingListsSnapshot.docs[0];
    state.activeListId = firstList.id;
    state.activeListName = firstList.data().name ?? '共有買い物リスト';
    sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, firstList.id);
    return firstList.id;
  }

  const listName = 'マイリスト';

  const newListRef = await addDoc(listsCollection, {
    name: listName,
    ownerUid: userUid,
    members: [userUid],
    createdAt: serverTimestamp()
  });

  state.activeListId = newListRef.id;
  state.activeListName = listName;
  sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, newListRef.id);

  return newListRef.id;
}

async function handleSignedIn(user) {
  state.user = { uid: user.uid };
  state.userId = user.uid;

  setUserStatusMessage('リストを読み込み中…');
  resetInviteUI();
  resetAlexaLinkUI();

  try {
    let resolvedListId = null;

    if (pendingInviteCode) {
      try {
        setInviteStatusMessage('招待コードを確認しています…');
        const { listId: joinedListId } = await acceptInviteViaApi(pendingInviteCode, user.uid);
        if (joinedListId) {
          resolvedListId = joinedListId;
          state.activeListId = joinedListId;
          const joinedListSnapshot = await getDoc(doc(db, 'lists', joinedListId));
          if (joinedListSnapshot.exists()) {
            applyListStatus(joinedListId, joinedListSnapshot.data());
          }
          sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, joinedListId);
          setInviteStatusMessage('招待が承認されました。');
        } else {
          setInviteStatusMessage('招待の処理が完了しました。');
        }
      } catch (error) {
        console.error('招待の処理に失敗しました:', error);
        alert(error?.message ?? '招待の処理に失敗しました。');
        setInviteStatusMessage('招待の処理に失敗しました。');
      } finally {
        clearInviteFromUrl();
        pendingInviteCode = '';
      }
    }

    if (!resolvedListId) {
      resolvedListId = await ensureActiveList(user);
    }

    stopItemsSubscription();
    state.items = [];
    handleStateUpdate();
    startItemsSubscription(resolvedListId);
    await refreshListStatus(resolvedListId);
    if (createInviteButton) {
      createInviteButton.disabled = false;
    }
    setInviteStatusMessage('共有リンクを発行して、家族と共有しましょう。');
    setAlexaLinkStatusMessage('Alexaアプリで入力するコードがここに表示されます。');
    if (signOutButton) {
      signOutButton.classList.remove('is-hidden');
      signOutButton.textContent = 'データをリセット';
    }
  } catch (error) {
    console.error('リストの初期化に失敗しました:', error);
    alert('買い物リストを読み込めませんでした。ページを再読み込みして再試行してください。');
  }
}

function handleSignedOut() {
  state.isEditing = false;
  state.user = null;
  state.userId = null;
  stopItemsSubscription();
  resetInviteUI();
  resetAlexaLinkUI();
  resetListState();
  handleStateUpdate();
  setUserStatusMessage('リストが初期化されました。ページを再読み込みしてください。');
}

// --- イベントハンドラ関数 ---

const handleAddItem = async () => {
  if (!state.userId) {
    alert('買い物リストを利用できません。ページを再読み込みしてください。');
    return;
  }
  const listId = state.activeListId;
  if (!listId) {
    alert('共有リストが見つかりませんでした。ページを再読み込みしてください。');
    return;
  }
  const itemName = inputElement.value.trim();
  if (itemName) {
    try {
      const docRef = await addDoc(getListItemsCollection(listId), {
        name: itemName,
        completed: false,
        createdAt: serverTimestamp(),
      });
      console.log("Firestoreに保存成功！ ID: ", docRef.id);

      inputElement.value = '';

    } catch (error) {
      console.error("保存中にエラーが発生しました: ", error);
      alert('アイテムの追加に失敗しました。');
    }
  }
};

const handleDeleteItem = async (itemId) => {
  if (!state.userId || !state.activeListId) return;
  try {
    await deleteDbItem(itemId, state.activeListId);

  } catch (error) {
    console.error("アイテムの削除に失敗しました:", error);
    alert("エラーが発生してアイテムを削除できませんでした。");
  }
  
  
};

const handleToggleItem = async (itemId) => {
  if (!state.userId || !state.activeListId) return;
  const itemToUpdate = state.items.find(item => item.id === itemId);
  if (!itemToUpdate) return;

  try {
    await updateItemStatus(itemId, itemToUpdate.completed, state.activeListId);

  } catch (error) {
    console.error("アイテムの完了操作に失敗しました:", error);
    alert("エラーが発生して完了済みにできませんでした。");
  }
  
  
  
};

const handleClearCompleted = () => {
  if (!state.userId || !state.activeListId) return;
  clearCompletedDbItems(state.activeListId);
};

const handleUpdateItemText = async (itemId, newText) => {
  if (!state.userId || !state.activeListId) return;
  try {
    await updateDbItemText(itemId, newText, state.activeListId);

  } catch (error) {
    console.error("アイテムの更新に失敗しました:", error);
    alert("エラーが発生して更新できませんでした。");
  }
  
}

// --- UIの初期化 ---
initUI({
  listElement: listElement,
  state: state,
  onDelete: handleDeleteItem, 
  onToggle: handleToggleItem,
  onUpdate: handleUpdateItemText,
  editModeButtonElement: editModeButton
});

// --- イベントリスナーの設定 ---
addButton.addEventListener('click', handleAddItem);
inputElement.addEventListener('keydown', enterKeyPress);

function enterKeyPress(event) {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    handleAddItem();
  }
}

clearCompletedButton.addEventListener('click', handleClearCompleted);

createInviteButton?.addEventListener('click', handleCreateInviteLink);
copyInviteLinkButton?.addEventListener('click', handleCopyInviteLink);
generateAlexaCodeButton?.addEventListener('click', handleGenerateAlexaLinkCode);
copyAlexaLinkCodeButton?.addEventListener('click', handleCopyAlexaLinkCode);

editModeButton.addEventListener('click', () => {
  toggleEditMode();
  handleStateUpdate();
})

signOutButton?.addEventListener('click', async () => {
  const confirmed = window.confirm('現在のリストと端末に保存された利用者IDをリセットします。よろしいですか？');
  if (!confirmed) {
    return;
  }
  try {
    await signOutUser();
  } catch (error) {
    console.error('ログアウトに失敗しました:', error);
    alert('ログアウトに失敗しました。時間をおいて再度お試しください。');
  }
});

observeAuthState(async (user) => {
  if (user) {
    await handleSignedIn(user);
  } else {
    handleSignedOut();
  }
});
