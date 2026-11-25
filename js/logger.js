/**
 * 児童プロフィール管理・端末内学習履歴 (localStorage) ・教員集計用簡易スコア送信 (GAS doPost + 再送キュー)
 * 識別項目: 学校名（半角英字）＋組＋出席番号
 */
import { APP_CONFIG } from './config.js';
import { getGasApiUrl } from './dataLoader.js';

const KEYS = {
  PROFILE: 'gakuryoku_profile_v1',
  PROGRESS: 'gakuryoku_progress_v1',
  UNITS: 'gakuryoku_units_v1',
  SETTINGS: 'gakuryoku_settings_v1',
  QUEUE: 'gakuryoku_log_queue_v1',
  DEVICE_ID: 'gakuryoku_device_id_v1',
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (_) {}
}

export function getDeviceId() {
  let id = localStorage.getItem(KEYS.DEVICE_ID);
  if (!id) {
    id = (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(KEYS.DEVICE_ID, id);
  }
  return id;
}

/**
 * 学校名（半角英字）のバリデーション
 */
export function validateSchoolCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return { valid: false, value: '', error: '学校名（半角英字）を入力してください。' };
  if (!/^[A-Za-z]+$/.test(s)) {
    return { valid: false, value: '', error: '学校名は半角アルファベット（a〜z）だけで入力してください。' };
  }
  return { valid: true, value: s.toLowerCase(), error: '' };
}

export function getProfile() {
  return readJSON(KEYS.PROFILE, null);
}

export function saveProfile({ school_code, grade, class_name, student_no }) {
  const profile = {
    school_code: String(school_code || '').trim().toLowerCase(),
    grade: grade || APP_CONFIG.DEFAULT_GRADE,
    class_name: String(class_name || '1組').trim(),
    student_no: Number(student_no) || 1,
    updated_at: new Date().toISOString(),
  };
  writeJSON(KEYS.PROFILE, profile);
  return profile;
}

export function formatProfileBadge(profile) {
  if (!profile || !profile.school_code) return 'なまえ設定（未登録）';
  return `${profile.school_code} ${profile.grade}${profile.class_name} ${profile.student_no}番`;
}

export function getSettings() {
  return {
    showRuby: true,
    verticalText: true,
    ...readJSON(KEYS.SETTINGS, {}),
  };
}

export function saveSettings(partial) {
  const next = { ...getSettings(), ...partial };
  writeJSON(KEYS.SETTINGS, next);
  return next;
}

export function getAllProgress() {
  return readJSON(KEYS.PROGRESS, {});
}

export function getUnitRecords() {
  return readJSON(KEYS.UNITS, {});
}

export function recordProblemAttempt(problemId, isCorrect) {
  const all = getAllProgress();
  const prev = all[problemId] || { attempts: 0, correctCount: 0, lastResult: false, needsReview: false };
  all[problemId] = {
    attempts: prev.attempts + 1,
    correctCount: prev.correctCount + (isCorrect ? 1 : 0),
    lastResult: Boolean(isCorrect),
    lastAttemptAt: new Date().toISOString(),
    needsReview: !isCorrect,
  };
  writeJSON(KEYS.PROGRESS, all);
}

export function recordUnitCompletion({ subjectKey, unitCode, score, total }) {
  const records = getUnitRecords();
  const key = `${subjectKey}__${unitCode}`;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const mark = pct >= 80 ? 'smile' : pct >= 50 ? 'normal' : 'try';
  const prev = records[key];
  const bestScore = prev ? Math.max(prev.bestScore, score) : score;
  const bestPct = prev ? Math.max(prev.bestPct || 0, pct) : pct;
  records[key] = {
    lastScore: score,
    bestScore,
    total,
    lastPct: pct,
    bestPct,
    mark: bestPct >= 80 ? 'smile' : bestPct >= 50 ? 'normal' : 'try',
    attempts: (prev?.attempts || 0) + 1,
    completedAt: new Date().toISOString(),
  };
  writeJSON(KEYS.UNITS, records);
  return { pct, mark };
}

export function resetAllLearningHistory() {
  localStorage.removeItem(KEYS.PROGRESS);
  localStorage.removeItem(KEYS.UNITS);
}

export function getPendingLogQueue() {
  return readJSON(KEYS.QUEUE, []);
}

function setPendingLogQueue(list) {
  writeJSON(KEYS.QUEUE, list);
}

/**
 * 簡易スコア送信（GAS Web APIへPOST、失敗・未設定時はキューへ退避）
 */
export async function submitScoreLog({
  subject,
  unitCode,
  unitName,
  mode,
  score,
  total,
  selfCheckCount,
  wrongIds,
  durationSec,
}) {
  const profile = getProfile();
  const record = {
    logged_at: new Date().toISOString(),
    school_code: profile?.school_code || 'guest',
    grade: profile?.grade || APP_CONFIG.DEFAULT_GRADE,
    class_name: profile?.class_name || '未設定',
    student_no: profile?.student_no || 0,
    subject,
    unit_code: unitCode,
    unit_name: unitName,
    mode,
    score,
    total,
    accuracy_pct: total > 0 ? Math.round((score / total) * 100) : 0,
    self_check_count: selfCheckCount || 0,
    wrong_ids: (wrongIds || []).join(','),
    duration_sec: Math.round(durationSec || 0),
    device_id: getDeviceId(),
  };

  const gasUrl = getGasApiUrl();
  if (!gasUrl) {
    // GAS未設定時はローカルキューへ保持（後で設定すれば一括送信可能）
    const q = getPendingLogQueue();
    q.push(record);
    setPendingLogQueue(q.slice(-100));
    return { status: 'queued_no_url', message: '端末にきろくをほぞんしました（先生送信URL未設定）' };
  }

  try {
    const res = await postToGas(gasUrl, { logs: [record] });
    if (res.ok) {
      // 溜まっていた未送信キューもついでにフラッシュ
      flushPendingLogQueue().catch(() => {});
      return { status: 'sent', message: '先生にきろくを送りました！' };
    }
    throw new Error('GAS response not ok');
  } catch (err) {
    const q = getPendingLogQueue();
    q.push(record);
    setPendingLogQueue(q.slice(-100));
    return { status: 'queued_offline', message: 'いま通信できないため、あとで自動で先生に送ります。' };
  }
}

export async function flushPendingLogQueue() {
  const gasUrl = getGasApiUrl();
  const q = getPendingLogQueue();
  if (!gasUrl || q.length === 0) return { flushed: 0, remaining: q.length };

  // 最大30件ずつバッチ送信
  const batch = q.slice(0, 30);
  try {
    const res = await postToGas(gasUrl, { logs: batch });
    if (res.ok) {
      const rest = q.slice(batch.length);
      setPendingLogQueue(rest);
      return { flushed: batch.length, remaining: rest.length };
    }
  } catch (_) {}
  return { flushed: 0, remaining: q.length };
}

async function postToGas(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}
