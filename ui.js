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

function createItemElement(item, onDelete, onToggle, onUpdate, isEditing, state) {
  const li = document.createElement('li');
  const checkbox = document.createElement('input');

  checkbox.type = 'checkbox';
  checkbox.checked = item.completed;
  if (item.completed) {
    li.classList.add('completed');
  }

  checkbox.addEventListener('change', () => {
    onToggle(item.id);
  });

  let contentElement;
  if (isEditing) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.text;
    if (item.completed) {
      input.classList.add('completed');
    }

    const finishEditing = () => {
      const newText = input.value.trim();
      if (newText && newText !== item.text) {
        onUpdate(item.id, newText);
      } else if (!newText) {
        render(state);
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finishEditing();
      if (e.key === 'Escape') render(state);
    });

    input.addEventListener('blur', finishEditing);

    contentElement = input;
  } else {
    const span = document.createElement('span');
    if (item.completed) {
      span.classList.add('completed');
    }
    span.textContent = item.text;
    span.addEventListener('click', () => {
      onToggle(item.id);
    });
    contentElement = span;
  }

  li.appendChild(checkbox);
  li.appendChild(contentElement);

  if (isEditing) {
    const delButton = document.createElement('button');
    delButton.textContent = '削除';
    delButton.addEventListener('click', () => {
      onDelete(item.id);
    });
    li.appendChild(delButton);
  }
  
  return li;
}

export function render(state) {
  listElement.innerHTML = '';

  if (state.isEditing) {
    editModeButtonElement.textContent = '設定完了'
  } else {
    editModeButtonElement.textContent = '編集・設定'
  }

  const activeItems = state.items.filter(item => !item.completed);
  const completedItems = state.items.filter(item => item.completed);
  const itemsToRender = [...activeItems, ...completedItems];

  itemsToRender.forEach(item => {
    const itemElement = createItemElement(
      item,
      onDeleteCallback,
      onToggleCallback,
      onUpdateCallback,
      state.isEditing,
      state
    );
    listElement.appendChild(itemElement);
  });
}
