const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DB_DIR = path.join(__dirname, 'db');
const DEFAULT_DB_FILE = path.join(DB_DIR, 'database.sqlite');
const DB_FILE = process.env.DATABASE_FILE
  ? path.resolve(__dirname, process.env.DATABASE_FILE)
  : DEFAULT_DB_FILE;
const PORT = process.env.PORT || 3000;
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const SESSION_COOKIE = 'vault_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_ROUNDS = 200000;

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new sqlite3.Database(DB_FILE);
const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');

db.serialize(() => {
  db.exec(initSql);
  db.all('PRAGMA table_info(passwords)', (err, columns) => {
    if (!err && !columns.some((column) => column.name === 'user_id')) {
      db.run('ALTER TABLE passwords ADD COLUMN user_id INTEGER');
    }
  });
});

const app = express();
app.use(express.json({ limit: '24kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const characterSets = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?'
};

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function clampLength(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 16;
  return Math.min(Math.max(parsed, MIN_LENGTH), MAX_LENGTH);
}

function randomChar(chars) {
  return chars[crypto.randomInt(0, chars.length)];
}

function shuffleSecure(chars) {
  const out = [...chars];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function normalizeOptions(options = {}) {
  const enabled = Object.entries(characterSets)
    .filter(([key]) => options[key] !== false)
    .map(([key, chars]) => ({ key, chars }));

  return {
    length: clampLength(options.length),
    enabled: enabled.length ? enabled : [{ key: 'lower', chars: characterSets.lower }]
  };
}

function generatePassword(options) {
  const { length, enabled } = normalizeOptions(options);
  const pool = enabled.map((set) => set.chars).join('');
  const required = enabled.map((set) => randomChar(set.chars));
  const rest = Array.from({ length: Math.max(0, length - required.length) }, () => randomChar(pool));

  return shuffleSecure([...required, ...rest]);
}

function hashLoginPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, PASSWORD_KEY_ROUNDS, 32, 'sha256');
  return { salt, hash: hash.toString('base64') };
}

function verifyLoginPassword(password, storedHash, salt) {
  const candidate = hashLoginPassword(password, salt).hash;
  const candidateBuffer = Buffer.from(candidate, 'base64');
  const storedBuffer = Buffer.from(storedHash, 'base64');

  return candidateBuffer.length === storedBuffer.length
    && crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

function encrypt(plaintext, masterPassword) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(masterPassword, salt, PASSWORD_KEY_ROUNDS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
}

function decrypt(encrypted, masterPassword) {
  const salt = Buffer.from(encrypted.salt, 'base64');
  const iv = Buffer.from(encrypted.iv, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const key = crypto.pbkdf2Sync(masterPassword, salt, PASSWORD_KEY_ROUNDS, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, chunk) => {
    const [rawKey, ...rawValue] = chunk.trim().split('=');
    if (!rawKey) return cookies;
    cookies[rawKey] = decodeURIComponent(rawValue.join('='));
    return cookies;
  }, {});
}

function sessionHash(token) {
  return crypto.createHash('sha256').update(token).digest('base64');
}

function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;

  await run(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, sessionHash(token), expiresAt]
  );
  setSessionCookie(res, token, expiresAt);
}

async function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const row = await get(
    `SELECT users.id, users.email, sessions.expires_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`,
    [sessionHash(token)]
  );

  if (!row) return null;

  if (row.expires_at <= Date.now()) {
    await run('DELETE FROM sessions WHERE token_hash = ?', [sessionHash(token)]);
    return null;
  }

  return { id: row.id, email: row.email };
}

async function requireUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Спочатку увійдіть у кабінет.' });
    req.user = user;
    return next();
  } catch (err) {
    return sendDatabaseError(res, err, 'Session read failed');
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateAuthInput(email, password) {
  if (!email || !email.includes('@')) return 'Введіть коректний email.';
  if (String(password || '').length < 8) return 'Пароль акаунта має містити мінімум 8 символів.';
  return '';
}

function sendDatabaseError(res, err, action) {
  console.error(`${action}:`, err);
  res.status(500).json({ error: 'Помилка бази даних. Спробуйте ще раз.' });
}

app.get('/api/me', async (req, res) => {
  try {
    const user = await currentUser(req);
    return res.json({ user });
  } catch (err) {
    return sendDatabaseError(res, err, 'Current user read failed');
  }
});

app.post('/api/auth/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const validationError = validateAuthInput(email, password);

  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const { hash, salt } = hashLoginPassword(password);
    const result = await run(
      'INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)',
      [email, hash, salt]
    );
    await createSession(res, result.lastID);
    return res.status(201).json({ user: { id: result.lastID, email } });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'Такий email вже зареєстрований.' });
    }
    return sendDatabaseError(res, err, 'User registration failed');
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!email || !password) return res.status(400).json({ error: 'Введіть email і пароль.' });

  try {
    const user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !verifyLoginPassword(password, user.password_hash, user.password_salt)) {
      return res.status(401).json({ error: 'Невірний email або пароль.' });
    }

    await createSession(res, user.id);
    return res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    return sendDatabaseError(res, err, 'User login failed');
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];

  try {
    if (token) await run('DELETE FROM sessions WHERE token_hash = ?', [sessionHash(token)]);
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (err) {
    return sendDatabaseError(res, err, 'User logout failed');
  }
});

app.post('/api/generate', (req, res) => {
  res.json({ password: generatePassword(req.body || {}) });
});

app.post('/api/store', requireUser, async (req, res) => {
  const { title = '', username = '', password = '', notes = '', master = '' } = req.body || {};

  if (!String(master).trim()) {
    return res.status(400).json({ error: 'Введіть майстер-пароль.' });
  }

  if (!String(password).trim()) {
    return res.status(400).json({ error: 'Немає пароля для збереження.' });
  }

  try {
    const encrypted = encrypt(String(password), String(master));
    const result = await run(
      `INSERT INTO passwords (user_id, title, username, ciphertext, iv, salt, auth_tag, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        String(title).trim(),
        String(username).trim(),
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.salt,
        encrypted.authTag,
        String(notes).trim()
      ]
    );

    return res.status(201).json({ id: result.lastID });
  } catch (err) {
    return sendDatabaseError(res, err, 'DB insert failed');
  }
});

app.get('/api/list', requireUser, async (req, res) => {
  const master = String(req.query.master || '');

  try {
    const rows = await all(
      `SELECT id, title, username, ciphertext, iv, salt, auth_tag, notes, created_at
       FROM passwords
       WHERE user_id = ?
       ORDER BY id DESC`,
      [req.user.id]
    );

    const out = rows.map((row) => {
      let password = '';
      let decryptError = false;

      if (master) {
        try {
          password = decrypt({
            ciphertext: row.ciphertext,
            iv: row.iv,
            salt: row.salt,
            authTag: row.auth_tag
          }, master);
        } catch {
          decryptError = true;
        }
      }

      return {
        id: row.id,
        title: row.title,
        username: row.username,
        password,
        decryptError,
        notes: row.notes,
        created_at: row.created_at
      };
    });

    return res.json(out);
  } catch (err) {
    return sendDatabaseError(res, err, 'DB read failed');
  }
});

app.delete('/api/passwords/:id', requireUser, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Некоректний ID запису.' });

  try {
    const result = await run('DELETE FROM passwords WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!result.changes) return res.status(404).json({ error: 'Запис не знайдено.' });
    return res.json({ ok: true });
  } catch (err) {
    return sendDatabaseError(res, err, 'DB delete failed');
  }
});

app.listen(PORT, () => {
  console.log(`Password vault is running on http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_FILE}`);
});
