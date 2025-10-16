import { db, collection, addDoc, onSnapshot, query, orderBy, where, getDocs, serverTimestamp, doc, setDoc, Timestamp, getDoc, functions, httpsCallable } from "./firebase.js";
import { state, toggleEditMode } from './state.js';
import { updateItemStatus, deleteDbItem, clearCompletedDbItems, updateDbItemText } from "./storage.js";
import { initUI, render } from "./ui.js";
import { signOutUser, observeAuthState, ensureAuthUser } from "./auth.js";
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
const showRecoveryKeyButton = document.getElementById('showRecoveryKeyButton');
const deviceRecoveryContainer = document.getElementById('deviceRecoveryContainer');
const deviceRecoveryStatusLabel = document.getElementById('deviceRecoveryStatus');
const deviceRecoveryField = document.getElementById('deviceRecoveryField');
const copyDeviceRecoveryButton = document.getElementById('copyDeviceRecovery');
const deviceRecoveryApplyContainer = document.getElementById('deviceRecoveryApplyContainer');
const deviceRecoveryApplyStatusLabel = document.getElementById('deviceRecoveryApplyStatus');
const deviceRecoveryInput = document.getElementById('deviceRecoveryInput');
const applyDeviceRecoveryButton = document.getElementById('applyDeviceRecovery');
const deviceManagementSection = document.getElementById('deviceManagementSection');
const deviceManagementListElement = document.getElementById('deviceManagementList');
const deviceManagementStatusLabel = document.getElementById('deviceManagementStatus');
const deviceManagementSelectAllButton = document.getElementById('deviceManagementSelectAll');
const deviceManagementDeselectAllButton = document.getElementById('deviceManagementDeselectAll');
const applyDeviceCleanupButton = document.getElementById('applyDeviceCleanup');

const urlParams = new URLSearchParams(window.location.search);
let pendingInviteCode = (urlParams.get('invite') ?? '').trim();
const selectedDeviceIds = new Set();

const formatDeviceId = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return '未登録';
  }
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
};

const getDeviceDisplayName = (memberId) => {
  const profileMap = state.activeListMemberProfiles || {};
  const rawName = typeof profileMap[memberId] === 'string' ? profileMap[memberId].trim() : '';
  if (rawName) {
    return rawName;
  }
  if (memberId === state.userId) {
    return 'この端末';
  }
  return formatDeviceId(memberId);
};

function syncDeviceSelectionWithMembers(members) {
  const memberSet = new Set(Array.isArray(members) ? members : []);
  let changed = false;
  for (const id of Array.from(selectedDeviceIds)) {
    if (!memberSet.has(id)) {
      selectedDeviceIds.delete(id);
      changed = true;
    }
  }
  memberSet.forEach((id) => {
    if (!selectedDeviceIds.has(id)) {
      selectedDeviceIds.add(id);
      changed = true;
    }
  });
  if (state.userId && memberSet.has(state.userId) && !selectedDeviceIds.has(state.userId)) {
    selectedDeviceIds.add(state.userId);
    changed = true;
  }
  return changed;
}

let deviceManagementStatusResetTimer = null;

const setDeviceManagementStatusMessage = (message, {autoReset = false} = {}) => {
  if (!deviceManagementStatusLabel) {
    return;
  }
  deviceManagementStatusLabel.textContent = message;
  if (autoReset) {
    if (deviceManagementStatusResetTimer) {
      clearTimeout(deviceManagementStatusResetTimer);
    }
    deviceManagementStatusResetTimer = window.setTimeout(() => {
      updateDeviceManagementStatus();
      deviceManagementStatusResetTimer = null;
    }, 3000);
  }
};

const updateDeviceManagementStatus = () => {
  if (!deviceManagementStatusLabel) {
    return;
  }
  const total = Array.isArray(state.activeListMembers) ? state.activeListMembers.length : 0;
  const memberSet = new Set(Array.isArray(state.activeListMembers) ? state.activeListMembers : []);
  let selected = 0;
  selectedDeviceIds.forEach((memberId) => {
    if (memberSet.has(memberId)) {
      selected += 1;
    }
  });
  const totalText = `${total}台`;
  const selectedText = `${selected}台`;
  setDeviceManagementStatusMessage(`共有中: ${totalText} / 残す予定: ${selectedText}`);
};

