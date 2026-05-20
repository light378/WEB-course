const refs = {
  authPanel: document.getElementById('authPanel'),
  cabinet: document.getElementById('cabinet'),
  authForm: document.getElementById('authForm'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  authSubmit: document.getElementById('authSubmit'),
  authMessage: document.getElementById('authMessage'),
  loginTab: document.getElementById('loginTab'),
  registerTab: document.getElementById('registerTab'),
  logout: document.getElementById('logout'),
  userEmail: document.getElementById('userEmail'),
  gen: document.getElementById('gen'),
  length: document.getElementById('length'),
  upper: document.getElementById('upper'),
  lower: document.getElementById('lower'),
  numbers: document.getElementById('numbers'),
  symbols: document.getElementById('symbols'),
  generated: document.getElementById('generated'),
  copyGenerated: document.getElementById('copyGenerated'),
  title: document.getElementById('title'),
  username: document.getElementById('username'),
  toStore: document.getElementById('toStore'),
  master: document.getElementById('master'),
  notes: document.getElementById('notes'),
  store: document.getElementById('store'),
  storeResult: document.getElementById('storeResult'),
  listMaster: document.getElementById('listMaster'),
  refresh: document.getElementById('refresh'),
  list: document.getElementById('list'),
  vaultStatus: document.getElementById('vaultStatus')
};

let authMode = 'login';

function setMessage(element, text, type = '') {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

function setStoreMessage(text, type = '') {
  setMessage(refs.storeResult, text, type);
}

function setAuthMessage(text, type = '') {
  setMessage(refs.authMessage, text, type);
}

function setBusy(button, busy, busyText = 'Зачекайте...') {
  button.disabled = busy;
  button.dataset.originalText ||= button.textContent;
  button.textContent = busy ? busyText : button.dataset.originalText;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Запит не виконано.');
  }

  return data;
}

function showCabinet(user) {
  refs.userEmail.textContent = user.email;
  refs.authPanel.classList.add('hidden');
  refs.cabinet.classList.remove('hidden');
  refs.vaultStatus.textContent = 'Увійшли в кабінет';
}

function showAuth() {
  refs.authPanel.classList.remove('hidden');
  refs.cabinet.classList.add('hidden');
  refs.vaultStatus.textContent = 'Потрібен вхід';
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === 'login';

  refs.loginTab.classList.toggle('active', isLogin);
  refs.registerTab.classList.toggle('active', !isLogin);
  refs.authSubmit.textContent = isLogin ? 'Увійти' : 'Зареєструватися';
  refs.authPassword.autocomplete = isLogin ? 'current-password' : 'new-password';
  setAuthMessage('');
}

async function checkSession() {
  try {
    const data = await requestJson('/api/me');
    if (data.user) {
      showCabinet(data.user);
      await generate();
      await refreshList();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

async function submitAuth(event) {
  event.preventDefault();
  setBusy(refs.authSubmit, true);
  setAuthMessage('');

  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const data = await requestJson(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        email: refs.authEmail.value,
        password: refs.authPassword.value
      })
    });

    refs.authPassword.value = '';
    showCabinet(data.user);
    await generate();
    await refreshList();
  } catch (error) {
    setAuthMessage(error.message, 'error');
  } finally {
    setBusy(refs.authSubmit, false);
  }
}

async function logout() {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } finally {
    refs.list.replaceChildren();
    refs.listMaster.value = '';
    showAuth();
  }
}

async function copyText(text) {
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    refs.vaultStatus.textContent = 'Скопійовано';
    setTimeout(() => {
      refs.vaultStatus.textContent = refs.cabinet.classList.contains('hidden')
        ? 'Потрібен вхід'
        : 'Увійшли в кабінет';
    }, 1400);
  } catch {
    refs.generated.select();
    document.execCommand('copy');
  }
}

