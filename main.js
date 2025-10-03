import { db, collection, addDoc, getDocs } from "./firebase.js";
import { state, additem, deleteitem, toggleitem, clearCompleteditems, setSearchKeyword, toggleEditMode, updateitemText } from './state.js';
import { updateItemStatus, deleteDbItem, clearCompletedDbItems, updateDbItemText } from "./storage.js";
import { initUI, render } from "./ui.js";

// --- DOM要素の取得 ---
const inputElement = document.getElementById('itemInput');
const addButton = document.getElementById('addButton');
const listElement = document.getElementById('itemList');
const searchInput = document.getElementById('searchInput');
const clearButton = document.getElementById('clearButton');
const clearCompletedButton = document.getElementById('clearCompletedButton');
const editModeButton = document.getElementById('editModeButton');
const toggleSearchButton = document.getElementById('toggleSearchButton');
const searchOptionsSection = document.getElementById('searchOptions');

let isSearchVisible = false;

function updateSearchVisibility(visible, { focus = false } = {}) {
  if (!toggleSearchButton || !searchOptionsSection) return;

  isSearchVisible = visible;
  toggleSearchButton.setAttribute('aria-expanded', String(visible));
  searchOptionsSection.setAttribute('aria-hidden', String(!visible));
  toggleSearchButton.textContent = visible ? '検索を閉じる' : '検索オプション';
  searchOptionsSection.classList.toggle('is-hidden', !visible);

  if (visible && focus) {
    searchInput?.focus();
  }
}

// --- 状態が更新された後のお決まり処理をまとめた関数 ---
const handleStateUpdate = () => {
  render(state);

  if (state.searchKeyword && !isSearchVisible) {
    updateSearchVisibility(true);
  }
};

// --- イベントハンドラ関数 ---

const handleAddItem = async () => {
  const itemName = inputElement.value.trim();
  if (itemName) {
    try {
      const docRef = await addDoc(collection(db, "shopping-list"), {
        name: itemName,
        completed: false, // 未完了の状態
        createdAt: new Date(), // 作成日時
      });
      console.log("Firestoreに保存成功！ ID: ", docRef.id);

      additem(itemName, docRef.id);
      handleStateUpdate(); 
      inputElement.value = '';

    } catch (error) {
      console.error("保存中にエラーが発生しました: ", error);
      alert('アイテムの追加に失敗しました。');
    }
  }
};

const handleDeleteItem = async (itemId) => {
  try {
    await deleteDbItem(itemId);

    deleteitem(itemId);
    handleStateUpdate();
  } catch (error) {
    console.error("アイテムの削除に失敗しました:", error);
    alert("エラーが発生してアイテムを削除できませんでした。");
  }
  
  
};

const handleToggleItem = async (itemId) => {
  const itemToUpdate = state.items.find(item => item.id === itemId);
  if (!itemToUpdate) return;

  try {
    await updateItemStatus(itemId, itemToUpdate.completed);

    toggleitem(itemId);
    handleStateUpdate();
  } catch (error) {
    console.error("アイテムの完了操作に失敗しました:", error);
    alert("エラーが発生して完了済みにできませんでした。");
  }
  
  
  
};

const handleClearCompleted = () => {
  clearCompletedDbItems();

  clearCompleteditems();
  handleStateUpdate();
};

const handleUpdateItemText = async (itemId, newText) => {
  try {
    await updateDbItemText(itemId, newText);

    updateitemText(itemId, newText);
    handleStateUpdate();
  } catch (error) {
    console.error("アイテムの更新に失敗しました:", error);
    alert("エラーが発生して更新できませんでした。");
  }
  
}

const fetchAndRenderItems = async () => {
  try {
    const querySnapshot = await getDocs(collection(db, "shopping-list"));

    const fetchedItems = [];
    querySnapshot.forEach((doc) => {
      const itemData = doc.data();

      fetchedItems.push({
        id: doc.id,
        text: itemData.name,
        completed: itemData.completed
      });
    });

    state.items = fetchedItems;
    render(state);

    console.log('Firestoreからデータを正常に読み込みました！', fetchedItems);

  } catch (error) {
    console.error("データの読み込み中にエラーが発生しました:", error);
    alert('データの読み込みに失敗しました。');
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

searchInput.addEventListener('input', (event) => {
  setSearchKeyword(event.target.value);
  handleStateUpdate();
});

clearButton.addEventListener('click', () => {
  searchInput.value = '';
  setSearchKeyword('');
  handleStateUpdate();
});

toggleSearchButton?.addEventListener('click', () => {
  updateSearchVisibility(!isSearchVisible, { focus: !isSearchVisible });
});

clearCompletedButton.addEventListener('click', handleClearCompleted);

editModeButton.addEventListener('click', () => {
  toggleEditMode();
  handleStateUpdate();
})

// --- アプリケーションの開始 ---
// const initialItems = loadItems();
// if (initialItems.length > 0) {
//     state.items = initialItems;
// }
// render(state);; // 初回描画
fetchAndRenderItems();
