export const state = {
  todos: [],
  searchKeyword: '',
  isEditing: false
};

export function addTodo (taskText) {
  if (!taskText) return;
  state.todos.push({id: Date.now(), text: taskText, completed: false});
}

export function deleteTodo (taskId) {
  state.todos = state.todos.filter(todo => todo.id !== taskId);
}

export function toggleTodo (taskId) {
  const targetTodo = state.todos.find(todo => todo.id === taskId);
  if (targetTodo) {
    targetTodo.completed = !targetTodo.completed;
  }
}

export function clearCompletedTodos() {
  state.todos = state.todos.filter(todo => todo.completed === false);  
}

export function setSearchKeyword(keyword) {
  state.searchKeyword = keyword;
}

export function toggleEditMode() {
    state.isEditing = !state.isEditing;
}