function renderDeviceManagementList() {
  if (!deviceManagementListElement) {
    return;
  }
  deviceManagementListElement.innerHTML = '';
  const members = Array.isArray(state.activeListMembers) ? state.activeListMembers : [];
  if (members.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.textContent = '共有中の端末がありません。';
    deviceManagementListElement.appendChild(emptyItem);
    updateDeviceManagementStatus();
    return;
  }

  members.forEach((memberId) => {
    const li = document.createElement('li');
    li.className = 'device-management-item';

    const infoWrapper = document.createElement('div');
    infoWrapper.className = 'device-management-info';

    const label = document.createElement('label');
    label.className = 'device-selection';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = memberId;
    checkbox.checked = selectedDeviceIds.has(memberId);
    checkbox.addEventListener('change', () => {
      if (!checkbox.checked) {
        if (memberId === state.userId) {
          checkbox.checked = true;
          setDeviceManagementStatusMessage('この端末は解除できません。', {autoReset: true});
          return;
        }
        selectedDeviceIds.delete(memberId);
      } else {
        selectedDeviceIds.add(memberId);
      }
      updateDeviceManagementStatus();
    });

    const primaryLabel = document.createElement('span');
    primaryLabel.className = 'device-name';
    primaryLabel.textContent = getDeviceDisplayName(memberId);

    const idLabel = document.createElement('span');
    idLabel.className = 'device-id-label';
    idLabel.textContent = formatDeviceId(memberId);

    label.appendChild(checkbox);
    label.appendChild(primaryLabel);
    infoWrapper.appendChild(label);
    infoWrapper.appendChild(idLabel);

    if (memberId === state.userId) {
      const badge = document.createElement('span');
      badge.className = 'device-badge';
      badge.textContent = 'この端末';
      infoWrapper.appendChild(badge);
    }

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'device-row-actions';

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'secondary device-rename-button';
    renameButton.textContent = '名前を変更';
    renameButton.addEventListener('click', () => {
      handleRenameDevice(memberId);
    });

    actionsWrapper.appendChild(renameButton);

    li.appendChild(infoWrapper);
    li.appendChild(actionsWrapper);
    deviceManagementListElement.appendChild(li);
  });

  updateDeviceManagementStatus();
}

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
  const rawProfiles = listData?.memberProfiles;
  const normalizedProfiles = {};
  if (rawProfiles && typeof rawProfiles === 'object') {
    Object.entries(rawProfiles).forEach(([memberId, profile]) => {
      if (typeof memberId !== 'string') {
        return;
      }
      const displayName = typeof profile?.displayName === 'string' ? profile.displayName.trim() : '';
      if (displayName) {
        normalizedProfiles[memberId] = displayName;
      }
    });
  }
  state.activeListMemberProfiles = normalizedProfiles;
  state.activeListMembers = uniqueMembers;
  syncDeviceSelectionWithMembers(uniqueMembers);
  renderDeviceManagementList();
  const memberCount = Math.max(uniqueMembers.length, 1);
  const sharingDescription = memberCount <= 1 ? '1つのデバイスで利用中' : `${memberCount}つのデバイスで共有中`;
  setUserStatusMessage(sharingDescription);
  updateDeviceManagementStatus();
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

const defaultDeviceRecoveryStatusMessage = '復元コードはここに表示されます。';
const defaultDeviceRecoveryApplyMessage = '復元コードを入力すると以前のリストを復元できます。';
let deviceRecoveryStatusResetTimer = null;
let deviceRecoveryApplyStatusResetTimer = null;

const setAlexaLinkStatusMessage = (message) => {
  if (alexaLinkStatusLabel) {
    alexaLinkStatusLabel.textContent = message;
  }
};

const setDeviceRecoveryStatusMessage = (message) => {
  if (deviceRecoveryStatusLabel) {
    deviceRecoveryStatusLabel.textContent = message;
  }
};

