export const state = {
  items: [],
  isEditing: false,
  user: null,
  userId: null,
  activeListId: null,
  activeListName: ''
};

export function additem (itemText, id) {
  if (!itemText) return;
  state.items.push({ id: id, text: itemText, completed: false });
}

export function deleteitem (itemId) {
  state.items = state.items.filter(item => item.id !== itemId);
}

export function toggleitem (itemId) {
  const targetItem = state.items.find(item => item.id === itemId);
  if (targetItem) {
    targetItem.completed = !targetItem.completed;
  }
}

export function clearCompleteditems() {
  state.items = state.items.filter(item => item.completed === false);  
}

export function toggleEditMode() {
    state.isEditing = !state.isEditing;
}

/**
 * 指定されたIDの買い物アイテムのテキストを更新する
 * @param {number} id 更新するアイテムのID
 * @param {string} newText 新しいアイテム名
 */
export function updateitemText(id, newText) {
  const itemToUpdate = state.items.find(item => item.id === id);

  if (itemToUpdate) {
    itemToUpdate.text = newText;
  }
}
