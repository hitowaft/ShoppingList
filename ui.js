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
  const span = document.createElement('span');
  const checkbox = document.createElement('input');

  checkbox.type = 'checkbox';
  checkbox.checked = item.completed;
  if (item.completed) {
    span.classList.add('completed');
    li.classList.add('completed');
  }

  span.textContent = item.text;

  checkbox.addEventListener('change', () => {
    onToggle(item.id);
  });

  span.addEventListener('click', () => {
    if (isEditing) return;

    onToggle(item.id);
  })

  span.addEventListener('click', () => {
    if (!isEditing) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.text;

    const finishEditing = () => {
      const newText = input.value.trim();

      if (newText && newText !== item.text) {
        onUpdate(item.id, newText);
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

  let itemsToRender;

  if (state.searchKeyword) {
    const keyword = state.searchKeyword.toLowerCase();

    itemsToRender = state.items.filter(item => {
      return item.text.toLowerCase().includes(keyword);
    });
  } else {
    itemsToRender = state.items;
  }

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