const setDeviceRecoveryApplyStatusMessage = (message) => {
  if (deviceRecoveryApplyStatusLabel) {
    deviceRecoveryApplyStatusLabel.textContent = message;
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

const scheduleDeviceRecoveryStatusReset = (message = defaultDeviceRecoveryStatusMessage) => {
  if (deviceRecoveryStatusResetTimer) {
    clearTimeout(deviceRecoveryStatusResetTimer);
  }
  deviceRecoveryStatusResetTimer = window.setTimeout(() => {
    setDeviceRecoveryStatusMessage(message);
    deviceRecoveryStatusResetTimer = null;
  }, 3000);
};

const scheduleDeviceRecoveryApplyStatusReset = (message = defaultDeviceRecoveryApplyMessage) => {
  if (deviceRecoveryApplyStatusResetTimer) {
    clearTimeout(deviceRecoveryApplyStatusResetTimer);
  }
  deviceRecoveryApplyStatusResetTimer = window.setTimeout(() => {
    setDeviceRecoveryApplyStatusMessage(message);
    deviceRecoveryApplyStatusResetTimer = null;
  }, 3000);
};

const resetDeviceRecoveryUI = () => {
  if (showRecoveryKeyButton) {
    showRecoveryKeyButton.disabled = false;
  }
  if (deviceRecoveryContainer) {
    deviceRecoveryContainer.classList.add('is-hidden');
  }
  if (deviceRecoveryField) {
    deviceRecoveryField.value = '';
  }
  if (deviceRecoveryStatusResetTimer) {
    clearTimeout(deviceRecoveryStatusResetTimer);
    deviceRecoveryStatusResetTimer = null;
  }
  if (deviceRecoveryApplyStatusResetTimer) {
    clearTimeout(deviceRecoveryApplyStatusResetTimer);
    deviceRecoveryApplyStatusResetTimer = null;
  }
  setDeviceRecoveryStatusMessage(defaultDeviceRecoveryStatusMessage);
  setDeviceRecoveryApplyStatusMessage(defaultDeviceRecoveryApplyMessage);
  if (deviceRecoveryInput) {
    deviceRecoveryInput.value = '';
  }
  if (applyDeviceRecoveryButton) {
    applyDeviceRecoveryButton.disabled = false;
  }
};

resetDeviceRecoveryUI();

renderDeviceManagementList();
updateDeviceManagementStatus();

const createAlexaLinkCodeCallable = httpsCallable(functions, 'createAlexaLinkCode');
const registerDeviceRecoveryCallable = httpsCallable(functions, 'registerDeviceRecovery');
const claimDeviceRecoveryCallable = httpsCallable(functions, 'claimDeviceRecovery');
const trimListMembersCallable = httpsCallable(functions, 'trimListMembers');
const updateDeviceProfileCallable = httpsCallable(functions, 'updateDeviceProfile');

const INVITE_VALID_DAYS = 7;
const DEVICE_RECOVERY_STORAGE_KEY = 'shopping-list.deviceRecovery';
const DEVICE_RECOVERY_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEVICE_NAME_MAX_LENGTH = 32;

const loadDeviceRecovery = () => {
  try {
    const rawValue = localStorage.getItem(DEVICE_RECOVERY_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const listId = typeof parsed.listId === 'string' ? parsed.listId : null;
    const recoveryKey = typeof parsed.recoveryKey === 'string' ? parsed.recoveryKey : null;
    const lastRegisteredAt = typeof parsed.lastRegisteredAt === 'number' ? parsed.lastRegisteredAt : null;
    if (!listId || !recoveryKey) {
      return null;
    }
    return { listId, recoveryKey, lastRegisteredAt };
  } catch (error) {
    console.warn('復元情報の読み込みに失敗しました:', error);
    return null;
  }
};

const saveDeviceRecovery = (value) => {
  try {
    if (!value || typeof value !== 'object') {
      return;
    }
    const payload = {
      listId: typeof value.listId === 'string' ? value.listId : null,
      recoveryKey: typeof value.recoveryKey === 'string' ? value.recoveryKey : null,
      lastRegisteredAt: typeof value.lastRegisteredAt === 'number' ? value.lastRegisteredAt : null
    };
    if (!payload.listId || !payload.recoveryKey) {
      return;
    }
    if (payload.lastRegisteredAt === null) {
      const existing = loadDeviceRecovery();
      if (existing && existing.listId === payload.listId && typeof existing.lastRegisteredAt === 'number') {
        payload.lastRegisteredAt = existing.lastRegisteredAt;
      } else {
        payload.lastRegisteredAt = Date.now();
      }
    }
    localStorage.setItem(DEVICE_RECOVERY_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('復元情報の保存に失敗しました:', error);
  }
};

const clearDeviceRecovery = () => {
  try {
    localStorage.removeItem(DEVICE_RECOVERY_STORAGE_KEY);
  } catch (error) {
    console.warn('復元情報の削除に失敗しました:', error);
  }
};

const requestDeviceRecoveryKey = async (listId, userUid, {reuseStored = true} = {}) => {
  if (!listId || !userUid) {
    return null;
  }
  const storedRecovery = reuseStored ? loadDeviceRecovery() : null;
  const now = Date.now();
  if (storedRecovery && storedRecovery.listId === listId && storedRecovery.recoveryKey) {
    const lastRegisteredAt = typeof storedRecovery.lastRegisteredAt === 'number' ? storedRecovery.lastRegisteredAt : null;
    if (lastRegisteredAt && (now - lastRegisteredAt) < DEVICE_RECOVERY_REFRESH_INTERVAL_MS) {
      return storedRecovery.recoveryKey;
    }
  }
  const requestPayload = {
    listId,
    userId: userUid,
  };
  if (storedRecovery && storedRecovery.listId === listId) {
    requestPayload.recoveryKey = storedRecovery.recoveryKey;
  }
  const { data } = await registerDeviceRecoveryCallable(requestPayload);
  const receivedKey = typeof data?.recoveryKey === 'string' ? data.recoveryKey : null;
  const keyToPersist = receivedKey ?? (storedRecovery && storedRecovery.listId === listId ? storedRecovery.recoveryKey : null);
  if (keyToPersist) {
    saveDeviceRecovery({ listId, recoveryKey: keyToPersist, lastRegisteredAt: now });
  }
  return keyToPersist;
};

const ensureDeviceRecovery = async (listId, userUid) => {
  if (!listId) {
    return;
  }
  const uid = userUid ?? state.userId;
  if (!uid) {
    return;
  }
  try {
    await requestDeviceRecoveryKey(listId, uid, { reuseStored: true });
  } catch (error) {
    console.error('復元コードの登録に失敗しました:', error);
  }
};

const attemptRestoreFromRecovery = async (userUid) => {
  const storedRecovery = loadDeviceRecovery();
  if (!storedRecovery || !storedRecovery.recoveryKey) {
    return null;
  }
  try {
    const { data } = await claimDeviceRecoveryCallable({
      recoveryKey: storedRecovery.recoveryKey,
      userId: userUid
    });
    const recoveredListId = typeof data?.listId === 'string' ? data.listId : null;
    if (!recoveredListId) {
      return null;
    }
    const recoveredName = typeof data?.listName === 'string' && data.listName.length > 0
      ? data.listName
      : '共有買い物リスト';
    state.activeListId = recoveredListId;
    state.activeListName = recoveredName;
    sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, recoveredListId);
    saveDeviceRecovery({
      listId: recoveredListId,
      recoveryKey: storedRecovery.recoveryKey,
      lastRegisteredAt: typeof storedRecovery.lastRegisteredAt === 'number' ? storedRecovery.lastRegisteredAt : Date.now()
    });
    return { listId: recoveredListId, listData: null };
  } catch (error) {
    console.error('復元コードの適用に失敗しました:', error);
    const shouldClear =
      error?.code === 'not-found' ||
      error?.code === 'failed-precondition' ||
      error?.code === 'permission-denied';
    if (shouldClear) {
      clearDeviceRecovery();
    }
    return null;
  }
};

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

const handleShowRecoveryKey = async () => {
  if (!state.userId || !state.activeListId) {
    alert('復元コードを取得するにはリストが読み込まれている必要があります。');
    return;
  }
  if (showRecoveryKeyButton) {
    showRecoveryKeyButton.disabled = true;
  }
  setDeviceRecoveryStatusMessage('復元コードを取得しています…');
  try {
    const recoveryKey = await requestDeviceRecoveryKey(state.activeListId, state.userId, { reuseStored: true });
    if (!recoveryKey) {
      throw new Error('復元コードが取得できませんでした。');
    }
    if (deviceRecoveryField) {
      deviceRecoveryField.value = recoveryKey;
      deviceRecoveryField.focus();
      deviceRecoveryField.select?.();
    }
    if (deviceRecoveryContainer) {
      deviceRecoveryContainer.classList.remove('is-hidden');
    }
    setDeviceRecoveryStatusMessage('復元コードを安全な場所に保管してください。');
  } catch (error) {
    console.error('復元コードの取得に失敗しました:', error);
    alert('復元コードを取得できませんでした。時間をおいて再度お試しください。');
    if (deviceRecoveryContainer) {
      deviceRecoveryContainer.classList.add('is-hidden');
    }
    setDeviceRecoveryStatusMessage('復元コードを表示できませんでした。');
    scheduleDeviceRecoveryStatusReset();
  } finally {
    if (showRecoveryKeyButton) {
      showRecoveryKeyButton.disabled = false;
    }
  }
};

const handleCopyDeviceRecovery = async () => {
  const recoveryKey = deviceRecoveryField?.value?.trim();
  if (!recoveryKey) {
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(recoveryKey);
    } else {
      deviceRecoveryField?.select();
      document.execCommand('copy');
    }
    setDeviceRecoveryStatusMessage('復元コードをコピーしました！');
    scheduleDeviceRecoveryStatusReset();
  } catch (error) {
    console.error('復元コードのコピーに失敗しました:', error);
    alert('復元コードのコピーに失敗しました。表示されているコードを手動で控えてください。');
  }
};

const handleApplyDeviceRecovery = async () => {
  const recoveryKey = deviceRecoveryInput?.value?.trim();
  if (!recoveryKey) {
    alert('復元コードを入力してください。');
    return;
  }
  if (applyDeviceRecoveryButton) {
    applyDeviceRecoveryButton.disabled = true;
  }
  setDeviceRecoveryApplyStatusMessage('復元コードを確認しています…');
  try {
    const authUser = state.user ?? await ensureAuthUser();
    const userId = authUser?.uid;
    if (!userId) {
      throw new Error('ユーザー情報を取得できませんでした。');
    }
    const { data } = await claimDeviceRecoveryCallable({
      recoveryKey,
      userId,
    });
    if (!state.user || state.user?.uid !== userId) {
      state.user = { uid: userId };
      state.userId = userId;
    }
    const targetListId = typeof data?.listId === 'string' ? data.listId : null;
    if (!targetListId) {
      throw new Error('復元先のリストが見つかりませんでした。');
    }
    state.activeListId = targetListId;
    state.activeListName = typeof data?.listName === 'string' && data.listName.length > 0
      ? data.listName
      : '共有買い物リスト';
    sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, targetListId);
    saveDeviceRecovery({ listId: targetListId, recoveryKey, lastRegisteredAt: Date.now() });
    stopItemsSubscription();
    state.items = [];
    handleStateUpdate();
    startItemsSubscription(targetListId);
    await refreshListStatus(targetListId);
    await ensureDeviceRecovery(targetListId, userId);
    if (deviceRecoveryContainer) {
      deviceRecoveryContainer.classList.remove('is-hidden');
    }
    if (deviceRecoveryField) {
      deviceRecoveryField.value = recoveryKey;
    }
    setDeviceRecoveryStatusMessage('復元コードを安全な場所に保管してください。');
    setDeviceRecoveryApplyStatusMessage('復元が完了しました。');
    scheduleDeviceRecoveryApplyStatusReset();
    if (createInviteButton) {
      createInviteButton.disabled = false;
    }
    setInviteStatusMessage('共有リンクを発行して、家族と共有しましょう。');
    setAlexaLinkStatusMessage(defaultAlexaStatusMessage);
  } catch (error) {
    console.error('復元コードの適用に失敗しました:', error);
    let message = '復元に失敗しました。時間をおいて再試しください。';
    if (error?.code === 'permission-denied') {
      message = 'この復元コードは利用できません。';
    } else if (error?.code === 'not-found') {
      message = '復元コードが見つかりませんでした。入力内容を確認してください。';
    } else if (error?.message) {
      message = error.message;
    }
    setDeviceRecoveryApplyStatusMessage(message);
    scheduleDeviceRecoveryApplyStatusReset();
  } finally {
    if (applyDeviceRecoveryButton) {
      applyDeviceRecoveryButton.disabled = false;
    }
  }
};

const handleSelectAllDevices = () => {
  if (!Array.isArray(state.activeListMembers) || state.activeListMembers.length === 0) {
    return;
  }
  state.activeListMembers.forEach((memberId) => {
    selectedDeviceIds.add(memberId);
  });
  renderDeviceManagementList();
  setDeviceManagementStatusMessage('すべての端末を選択しました。', {autoReset: true});
};

const handleDeselectAllDevices = () => {
  selectedDeviceIds.clear();
  if (state.userId && Array.isArray(state.activeListMembers) && state.activeListMembers.includes(state.userId)) {
    selectedDeviceIds.add(state.userId);
  }
  renderDeviceManagementList();
  setDeviceManagementStatusMessage('現在の端末は常に共有に残ります。', {autoReset: true});
};

const handleRenameDevice = async (memberId) => {
  if (!state.userId || !state.activeListId) {
    alert('共有リストが読み込まれていません。ページを再読み込みしてください。');
    return;
  }
  if (!memberId || typeof memberId !== 'string') {
    return;
  }
  const currentName = typeof state.activeListMemberProfiles?.[memberId] === 'string'
    ? state.activeListMemberProfiles[memberId]
    : '';
  const currentNormalizedName = currentName.trim();
  const promptMessage = memberId === state.userId
    ? 'この端末の表示名を入力してください（空欄で既定の表示に戻ります）。'
    : '端末の表示名を入力してください（空欄で既定の表示に戻ります）。';
  const nextName = window.prompt(promptMessage, currentName);
  if (nextName === null) {
    return;
  }
  const trimmedName = nextName.trim();
  if (trimmedName.length > DEVICE_NAME_MAX_LENGTH) {
    alert(`表示名は${DEVICE_NAME_MAX_LENGTH}文字以内で入力してください。`);
    return;
  }
  if (currentNormalizedName === trimmedName) {
    return;
  }

  try {
    const { data } = await updateDeviceProfileCallable({
      listId: state.activeListId,
      userId: state.userId,
      memberId,
      displayName: trimmedName,
    });
    const updatedProfiles = (data && typeof data.memberProfiles === 'object' && data.memberProfiles !== null)
      ? data.memberProfiles
      : {};
    state.activeListMemberProfiles = updatedProfiles;
    renderDeviceManagementList();
    const message = trimmedName ? '端末名を更新しました。' : '端末名を既定に戻しました。';
    setDeviceManagementStatusMessage(message, {autoReset: true});
  } catch (error) {
    console.error('端末名の更新に失敗しました:', error);
    alert('端末名を更新できませんでした。時間をおいて再試しください。');
  }
};

const handleApplyDeviceCleanup = async () => {
  if (!state.userId || !state.activeListId) {
    alert('共有リストが読み込まれていません。ページを再読み込みしてください。');
    return;
  }
  const keepMembers = Array.from(new Set([
    ...selectedDeviceIds,
    state.userId,
  ]));
  if (keepMembers.length === 0) {
    setDeviceManagementStatusMessage('少なくとも1台は残す必要があります。', {autoReset: true});
    return;
  }
  const currentMembers = Array.isArray(state.activeListMembers) ? state.activeListMembers : [];
  const pendingRemovalCount = currentMembers.length - keepMembers.length;
  if (pendingRemovalCount <= 0) {
    setDeviceManagementStatusMessage('整理する端末が選択されていません。', {autoReset: true});
    return;
  }
  const confirmed = window.confirm(`${pendingRemovalCount}件の端末を共有リストから外します。よろしいですか？`);
  if (!confirmed) {
    return;
  }

  if (applyDeviceCleanupButton) {
    applyDeviceCleanupButton.disabled = true;
  }
  if (deviceManagementSelectAllButton) {
    deviceManagementSelectAllButton.disabled = true;
  }
  if (deviceManagementDeselectAllButton) {
    deviceManagementDeselectAllButton.disabled = true;
  }

  setDeviceManagementStatusMessage('共有端末を整理しています…');

  try {
    const { data } = await trimListMembersCallable({
      listId: state.activeListId,
      userId: state.userId,
      keepMembers,
    });
    const updatedMembers = Array.isArray(data?.members)
      ? data.members.filter((member) => typeof member === 'string' && member.length > 0)
      : keepMembers;
    const updatedProfiles = (data && typeof data.memberProfiles === 'object' && data.memberProfiles !== null)
      ? data.memberProfiles
      : state.activeListMemberProfiles;
    state.activeListMembers = updatedMembers;
    state.activeListMemberProfiles = updatedProfiles;
    selectedDeviceIds.clear();
    updatedMembers.forEach((memberId) => selectedDeviceIds.add(memberId));
    renderDeviceManagementList();
    await refreshListStatus(state.activeListId);
    setDeviceManagementStatusMessage('共有端末を整理しました。', {autoReset: true});
  } catch (error) {
    console.error('共有端末の整理に失敗しました:', error);
    setDeviceManagementStatusMessage('共有端末の整理に失敗しました。時間をおいて再試しください。', {autoReset: true});
  } finally {
    if (applyDeviceCleanupButton) {
      applyDeviceCleanupButton.disabled = false;
    }
    if (deviceManagementSelectAllButton) {
      deviceManagementSelectAllButton.disabled = false;
    }
    if (deviceManagementDeselectAllButton) {
      deviceManagementDeselectAllButton.disabled = false;
    }
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
  state.activeListMembers = [];
  selectedDeviceIds.clear();
  renderDeviceManagementList();
  updateDeviceManagementStatus();
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
        return { listId: storedListSnapshot.id, listData: storedListData };
      }
    } catch (error) {
      console.warn('保存済みリストの読み込みに失敗しました:', error);
    }

    sessionStorage.removeItem(ACTIVE_LIST_STORAGE_KEY);
  }

  const recoveredList = await attemptRestoreFromRecovery(userUid);
  if (recoveredList) {
    return recoveredList;
  }

  const existingListsSnapshot = await getDocs(query(listsCollection, where('members', 'array-contains', userUid)));

  if (!existingListsSnapshot.empty) {
    const firstList = existingListsSnapshot.docs[0];
    const firstListData = firstList.data();
    state.activeListId = firstList.id;
    state.activeListName = firstListData.name ?? '共有買い物リスト';
    sessionStorage.setItem(ACTIVE_LIST_STORAGE_KEY, firstList.id);
    return { listId: firstList.id, listData: firstListData };
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

  return {
    listId: newListRef.id,
    listData: {
      name: listName,
      ownerUid: userUid,
      members: [userUid],
      memberProfiles: {}
    }
  };
}

