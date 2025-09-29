import { state } from './state.js';
let listElement;
let onDeleteCallback;
let onToggleCallback;

export function initUI(config) {
  listElement = config.listElement;
  onDeleteCallback = config.onDelete;
  onToggleCallback = config.onToggle;
}

function createTaskElement(task, onDelete, onToggle) {
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
    onToggle(task.id);
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
    const taskElement = createTaskElement(todo, onDeleteCallback, onToggleCallback);
    listElement.appendChild(taskElement);
  });
}