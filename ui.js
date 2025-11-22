let listElement;
let onDeleteCallback;
let onToggleCallback;
let onUpdateCallback;
let editModeButtonElement;
const itemElements = new Map();
let currentEditMode = null;

export function initUI(config) {
  listElement = config.listElement;
  onDeleteCallback = config.onDelete;
  onToggleCallback = config.onToggle;
  onUpdateCallback = config.onUpdate;
  editModeButtonElement = config.editModeButtonElement;
}

function createItemElement(item, onDelete, onToggle, onUpdate, isEditing, state) {
  const li = document.createElement('li');
  li.dataset.mode = isEditing ? 'edit' : 'view';
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

function updateItemElement(element, item, isEditing) {
  const checkbox = element.querySelector('input[type="checkbox"]');
  if (checkbox) {
    checkbox.checked = item.completed;
  }

  element.classList.toggle('completed', item.completed);

  if (isEditing) {
    const input = element.querySelector('input[type="text"]');
    if (input) {
      if (input.value !== item.text) {
        input.value = item.text;
      }
      input.classList.toggle('completed', item.completed);
    }
  } else {
    const span = element.querySelector('span');
    if (span && span.textContent !== item.text) {
      span.textContent = item.text;
    }
    if (span) {
      span.classList.toggle('completed', item.completed);
    }
  }

  return element;
}

export function render(state) {
  if (!listElement) {
    return;
  }

  if (editModeButtonElement) {
    editModeButtonElement.textContent = state.isEditing ? '設定完了' : '編集・設定';
  }

  const activeItems = state.items.filter(item => !item.completed);
  const completedItems = state.items.filter(item => item.completed);
  const itemsToRender = [...activeItems, ...completedItems];
  const modeChanged = currentEditMode !== state.isEditing;

  if (modeChanged) {
    listElement.innerHTML = '';
    itemElements.clear();
  }

  const fragment = document.createDocumentFragment();
  const nextIds = new Set();

  itemsToRender.forEach(item => {
    nextIds.add(item.id);
    let itemElement = itemElements.get(item.id);
    const elementMode = itemElement?.dataset?.mode;
    const modeKey = state.isEditing ? 'edit' : 'view';
    if (!itemElement || elementMode !== modeKey) {
      itemElement = createItemElement(
        item,
        onDeleteCallback,
        onToggleCallback,
        onUpdateCallback,
        state.isEditing,
        state
      );
      itemElements.set(item.id, itemElement);
    } else {
      updateItemElement(itemElement, item, state.isEditing);
    }
    fragment.appendChild(itemElement);
  });

  listElement.appendChild(fragment);

  itemElements.forEach((element, id) => {
    if (!nextIds.has(id)) {
      element.remove();
      itemElements.delete(id);
    }
  });

  currentEditMode = state.isEditing;
}