async function handleSignedIn(user) {
  state.user = { uid: user.uid };
  state.userId = user.uid;

  setUserStatusMessage('リストを読み込み中…');
  resetInviteUI();
  resetAlexaLinkUI();
  resetDeviceRecoveryUI();

  try {
    let resolvedList = null;

    if (pendingInviteCode) {
      try {
        setInviteStatusMessage('招待コードを確認しています…');
        const { listId: joinedListId } = await acceptInviteViaApi(pendingInviteCode, user.uid);
        if (joinedListId) {
          const joinedListSnapshot = await getDoc(doc(db, 'lists', joinedListId));
          resolvedList = {
            listId: joinedListId,
            listData: joinedListSnapshot.exists() ? joinedListSnapshot.data() : null,
          };
          state.activeListId = joinedListId;
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

    if (!resolvedList) {
      resolvedList = await ensureActiveList(user);
    }

    const resolvedListId = resolvedList?.listId;
    const resolvedListData = resolvedList?.listData ?? null;
    if (!resolvedListId) {
      throw new Error('共有リストを特定できませんでした。');
    }

    stopItemsSubscription();
    state.items = [];
    handleStateUpdate();
    startItemsSubscription(resolvedListId);

    if (resolvedListData) {
      applyListStatus(resolvedListId, resolvedListData);
    }

    const postLoadTasks = [];
    if (!resolvedListData) {
      postLoadTasks.push(refreshListStatus(resolvedListId));
    }
    postLoadTasks.push(ensureDeviceRecovery(resolvedListId, user.uid));
    await Promise.all(postLoadTasks);

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
  resetDeviceRecoveryUI();
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
showRecoveryKeyButton?.addEventListener('click', handleShowRecoveryKey);
copyDeviceRecoveryButton?.addEventListener('click', handleCopyDeviceRecovery);
applyDeviceRecoveryButton?.addEventListener('click', handleApplyDeviceRecovery);
deviceRecoveryInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    handleApplyDeviceRecovery();
  }
});
deviceManagementSelectAllButton?.addEventListener('click', handleSelectAllDevices);
deviceManagementDeselectAllButton?.addEventListener('click', handleDeselectAllDevices);
applyDeviceCleanupButton?.addEventListener('click', handleApplyDeviceCleanup);

editModeButton.addEventListener('click', () => {
  toggleEditMode();
  handleStateUpdate();
})

signOutButton?.addEventListener('click', async () => {
  const confirmed = window.confirm('現在のリストと端末に保存された利用者IDをリセットします。よろしいですか？');
  if (!confirmed) {
    return;
  }
  clearDeviceRecovery();
  resetDeviceRecoveryUI();
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
