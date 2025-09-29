import { state, addTodo, deleteTodo, toggleTodo, clearCompletedTodos, setSearchKeyword, toggleEditMode, updateTodoText } from './state.js';
import { saveTasks, loadTasks } from "./storage.js";
import { initUI, render } from "./ui.js";

// --- DOM要素の取得 ---
const inputElement = document.getElementById('todoInput');
const addButton = document.getElementById('addButton');
const listElement = document.getElementById('todoList');
const searchInput = document.getElementById('searchInput');
const clearButton = document.getElementById('clearButton');
const clearCompletedButton = document.getElementById('clearCompletedButton');
const editModeButton = document.getElementById('editModeButton');

// --- 状態が更新された後のお決まり処理をまとめた関数 ---
const handleStateUpdate = () => {
  render(state);
  saveTasks(state);
};

// --- イベントハンドラ関数 ---

const handleAddTask = () => {
  const text = inputElement.value.trim();
  if (!text) return;

  addTodo(text);
  handleStateUpdate(); 
  inputElement.value = '';
};

const handleDeleteTask = (taskId) => {
  deleteTodo(taskId);
  handleStateUpdate();
};

const handleToggleTask = (taskId) => {
  toggleTodo(taskId);
  handleStateUpdate();
};

const handleClearCompleted = () => {
  clearCompletedTodos();
  handleStateUpdate();
};

const handleUpdateTaskText = (taskId, newText) => {
  updateTodoText(taskId, newText);
  handleStateUpdate();
}

// --- UIの初期化 ---
initUI({
  listElement: listElement,
  state: state,
  onDelete: handleDeleteTask, 
  onToggle: handleToggleTask,
  onUpdate: handleUpdateTaskText,
  editModeButtonElement: editModeButton
});

// --- イベントリスナーの設定 ---
addButton.addEventListener('click', handleAddTask);
inputElement.addEventListener('keydown', enterKeyPress);

function enterKeyPress(event) {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    handleAddTask();
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

clearCompletedButton.addEventListener('click', handleClearCompleted);

editModeButton.addEventListener('click', () => {
  toggleEditMode();
  handleStateUpdate();
})

// --- アプリケーションの開始 ---
const initialTasks = loadTasks();
if (initialTasks.length > 0) {
    state.todos = initialTasks;
}
render(state);; // 初回描画
