export const state = {
  items: [],
  searchKeyword: '',
  isEditing: false
};

export function additem (taskText, id) {
  if (!taskText) return;
  state.items.push({id: id, text: taskText, completed: false});
}

export function deleteitem (taskId) {
  state.items = state.items.filter(item => item.id !== taskId);
}

export function toggleitem (taskId) {
  const targetitem = state.items.find(item => item.id === taskId);
  if (targetitem) {
    targetitem.completed = !targetitem.completed;
  }
}

export function clearCompleteditems() {
  state.items = state.items.filter(item => item.completed === false);  
}

export function setSearchKeyword(keyword) {
  state.searchKeyword = keyword;
}

export function toggleEditMode() {
    state.isEditing = !state.isEditing;
}

/**
 * 指定されたIDのitemタスクのテキストを更新する
 * @param {number} id 更新するタスクのID
 * @param {string} newText 新しいタスクのテキスト
 */
export function updateitemText(id, newText) {
  const itemToUpdate = state.items.find(item => item.id === id);

  if (itemToUpdate) {
    itemToUpdate.text = newText;
  }
}