async function generate() {
  setBusy(refs.gen, true);

  try {
    const data = await requestJson('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        length: refs.length.value,
        upper: refs.upper.checked,
        lower: refs.lower.checked,
        numbers: refs.numbers.checked,
        symbols: refs.symbols.checked
      })
    });

    refs.generated.value = data.password;
    refs.toStore.value = data.password;
    setStoreMessage('');
  } catch (error) {
    setStoreMessage(error.message, 'error');
  } finally {
    setBusy(refs.gen, false);
  }
}

async function storePassword() {
  setBusy(refs.store, true);
  setStoreMessage('');

  try {
    const data = await requestJson('/api/store', {
      method: 'POST',
      body: JSON.stringify({
        title: refs.title.value,
        username: refs.username.value,
        password: refs.toStore.value,
        master: refs.master.value,
        notes: refs.notes.value
      })
    });

    setStoreMessage(`Запис #${data.id} збережено.`, 'success');
    refs.title.value = '';
    refs.username.value = '';
    refs.notes.value = '';
    await refreshList();
  } catch (error) {
    setStoreMessage(error.message, 'error');
  } finally {
    setBusy(refs.store, false);
  }
}

function createText(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderEmptyState(text) {
  refs.list.replaceChildren(createText('div', text, 'empty-state'));
}

function renderRecord(record) {
  const item = document.createElement('article');
  item.className = 'record';

  const top = document.createElement('div');
  top.className = 'record-top';

  const title = document.createElement('div');
  title.className = 'record-title';
  title.append(
    createText('strong', record.title || 'Без назви'),
    createText('span', record.username || 'Логін не вказано')
  );

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'danger-button';
  deleteButton.textContent = 'Видалити';
  deleteButton.addEventListener('click', () => deleteRecord(record.id));

  top.append(title, deleteButton);

  const passwordLine = document.createElement('div');
  passwordLine.className = 'password-line';
  passwordLine.append(createText('span', 'Пароль'));

  const password = document.createElement('code');
  if (record.decryptError) {
    password.textContent = 'Не вдалося розшифрувати';
  } else if (record.password) {
    password.textContent = record.password;
  } else {
    password.textContent = 'Приховано';
  }

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'ghost-button';
  copyButton.textContent = 'Копія';
  copyButton.disabled = !record.password || record.decryptError;
  copyButton.addEventListener('click', () => copyText(record.password));

  passwordLine.append(password, copyButton);
  item.append(top, passwordLine);

  if (record.notes) {
    item.append(createText('p', record.notes, 'notes'));
  }

  item.append(createText('div', record.created_at || '', 'record-meta'));
  return item;
}

async function refreshList() {
  refs.refresh.disabled = true;

  try {
    const master = refs.listMaster.value;
    const query = master ? `?master=${encodeURIComponent(master)}` : '';
    const rows = await requestJson(`/api/list${query}`);

    if (!rows.length) {
      renderEmptyState('У цьому кабінеті записів ще немає.');
      return;
    }

    refs.list.replaceChildren(...rows.map(renderRecord));
  } catch (error) {
    if (error.message.includes('увійдіть')) showAuth();
    else renderEmptyState(error.message);
  } finally {
    refs.refresh.disabled = false;
  }
}

async function deleteRecord(id) {
  const confirmed = window.confirm('Видалити цей запис?');
  if (!confirmed) return;

  try {
    await requestJson(`/api/passwords/${id}`, { method: 'DELETE' });
    await refreshList();
  } catch (error) {
    renderEmptyState(error.message);
  }
}

refs.loginTab.addEventListener('click', () => setAuthMode('login'));
refs.registerTab.addEventListener('click', () => setAuthMode('register'));
refs.authForm.addEventListener('submit', submitAuth);
refs.logout.addEventListener('click', logout);
refs.gen.addEventListener('click', generate);
refs.copyGenerated.addEventListener('click', () => copyText(refs.generated.value));
refs.store.addEventListener('click', storePassword);
refs.refresh.addEventListener('click', refreshList);
refs.length.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') generate();
});

setAuthMode('login');
checkSession();
