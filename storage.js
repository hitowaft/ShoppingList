export function saveTasks(state) {
  localStorage.setItem('todoList', JSON.stringify(state.todos));
}

export function loadTasks() {
  const savedTasksJSON = localStorage.getItem('todoList');
  if (savedTasksJSON === null) {
    return [];
  }
  return JSON.parse(savedTasksJSON);
}