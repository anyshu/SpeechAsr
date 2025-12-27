const path = require('path');
const Store = require('electron-store');

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return null;
  }
}

function createPersistence({ app, defaults }) {
  const userData = app.getPath('userData');
  const fallbackStore = new Store({ name: 'xigua-sqlite-fallback' });
  let Database = null;
  let db = null;
  let mode = 'fallback';

  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    Database = require('better-sqlite3');
  } catch (err) {
    console.warn('[persistence] better-sqlite3 未安装，回退到 electron-store', err?.message || err);
  }

  if (Database) {
    try {
      const dbPath = path.join(userData, 'xigua-data.sqlite');
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER,
          persona TEXT,
          length INTEGER,
          status TEXT,
          text TEXT
        );
      `);
      mode = 'sqlite';
      console.log('[persistence] sqlite 初始化完成', dbPath);
    } catch (err) {
      console.warn('[persistence] 初始化 sqlite 失败，回退到 electron-store', err?.message || err);
      db = null;
      mode = 'fallback';
    }
  }

  function kvGet(key, fallback) {
    if (db) {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      if (row && typeof row.value === 'string') {
        const parsed = safeParse(row.value, undefined);
        if (parsed !== undefined) return parsed;
      }
    }
    return fallbackStore.get(key, fallback);
  }

  function kvSet(key, value) {
    const serialized = safeStringify(value);
    if (serialized != null && db) {
      db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, serialized);
    }
    if (serialized != null) {
      fallbackStore.set(key, value);
    }
  }

  function ensurePersonaDefaults(data) {
    const personas = Array.isArray(data?.personas) && data.personas.length ? data.personas : defaults.personas;
    const activeId =
      data?.activeId && personas.some((p) => p.id === data.activeId)
        ? data.activeId
        : personas[0]?.id || defaults.personas[0]?.id;
    return { personas, activeId };
  }

  function loadPersonas() {
    const stored = kvGet('personas', null);
    const merged = ensurePersonaDefaults(stored || defaults);
    if (!stored) {
      kvSet('personas', merged);
    }
    return merged;
  }

  function savePersonas(nextState) {
    const merged = ensurePersonaDefaults(nextState || {});
    kvSet('personas', merged);
    return merged;
  }

  function listHistory(limit = 50) {
    if (db) {
      const rows = db
        .prepare('SELECT id, created_at as time, persona, length, status, text FROM history ORDER BY created_at DESC LIMIT ?')
        .all(Math.max(1, limit));
      return rows.map((r) => ({
        id: r.id,
        time: r.time,
        persona: r.persona,
        length: r.length,
        status: r.status,
        text: r.text
      }));
    }
    const arr = kvGet('history', []) || [];
    return Array.isArray(arr) ? arr.slice(0, limit) : [];
  }

  function addHistory(entry, max = 500) {
    const normalized = {
      time: entry?.time || Date.now(),
      persona: entry?.persona || '人设',
      length: Number(entry?.length) || 0,
      status: entry?.status || 'ok',
      text: entry?.text || ''
    };
    if (db) {
      db.prepare('INSERT INTO history (created_at, persona, length, status, text) VALUES (@time, @persona, @length, @status, @text)').run(normalized);
      db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY created_at DESC LIMIT ?)').run(max);
      return;
    }
    const arr = kvGet('history', []);
    const list = Array.isArray(arr) ? arr : [];
    list.unshift({ id: `${Date.now()}`, ...normalized });
    kvSet('history', list.slice(0, max));
  }

  function getUsageStats() {
    const fallback = { totalChars: 0, sessions: 0, lastText: '', lastPersona: '', lastTime: null };
    return kvGet('usage-stats', fallback);
  }

  function setUsageStats(stats) {
    const safe = stats || {};
    kvSet('usage-stats', {
      totalChars: Number(safe.totalChars) || 0,
      sessions: Number(safe.sessions) || 0,
      lastText: safe.lastText || '',
      lastPersona: safe.lastPersona || '',
      lastTime: safe.lastTime || null
    });
    return getUsageStats();
  }

  return {
    mode,
    loadPersonas,
    savePersonas,
    listHistory,
    addHistory,
    getUsageStats,
    setUsageStats
  };
}

module.exports = { createPersistence };
