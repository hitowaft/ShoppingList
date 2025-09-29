import { state } from './state.js';
let listElement;
let onDeleteCallback;
let onToggleCallback;
let onUpdateCallback;
let editModeButtonElement;

export function initUI(config) {
  listElement = config.listElement;
  onDeleteCallback = config.onDelete;
  onToggleCallback = config.onToggle;
  onUpdateCallback = config.onUpdate;
  editModeButtonElement = config.editModeButtonElement;
}

function createTaskElement(task, onDelete, onToggle, onUpdate) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  const delButton = document.createElement('button');
  const checkbox = document.createElement('input');

  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  if (task.completed) {
    span.classList.add('completed');
  }

  span.textContent = task.text;

  checkbox.addEventListener('change', () => {
    onToggle(task.id);
  });

  span.addEventListener('click', () => {
    if (state.isEditing) return;

    onToggle(task.id);
  })

  span.addEventListener('click', () => {
    if (!state.isEditing) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = task.text;

    const finishEditing = () => {
      const newText = input.value.trim();

      if (newText && newText !== task.text) {
        onUpdate(task.id, newText);
      } else {
        render(state);
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finishEditing();
      if (e.key === 'Escape') render(state);
    });

    input.addEventListener('blur', finishEditing);

    li.replaceChild(input, span);
    input.focus();
  })

  li.appendChild(checkbox);
  li.appendChild(span);

  if (state.isEditing) {
    const delButton = document.createElement('button');
    delButton.textContent = '削除';
    delButton.addEventListener('click', () => {
      onDelete(task.id);
    });
    li.appendChild(delButton);
  }
  
  return li;
}

export function render(state) {
  listElement.innerHTML = '';

  if (state.isEditing) {
    editModeButtonElement.textContent = '編集完了'
  } else {
    editModeButtonElement.textContent = '編集'
  }

  let todosToRender;

  if (state.searchKeyword) {
    const keyword = state.searchKeyword.toLowerCase();

    todosToRender = state.todos.filter(todo => {
      return todo.text.toLowerCase().includes(keyword);
    });
  } else {
    todosToRender = state.todos;
  }

  todosToRender.forEach(todo => {
    const taskElement = createTaskElement(todo, onDeleteCallback, onToggleCallback, onUpdateCallback);
    listElement.appendChild(taskElement);
  });
}