/**
 * ハイブリッドデータローダー
 * 1) 静的JSONキャッシュ (data/*.json) + sessionStorage で即時表示・高耐障害性
 * 2) GAS Web API URL が設定されている場合はスプレッドシート最新データとバックグラウンド/手動同期
 */
import { APP_CONFIG } from './config.js';

const CACHE_PREFIX = 'gakuryoku_cache_v1_';
const GAS_URL_STORAGE_KEY = 'gakuryoku_gas_api_url';

export function getGasApiUrl() {
  try {
    const custom = localStorage.getItem(GAS_URL_STORAGE_KEY);
    if (custom && custom.trim()) return custom.trim();
  } catch (_) {}
  return (APP_CONFIG.GAS_API_URL || '').trim();
}

export function setCustomGasApiUrl(url) {
  try {
    const cleaned = String(url || '').trim();
    if (cleaned) {
      localStorage.setItem(GAS_URL_STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(GAS_URL_STORAGE_KEY);
    }
  } catch (_) {}
}

function readSessionCache(key) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > APP_CONFIG.CACHE_TTL_MS) return null;
    return parsed.data;
  } catch (_) {
    return null;
  }
}

function writeSessionCache(key, data) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

export function clearDataCache() {
  try {
    Object.keys(sessionStorage).forEach((k) => {
      if (k.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(k);
    });
  } catch (_) {}
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // GAS Web App は OPTIONS(CORSプリフライト)非対応のため、カスタムヘッダーや cache 制御ヘッダーを付けずシンプルGETにする
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * マスタ教科一覧の取得
 * 静的 data/meta.json で高速起動しつつ、GAS から最新マスタ（新学年追加等）を取得して自動更新
 */
export async function loadMeta({ forceRemote = false, onRemoteUpdate = null } = {}) {
  if (!forceRemote) {
    const cached = readSessionCache('meta');
    if (cached) return cached;
  }

  const gasUrl = getGasApiUrl();
  const fetchRemoteMeta = async () => {
    const remote = await fetchJson(`${gasUrl}?action=meta`, 10000);
    if (remote && remote.status === 'ok' && Array.isArray(remote.subjects)) {
      const meta = {
        spreadsheet_id: remote.spreadsheet_id || APP_CONFIG.SPREADSHEET_ID,
        updated_at: remote.updated_at,
        source: 'gas',
        subjects: remote.subjects.filter((s) => s.is_active !== false),
      };
      writeSessionCache('meta', meta);
      return meta;
    }
    throw new Error('Invalid GAS meta response');
  };

  if (gasUrl && forceRemote) {
    try {
      return await fetchRemoteMeta();
    } catch (err) {
      console.warn('GAS meta取得失敗。静的JSONへフォールバックします:', err);
    }
  }

  try {
    const localMeta = await fetchJson('data/meta.json');
    localMeta.source = 'static';
    writeSessionCache('meta', localMeta);

    // GAS URLが設定されていればバックグラウンドで最新マスタを取得（新学年追加を即時反映）
    if (gasUrl && !forceRemote) {
      fetchRemoteMeta()
        .then((remoteMeta) => {
          onRemoteUpdate?.(remoteMeta);
        })
        .catch(() => {});
    }
    return localMeta;
  } catch (err) {
    if (gasUrl) {
      return await fetchRemoteMeta();
    }
    throw err;
  }
}

/**
 * 特定教科の問題データ取得（例: sheetName = "5年_算数"）
 * 静的JSONが無い新学年でも、GAS Web API へ自動フォールバックして取得可能
 */
export async function loadSubjectQuestions(subjectMeta, { forceRemote = false } = {}) {
  const cacheKey = `sheet_${subjectMeta.sheet_name}`;
  if (!forceRemote) {
    const cached = readSessionCache(cacheKey);
    if (cached) return cached;
  }

  const gasUrl = getGasApiUrl();
  const fetchRemoteSheet = async () => {
    const remote = await fetchJson(
      `${gasUrl}?action=sheet&name=${encodeURIComponent(subjectMeta.sheet_name)}`,
      12000
    );
    if (remote && remote.status === 'ok' && Array.isArray(remote.rows)) {
      const activeRows = normalizeProblemRows(remote.rows);
      writeSessionCache(cacheKey, activeRows);
      return activeRows;
    }
    throw new Error(`Invalid GAS sheet response for ${subjectMeta.sheet_name}`);
  };

  if (gasUrl && forceRemote) {
    try {
      return await fetchRemoteSheet();
    } catch (err) {
      console.warn(`GAS ${subjectMeta.sheet_name} 取得失敗。静的JSONを使用:`, err);
    }
  }

  const filePath = subjectMeta.data_file || `data/${subjectMeta.sheet_name}.json`;
  try {
    const rows = await fetchJson(encodeURI(filePath));
    const activeRows = normalizeProblemRows(rows);
    writeSessionCache(cacheKey, activeRows);

    if (gasUrl && !forceRemote) {
      fetchRemoteSheet().catch(() => {});
    }
    return activeRows;
  } catch (localErr) {
    // 静的JSONがまだ無い新学年シート等は GAS から自動取得
    if (gasUrl) {
      return await fetchRemoteSheet();
    }
    throw localErr;
  }
}

/**
 * 単元ガイド取得（静的JSON未作成の新学年もGASへ自動フォールバック）
 */
export async function loadUnitGuides(grade = APP_CONFIG.DEFAULT_GRADE, { forceRemote = false } = {}) {
  const cacheKey = `guides_${grade}`;
  if (!forceRemote) {
    const cached = readSessionCache(cacheKey);
    if (cached) return cached;
  }

  const gasUrl = getGasApiUrl();
  const fetchRemoteGuides = async () => {
    const remote = await fetchJson(
      `${gasUrl}?action=guide&grade=${encodeURIComponent(grade)}`,
      10000
    );
    if (remote && remote.status === 'ok' && Array.isArray(remote.rows)) {
      writeSessionCache(cacheKey, remote.rows);
      return remote.rows;
    }
    throw new Error(`Invalid GAS guide response for ${grade}`);
  };

  if (gasUrl && forceRemote) {
    try {
      return await fetchRemoteGuides();
    } catch (err) {
      console.warn('GAS ガイド取得失敗。静的JSONを使用:', err);
    }
  }

  try {
    const guides = await fetchJson(encodeURI(`data/${grade}_単元ガイド.json`));
    writeSessionCache(cacheKey, guides);
    if (gasUrl && !forceRemote) {
      fetchRemoteGuides().catch(() => {});
    }
    return guides;
  } catch (localErr) {
    if (gasUrl) {
      return await fetchRemoteGuides();
    }
    throw localErr;
  }
}

function normalizeProblemRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && r.problem_id && r.is_active !== false && String(r.is_active).toLowerCase() !== 'false')
    .map((r) => ({
      ...r,
      unit_order: Number(r.unit_order) || 0,
      is_active: true,
    }));
}
