/**
 * 先生用：取組状況確認（認証・セッション管理・集計ロジック・ダッシュボードUI）
 *
 * セキュリティ設計:
 * - パスワードは一切フロントエンドに持たず、GAS (doPost) 側で学校別に照合する
 * - 認証トークンはタブ終了で消滅する sessionStorage のみ保持（localStorage 不使用・パスワード非保存）
 * - 30分間の無操作で自動ログアウト
 * - 旧バージョンの GAS に誤送信しても学習ログへ追記されないよう logs: [] を同梱して保護
 */
import { APP_CONFIG } from './config.js';
import { getGasApiUrl } from './dataLoader.js';
import { validateSchoolCode } from './logger.js';
import { escapeHtml, renderRichText } from './renderers.js';

const SESSION_KEY = 'gakuryoku_teacher_session_v1';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const LOGS_PER_PAGE = 50;

const MODE_LABELS = {
  unit: '単元演習',
  retry: '苦手復習',
  mock: '模擬テスト',
};

const SUBJECT_COLOR_FALLBACK = {
  '国語': '#DC2626',
  '社会': '#D97706',
  '算数': '#2563EB',
  '理科': '#059669',
};

const dashboardState = {
  activeTab: 'matrix', // 'matrix' | 'students' | 'units' | 'logs'
  filters: {
    grade: 'すべて',
    className: 'すべて',
    subject: 'すべて',
    mode: 'すべて',
    period: 'all', // 'all' | 'today' | '7d' | '30d' | 'custom'
    dateFrom: '',
    dateTo: '',
    studentNo: '',
  },
  matrixSubject: '', // マトリクス表示対象教科
  matrixShowAllNumbers: false, // 1〜40番をすべて並べるトグル
  studentSort: 'no_asc', // 'no_asc' | 'acc_desc' | 'acc_asc' | 'attempts_desc' | 'recent_desc'
  unitSort: 'acc_asc',   // 'acc_asc' | 'order_asc' | 'students_desc' | 'attempts_desc'
  logPage: 1,
  refreshing: false,
  statusMsg: '',
};

let idleTimerId = null;
let onAutoLogoutCallback = null;

// ================= セッション管理 (sessionStorage のみ) =================

export function getTeacherSession() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.token || !session.school_code) return null;
    if (session.expires_at && Date.now() > session.expires_at) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch (_) {
    return null;
  }
}

function saveTeacherSession(data) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const ttlMs = (Number(data.expires_in_sec) || 1800) * 1000;
    const session = {
      token: data.token,
      school_code: data.school_code,
      school_label: data.school_label || data.school_code,
      fetched_at: data.fetched_at || new Date().toISOString(),
      expires_at: Date.now() + ttlMs,
      total_count: Number(data.total_count ?? (data.logs || []).length) || 0,
      truncated: Boolean(data.truncated),
      logs: Array.isArray(data.logs) ? data.logs : [],
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (_) {}
}

export function clearTeacherSession() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch (_) {}
  stopIdleTimer();
}

export function setAutoLogoutHandler(fn) {
  onAutoLogoutCallback = fn;
}

export function touchTeacherActivity() {
  const session = getTeacherSession();
  if (!session) {
    stopIdleTimer();
    return;
  }
  stopIdleTimer();
  idleTimerId = setTimeout(() => {
    const active = getTeacherSession();
    if (!active) return;
    logoutTeacher().catch(() => {});
    if (typeof onAutoLogoutCallback === 'function') {
      onAutoLogoutCallback('30分間操作がなかったため、安全のため自動ログアウトしました。');
    }
  }, IDLE_TIMEOUT_MS);
}

function stopIdleTimer() {
  if (idleTimerId) {
    clearTimeout(idleTimerId);
    idleTimerId = null;
  }
}

// ================= GAS API 通信 =================

async function postTeacherApi(payload) {
  const gasUrl = getGasApiUrl();
  if (!gasUrl) {
    return {
      status: 'error',
      code: 'NO_GAS_URL',
      message: 'GASウェブアプリURLが設定されていません。設定画面からURLを保存してください。',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    // 旧GAS(Code.gs)へ誤到達しても学習ログに書き込まれないよう logs: [] を安全弁として付与
    const bodyObj = { ...payload, logs: [] };
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(bodyObj),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        status: 'error',
        code: 'HTTP_ERROR',
        message: `通信エラーが発生しました（HTTP ${res.status}）。時間をおいて再度お試しください。`,
      };
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return {
        status: 'error',
        code: 'INVALID_RESPONSE',
        message: 'GASから正しい応答を受け取れませんでした。デプロイ設定（アクセスできるユーザー：全員）をご確認ください。',
      };
    }

    // 旧版 GAS（teacher_auth 未対応）へのアクセスを検知して分かりやすく案内
    if (data && data.status === 'error' && data.message === 'Invalid batch size') {
      return {
        status: 'error',
        code: 'GAS_OUTDATED',
        message: 'GASウェブアプリ（Code.gs）が旧バージョンのままです。最新の gas/Code.gs を貼り付けて「新バージョン」でデプロイしてください。',
      };
    }
    return data;
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    return {
      status: 'error',
      code: 'NETWORK_ERROR',
      message: isAbort
        ? 'サーバーからの応答がタイムアウトしました。通信環境を確認してもう一度お試しください。'
        : '通信できませんでした。ネットワーク接続とGAS URLをご確認ください。',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function authenticateTeacher({ schoolCode, password }) {
  const check = validateSchoolCode(schoolCode);
  if (!check.valid) {
    return { ok: false, code: 'VALIDATION', message: check.error };
  }
  const pass = String(password || '');
  if (!pass) {
    return { ok: false, code: 'VALIDATION', message: 'パスワードを入力してください。' };
  }

  const data = await postTeacherApi({
    action: 'teacher_auth',
    school_code: check.value,
    password: pass,
  });

  if (!data || data.status !== 'ok' || !data.token) {
    return {
      ok: false,
      code: data?.code || 'AUTH_FAILED',
      message: data?.message || '学校名またはパスワードが正しくありません。',
    };
  }

  saveTeacherSession(data);
  touchTeacherActivity();
  dashboardState.logPage = 1;
  dashboardState.statusMsg = '';
  return { ok: true, session: getTeacherSession() };
}

export async function refreshTeacherLogs() {
  const session = getTeacherSession();
  if (!session) {
    return { ok: false, code: 'TOKEN_EXPIRED', message: '認証セッションがありません。もう一度パスワードを入力してください。' };
  }

  const data = await postTeacherApi({
    action: 'teacher_logs',
    school_code: session.school_code,
    token: session.token,
  });

  if (!data || data.status !== 'ok') {
    if (data?.code === 'TOKEN_EXPIRED') {
      clearTeacherSession();
    }
    return {
      ok: false,
      code: data?.code || 'ERROR',
      message: data?.message || '最新データの取得に失敗しました。',
    };
  }

  saveTeacherSession({
    ...data,
    token: session.token,
    school_code: data.school_code || session.school_code,
    school_label: data.school_label || session.school_label,
  });
  touchTeacherActivity();
  return { ok: true, session: getTeacherSession() };
}

export async function logoutTeacher() {
  const session = getTeacherSession();
  clearTeacherSession();
  if (session?.token) {
    postTeacherApi({ action: 'teacher_logout', token: session.token }).catch(() => {});
  }
}

// ================= 純粋集計ロジック（単体テスト対象） =================

/**
 * logged_at（"YYYY-MM-DD HH:mm:ss" または ISO文字列）から YYYY-MM-DD を取り出す
 */
export function extractDateYmd(loggedAt) {
  const s = String(loggedAt || '').trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return formatLocalYmd(d);
  }
  return '';
}

function formatLocalYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function filterTeacherLogs(logs, filters = {}, nowDate = new Date()) {
  const list = Array.isArray(logs) ? logs : [];
  const todayYmd = formatLocalYmd(nowDate);

  let minYmd = '';
  let maxYmd = '';
  if (filters.period === 'today') {
    minYmd = todayYmd;
    maxYmd = todayYmd;
  } else if (filters.period === '7d') {
    const d = new Date(nowDate.getTime());
    d.setDate(d.getDate() - 6);
    minYmd = formatLocalYmd(d);
  } else if (filters.period === '30d') {
    const d = new Date(nowDate.getTime());
    d.setDate(d.getDate() - 29);
    minYmd = formatLocalYmd(d);
  } else if (filters.period === 'custom') {
    minYmd = String(filters.dateFrom || '').trim();
    maxYmd = String(filters.dateTo || '').trim();
  }

  const numQuery = String(filters.studentNo || '').trim();

  return list.filter((log) => {
    if (filters.grade && filters.grade !== 'すべて' && log.grade !== filters.grade) return false;
    if (filters.className && filters.className !== 'すべて' && log.class_name !== filters.className) return false;
    if (filters.subject && filters.subject !== 'すべて' && log.subject !== filters.subject) return false;
    if (filters.mode && filters.mode !== 'すべて' && log.mode !== filters.mode) return false;
    if (numQuery) {
      const noStr = String(log.student_no ?? '');
      if (/^\d+$/.test(numQuery)) {
        if (Number(log.student_no) !== Number(numQuery)) return false;
      } else if (!noStr.includes(numQuery)) {
        return false;
      }
    }
    if (minYmd || maxYmd) {
      const ymd = extractDateYmd(log.logged_at);
      if (!ymd) return false;
      if (minYmd && ymd < minYmd) return false;
      if (maxYmd && ymd > maxYmd) return false;
    }
    return true;
  });
}

export function computeKpiSummary(filteredLogs, nowDate = new Date()) {
  const list = Array.isArray(filteredLogs) ? filteredLogs : [];
  const todayYmd = formatLocalYmd(nowDate);
  const studentSet = new Set();
  let todayAttempts = 0;
  let accSum = 0;
  let passCount = 0;

  list.forEach((l) => {
    if (l.student_key) studentSet.add(l.student_key);
    else studentSet.add(`${l.grade}_${l.class_name}_${l.student_no}`);
    if (extractDateYmd(l.logged_at) === todayYmd) todayAttempts++;
    const pct = Number(l.accuracy_pct) || 0;
    accSum += pct;
    if (pct >= 80) passCount++;
  });

  const totalAttempts = list.length;
  return {
    uniqueStudents: studentSet.size,
    totalAttempts,
    todayAttempts,
    avgAccuracy: totalAttempts > 0 ? Math.round(accSum / totalAttempts) : 0,
    passRate: totalAttempts > 0 ? Math.round((passCount / totalAttempts) * 100) : 0,
    passCount,
  };
}

function classSortRank(className) {
  const m = String(className || '').match(/(\d+)/);
  return m ? Number(m[1]) : 999;
}

/**
 * 進捗マトリクス構築（出席番号 × 単元）
 * - showAllNumbers=false: ログが存在する児童のみ並べる
 * - showAllNumbers=true: 対象組ごとに 1番〜40番（41番以上のログがあればその最大番号まで）をすべて並べる
 */
export function buildProgressMatrix(
  filteredLogs,
  units,
  { showAllNumbers = false, maxNo = 40, classFilter = 'すべて', gradeFilter = 'すべて' } = {}
) {
  const list = Array.isArray(filteredLogs) ? filteredLogs : [];
  const columns = (units || []).map((u) => ({
    unit_code: u.unit_code,
    unit_order: Number(u.unit_order) || 999,
    unit_name: u.unit_name,
  }));

  // 模擬テスト(MOCK)ログがある場合は末尾に「模擬テスト」列を追加
  const hasMock = list.some((l) => l.unit_code === 'MOCK');
  if (hasMock && !columns.some((c) => c.unit_code === 'MOCK')) {
    columns.push({ unit_code: 'MOCK', unit_order: 9999, unit_name: '模擬テスト' });
  }
  // マスタ未収録の単元コードがログにある場合も列へ補完
  const colSet = new Set(columns.map((c) => c.unit_code));
  list.forEach((l) => {
    if (l.unit_code && l.unit_code !== 'RETRY' && !colSet.has(l.unit_code)) {
      colSet.add(l.unit_code);
      columns.push({
        unit_code: l.unit_code,
        unit_order: 9000,
        unit_name: l.unit_name || l.unit_code,
      });
    }
  });

  // セルマップ: rowId -> { unit_code -> cellAgg }
  const cellsByRow = new Map();
  const loggedRowMeta = new Map();

  list.forEach((l) => {
    const grade = l.grade || '';
    const cls = l.class_name || '未設定';
    const no = Number(l.student_no) || 0;
    const rowId = `${grade}__${cls}__${no}`;

    if (!loggedRowMeta.has(rowId)) {
      loggedRowMeta.set(rowId, {
        rowId,
        grade,
        class_name: cls,
        student_no: no,
        student_key: l.student_key || `${l.school_code}_${grade}_${cls}_${String(no).padStart(2, '0')}`,
      });
    }
    if (!cellsByRow.has(rowId)) cellsByRow.set(rowId, new Map());
    const uMap = cellsByRow.get(rowId);
    const uCode = l.unit_code || 'OTHER';
    const prev = uMap.get(uCode) || {
      bestPct: -1,
      lastPct: 0,
      attempts: 0,
      hasSelfCheck: false,
      logs: [],
    };
    const pct = Number(l.accuracy_pct) || 0;
    prev.attempts += 1;
    if (pct > prev.bestPct) prev.bestPct = pct;
    if (prev.logs.length === 0) prev.lastPct = pct; // listは最新順前提
    if ((Number(l.self_check_count) || 0) > 0) prev.hasSelfCheck = true;
    prev.logs.push(l);
    uMap.set(uCode, prev);
  });

  let rows = [];
  if (!showAllNumbers) {
    rows = [...loggedRowMeta.values()].sort((a, b) => {
      if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, 'ja');
      const cr = classSortRank(a.class_name) - classSortRank(b.class_name);
      if (cr !== 0) return cr;
      if (a.class_name !== b.class_name) return a.class_name.localeCompare(b.class_name, 'ja');
      return a.student_no - b.student_no;
    });
  } else {
    // 1〜40番をすべて並べるモード
    const targetGrade = gradeFilter !== 'すべて'
      ? gradeFilter
      : (loggedRowMeta.size > 0 ? [...loggedRowMeta.values()][0].grade : APP_CONFIG.DEFAULT_GRADE);

    let targetClasses = [];
    if (classFilter && classFilter !== 'すべて') {
      targetClasses = [classFilter];
    } else {
      const presentClasses = [...new Set([...loggedRowMeta.values()].map((r) => r.class_name).filter(Boolean))];
      targetClasses = presentClasses.length > 0
        ? presentClasses.sort((a, b) => classSortRank(a) - classSortRank(b) || a.localeCompare(b, 'ja'))
        : ['1組'];
    }

    const maxLoggedNo = [...loggedRowMeta.values()].reduce((m, r) => Math.max(m, r.student_no), 0);
    const upperNo = Math.max(maxNo, Math.min(maxLoggedNo, APP_CONFIG.MAX_STUDENT_NO));

    const addedIds = new Set();
    targetClasses.forEach((cls) => {
      for (let no = 1; no <= upperNo; no++) {
        const rowId = `${targetGrade}__${cls}__${no}`;
        addedIds.add(rowId);
        const existing = loggedRowMeta.get(rowId);
        rows.push(existing || {
          rowId,
          grade: targetGrade,
          class_name: cls,
          student_no: no,
          student_key: `${targetGrade}_${cls}_${String(no).padStart(2, '0')}`,
        });
      }
    });

    // 別学年や0番など対象外番号のログがある場合も末尾に安全表示
    loggedRowMeta.forEach((meta, id) => {
      if (!addedIds.has(id)) rows.push(meta);
    });
  }

  return {
    columns,
    rows: rows.map((r) => {
      const uMap = cellsByRow.get(r.rowId) || new Map();
      const cells = {};
      let attemptedUnits = 0;
      let clearedUnits = 0;
      columns.forEach((c) => {
        const agg = uMap.get(c.unit_code) || null;
        cells[c.unit_code] = agg;
        if (agg) {
          attemptedUnits++;
          if (agg.bestPct >= 80) clearedUnits++;
        }
      });
      return {
        ...r,
        cells,
        attemptedUnits,
        clearedUnits,
      };
    }),
  };
}

export function buildStudentSummaries(filteredLogs) {
  const list = Array.isArray(filteredLogs) ? filteredLogs : [];
  const map = new Map();

  list.forEach((l) => {
    const key = l.student_key || `${l.school_code}_${l.grade}_${l.class_name}_${String(l.student_no).padStart(2, '0')}`;
    if (!map.has(key)) {
      map.set(key, {
        student_key: key,
        grade: l.grade || '',
        class_name: l.class_name || '未設定',
        student_no: Number(l.student_no) || 0,
        attempts: 0,
        accSum: 0,
        unitBestMap: new Map(), // subject__unit_code -> bestPct
        bySubject: new Map(),   // subject -> { attempts, accSum, units: Map<unit_code, bestPct> }
        lastLoggedAt: '',
        logs: [],
      });
    }
    const st = map.get(key);
    const pct = Number(l.accuracy_pct) || 0;
    st.attempts += 1;
    st.accSum += pct;
    if (!st.lastLoggedAt || l.logged_at > st.lastLoggedAt) {
      st.lastLoggedAt = l.logged_at;
    }
    st.logs.push(l);

    const uKey = `${l.subject}__${l.unit_code}`;
    const prevBest = st.unitBestMap.get(uKey) ?? -1;
    if (pct > prevBest) st.unitBestMap.set(uKey, pct);

    const subj = l.subject || 'その他';
    if (!st.bySubject.has(subj)) {
      st.bySubject.set(subj, { subject: subj, attempts: 0, accSum: 0, units: new Map() });
    }
    const sb = st.bySubject.get(subj);
    sb.attempts += 1;
    sb.accSum += pct;
    const prevSubjBest = sb.units.get(l.unit_code) ?? -1;
    if (pct > prevSubjBest) sb.units.set(l.unit_code, pct);
  });

  return [...map.values()].map((st) => {
    let highScoreUnits = 0;
    st.unitBestMap.forEach((best) => {
      if (best >= 80) highScoreUnits++;
    });
    const subjectStats = [...st.bySubject.values()].map((sb) => {
      let cleared = 0;
      sb.units.forEach((b) => { if (b >= 80) cleared++; });
      return {
        subject: sb.subject,
        attempts: sb.attempts,
        avgAccuracy: Math.round(sb.accSum / sb.attempts),
        attemptedUnits: sb.units.size,
        clearedUnits: cleared,
      };
    });
    return {
      student_key: st.student_key,
      grade: st.grade,
      class_name: st.class_name,
      student_no: st.student_no,
      attempts: st.attempts,
      uniqueUnits: st.unitBestMap.size,
      highScoreUnits,
      avgAccuracy: st.attempts > 0 ? Math.round(st.accSum / st.attempts) : 0,
      lastLoggedAt: st.lastLoggedAt,
      subjectStats,
      logs: st.logs,
    };
  });
}

export function buildUnitAndWrongAnalysis(filteredLogs) {
  const list = Array.isArray(filteredLogs) ? filteredLogs : [];
  const unitMap = new Map();
  const wrongMap = new Map();

  list.forEach((l) => {
    const uKey = `${l.grade}__${l.subject}__${l.unit_code}`;
    if (!unitMap.has(uKey)) {
      unitMap.set(uKey, {
        grade: l.grade || '',
        subject: l.subject || '',
        unit_code: l.unit_code || '',
        unit_name: l.unit_name || l.unit_code || '',
        attempts: 0,
        accSum: 0,
        minAcc: 100,
        maxAcc: 0,
        studentBest: new Map(),
      });
    }
    const u = unitMap.get(uKey);
    const pct = Number(l.accuracy_pct) || 0;
    u.attempts += 1;
    u.accSum += pct;
    if (pct < u.minAcc) u.minAcc = pct;
    if (pct > u.maxAcc) u.maxAcc = pct;
    const stKey = l.student_key || `${l.grade}_${l.class_name}_${l.student_no}`;
    const prevBest = u.studentBest.get(stKey) ?? -1;
    if (pct > prevBest) u.studentBest.set(stKey, pct);

    // wrong_ids 集計
    if (l.wrong_ids) {
      String(l.wrong_ids)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .forEach((pid) => {
          if (!wrongMap.has(pid)) {
            wrongMap.set(pid, {
              problem_id: pid,
              count: 0,
              students: new Set(),
              grade: l.grade || '',
              subject: l.subject || '',
              unit_code: l.unit_code || '',
              unit_name: l.unit_name || '',
            });
          }
          const w = wrongMap.get(pid);
          w.count += 1;
          w.students.add(stKey);
        });
    }
  });

  const unitStats = [...unitMap.values()].map((u) => {
    let passedStudents = 0;
    u.studentBest.forEach((best) => {
      if (best >= 80) passedStudents++;
    });
    return {
      grade: u.grade,
      subject: u.subject,
      unit_code: u.unit_code,
      unit_name: u.unit_name,
      studentCount: u.studentBest.size,
      passedStudents,
      attempts: u.attempts,
      avgAccuracy: Math.round(u.accSum / u.attempts),
      minAccuracy: u.minAcc,
      maxAccuracy: u.maxAcc,
    };
  });

  const wrongRanking = [...wrongMap.values()]
    .map((w) => ({
      problem_id: w.problem_id,
      count: w.count,
      studentCount: w.students.size,
      grade: w.grade,
      subject: w.subject,
      unit_code: w.unit_code,
      unit_name: w.unit_name,
    }))
    .sort((a, b) => b.count - a.count || b.studentCount - a.studentCount || a.problem_id.localeCompare(b.problem_id))
    .slice(0, 15);

  return { unitStats, wrongRanking };
}

// ================= ダッシュボード UI 描画 =================

function formatDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}分${r}秒` : `${r}秒`;
}

function formatFetchedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pctLevelClass(pct) {
  if (pct >= 80) return 'is-high';
  if (pct >= 50) return 'is-mid';
  return 'is-low';
}

function buildProblemIndex(questionsBySheet) {
  const index = new Map();
  Object.values(questionsBySheet || {}).forEach((list) => {
    (list || []).forEach((q) => {
      if (q && q.problem_id) index.set(q.problem_id, q);
    });
  });
  return index;
}

function getUnitsForGradeAndSubject(meta, questionsBySheet, grade, subjectName) {
  const subjects = (meta?.subjects || []).filter((s) => s.is_active !== false);
  const matchedSubj = subjects.find((s) => s.grade === grade && s.subject === subjectName);
  if (!matchedSubj) return [];
  const qs = questionsBySheet?.[matchedSubj.sheet_name] || [];
  const map = new Map();
  qs.forEach((q) => {
    if (!map.has(q.unit_code)) {
      map.set(q.unit_code, {
        unit_code: q.unit_code,
        unit_order: Number(q.unit_order) || 999,
        unit_name: q.unit_name,
      });
    }
  });
  return [...map.values()].sort((a, b) => a.unit_order - b.unit_order);
}

export function renderTeacherDashboardView(container, ctx) {
  const session = getTeacherSession();
  if (!session) {
    ctx.onRequireAuth?.();
    return;
  }
  touchTeacherActivity();

  const allLogs = session.logs || [];
  const metaSubjects = (ctx.meta?.subjects || []).filter((s) => s.is_active !== false);

  // 選択肢をマスタ＋ログから動的生成（将来の複数学年対応）
  const grades = [...new Set([
    ...metaSubjects.map((s) => s.grade),
    ...allLogs.map((l) => l.grade).filter(Boolean),
  ])];
  const classes = [...new Set([
    ...APP_CONFIG.CLASS_OPTIONS,
    ...allLogs.map((l) => l.class_name).filter(Boolean),
  ])].sort((a, b) => classSortRank(a) - classSortRank(b) || a.localeCompare(b, 'ja'));
  const subjectNames = [...new Set([
    ...metaSubjects.map((s) => s.subject),
    ...allLogs.map((l) => l.subject).filter(Boolean),
  ])];

  // フィルタ適用
  const filteredLogs = filterTeacherLogs(allLogs, dashboardState.filters);
  const kpi = computeKpiSummary(filteredLogs);
  const problemIndex = buildProblemIndex(ctx.questionsBySheet);

  // マトリクス対象学年・教科の決定（フィルタが「すべて」のときは実際にログがある最新学年を優先）
  const firstLoggedGrade = filteredLogs.find((l) => l.grade)?.grade || allLogs.find((l) => l.grade)?.grade;
  const effectiveGrade = dashboardState.filters.grade !== 'すべて'
    ? dashboardState.filters.grade
    : (firstLoggedGrade || APP_CONFIG.DEFAULT_GRADE || grades[0]);

  // 対象学年の問題・単元データが未ロードならバックグラウンド読込して再描画
  const effectiveSubjects = metaSubjects.filter((s) => s.grade === effectiveGrade);
  const missingUnits = effectiveSubjects.some((s) => !ctx.questionsBySheet?.[s.sheet_name]);
  if (missingUnits && ctx.ensureGradeLoaded && !dashboardState._loadingGrade?.[effectiveGrade]) {
    dashboardState._loadingGrade = { ...(dashboardState._loadingGrade || {}), [effectiveGrade]: true };
    ctx.ensureGradeLoaded(effectiveGrade).then(() => {
      dashboardState._loadingGrade[effectiveGrade] = false;
      if (getTeacherSession() && container.querySelector('.teacher-view')) {
        renderTeacherDashboardView(container, ctx);
      }
    }).catch(() => {
      dashboardState._loadingGrade[effectiveGrade] = false;
    });
  }

  if (dashboardState.filters.subject !== 'すべて') {
    dashboardState.matrixSubject = dashboardState.filters.subject;
  } else if (!dashboardState.matrixSubject || !subjectNames.includes(dashboardState.matrixSubject)) {
    const firstLoggedSubj = filteredLogs[0]?.subject || allLogs[0]?.subject;
    dashboardState.matrixSubject = (firstLoggedSubj && subjectNames.includes(firstLoggedSubj))
      ? firstLoggedSubj
      : (subjectNames[0] || '国語');
  }

  let tabContentHtml = '';
  if (dashboardState.activeTab === 'matrix') {
    tabContentHtml = renderMatrixTabHtml(filteredLogs, effectiveGrade, subjectNames, ctx);
  } else if (dashboardState.activeTab === 'students') {
    tabContentHtml = renderStudentsTabHtml(filteredLogs);
  } else if (dashboardState.activeTab === 'units') {
    tabContentHtml = renderUnitsTabHtml(filteredLogs, problemIndex);
  } else {
    tabContentHtml = renderLogsTabHtml(filteredLogs);
  }

  container.innerHTML = `
    <div class="teacher-view">
      <div class="teacher-topbar">
        <div class="teacher-title-block">
          <div class="teacher-eyebrow">先生用ダッシュボード</div>
          <h1>
            ${escapeHtml(session.school_label)}
            <span class="teacher-school-code">(${escapeHtml(session.school_code)})</span>
          </h1>
          <p class="teacher-meta-line">
            最終取得：${escapeHtml(formatFetchedAt(session.fetched_at))}
            ／ 全 ${session.total_count} 件${session.truncated ? '（最新5,000件を表示）' : ''}
            ／ 30分無操作で自動ログアウト
          </p>
        </div>
        <div class="teacher-topbar-actions">
          <button type="button" id="td-refresh-btn" class="btn btn-primary btn-sm" ${dashboardState.refreshing ? 'disabled' : ''}>
            ${dashboardState.refreshing ? '更新中...' : '最新に更新'}
          </button>
          <a href="#home" class="btn btn-ghost btn-sm">ドリルへ戻る</a>
          <button type="button" id="td-logout-btn" class="btn btn-danger-outline btn-sm">ログアウト</button>
        </div>
      </div>

      ${dashboardState.statusMsg ? `<div class="td-notice-banner">${escapeHtml(dashboardState.statusMsg)}</div>` : ''}

      <section class="td-filter-card" aria-label="絞り込みフィルタ">
        <div class="td-filter-grid">
          <label class="td-filter-item">
            <span>学年</span>
            <select id="td-filter-grade" class="form-select">
              <option value="すべて">すべて</option>
              ${grades.map((g) => `<option value="${escapeHtml(g)}" ${dashboardState.filters.grade === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
            </select>
          </label>
          <label class="td-filter-item">
            <span>組</span>
            <select id="td-filter-class" class="form-select">
              <option value="すべて">すべて</option>
              ${classes.map((c) => `<option value="${escapeHtml(c)}" ${dashboardState.filters.className === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
          </label>
          <label class="td-filter-item">
            <span>教科</span>
            <select id="td-filter-subject" class="form-select">
              <option value="すべて">すべて</option>
              ${subjectNames.map((s) => `<option value="${escapeHtml(s)}" ${dashboardState.filters.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            </select>
          </label>
          <label class="td-filter-item">
            <span>モード</span>
            <select id="td-filter-mode" class="form-select">
              <option value="すべて" ${dashboardState.filters.mode === 'すべて' ? 'selected' : ''}>すべて</option>
              <option value="unit" ${dashboardState.filters.mode === 'unit' ? 'selected' : ''}>単元演習</option>
              <option value="retry" ${dashboardState.filters.mode === 'retry' ? 'selected' : ''}>苦手復習</option>
              <option value="mock" ${dashboardState.filters.mode === 'mock' ? 'selected' : ''}>模擬テスト</option>
            </select>
          </label>
          <label class="td-filter-item">
            <span>期間</span>
            <select id="td-filter-period" class="form-select">
              <option value="all" ${dashboardState.filters.period === 'all' ? 'selected' : ''}>全期間</option>
              <option value="today" ${dashboardState.filters.period === 'today' ? 'selected' : ''}>今日</option>
              <option value="7d" ${dashboardState.filters.period === '7d' ? 'selected' : ''}>直近7日間</option>
              <option value="30d" ${dashboardState.filters.period === '30d' ? 'selected' : ''}>直近30日間</option>
              <option value="custom" ${dashboardState.filters.period === 'custom' ? 'selected' : ''}>日付指定</option>
            </select>
          </label>
          <label class="td-filter-item">
            <span>出席番号</span>
            <input type="text" id="td-filter-no" class="form-input td-no-input" inputmode="numeric" placeholder="例: 16" value="${escapeHtml(dashboardState.filters.studentNo)}">
          </label>
        </div>
        ${dashboardState.filters.period === 'custom' ? `
          <div class="td-custom-dates">
            <label>開始日 <input type="date" id="td-date-from" class="form-input" value="${escapeHtml(dashboardState.filters.dateFrom)}"></label>
            <span>〜</span>
            <label>終了日 <input type="date" id="td-date-to" class="form-input" value="${escapeHtml(dashboardState.filters.dateTo)}"></label>
          </div>
        ` : ''}
      </section>

      <section class="td-kpi-grid" aria-label="集計サマリー">
        <div class="td-kpi-card">
          <div class="td-kpi-label">取組児童数</div>
          <div class="td-kpi-value"><strong>${kpi.uniqueStudents}</strong><span>人</span></div>
          <div class="td-kpi-sub">絞り込み条件内のユニーク人数</div>
        </div>
        <div class="td-kpi-card">
          <div class="td-kpi-label">延べ演習回数</div>
          <div class="td-kpi-value"><strong>${kpi.totalAttempts}</strong><span>回</span></div>
          <div class="td-kpi-sub">うち本日：${kpi.todayAttempts} 回</div>
        </div>
        <div class="td-kpi-card">
          <div class="td-kpi-label">平均正答率</div>
          <div class="td-kpi-value"><strong>${kpi.avgAccuracy}</strong><span>%</span></div>
          <div class="td-kpi-sub">対象ログ全体の平均</div>
        </div>
        <div class="td-kpi-card">
          <div class="td-kpi-label">80%以上達成率</div>
          <div class="td-kpi-value"><strong>${kpi.passRate}</strong><span>%</span></div>
          <div class="td-kpi-sub">${kpi.passCount} / ${kpi.totalAttempts} 回が「よくできた」</div>
        </div>
      </section>

      <nav class="td-tabs" role="tablist" aria-label="表示切替タブ">
        <button type="button" class="td-tab ${dashboardState.activeTab === 'matrix' ? 'is-active' : ''}" data-td-tab="matrix" role="tab">進捗マトリクス</button>
        <button type="button" class="td-tab ${dashboardState.activeTab === 'students' ? 'is-active' : ''}" data-td-tab="students" role="tab">児童別一覧</button>
        <button type="button" class="td-tab ${dashboardState.activeTab === 'units' ? 'is-active' : ''}" data-td-tab="units" role="tab">単元・誤答分析</button>
        <button type="button" class="td-tab ${dashboardState.activeTab === 'logs' ? 'is-active' : ''}" data-td-tab="logs" role="tab">実施ログ一覧</button>
      </nav>

      <section class="td-panel">
        ${tabContentHtml}
      </section>
    </div>
  `;

  bindTeacherDashboardEvents(container, ctx, filteredLogs, effectiveGrade, problemIndex);
}

function renderMatrixTabHtml(filteredLogs, effectiveGrade, subjectNames, ctx) {
  const targetSubject = dashboardState.matrixSubject;
  const units = getUnitsForGradeAndSubject(ctx.meta, ctx.questionsBySheet, effectiveGrade, targetSubject);
  const subjectLogs = filteredLogs.filter(
    (l) => (!l.subject || l.subject === targetSubject) && (!l.grade || l.grade === effectiveGrade)
  );
  const matrix = buildProgressMatrix(subjectLogs, units, {
    showAllNumbers: dashboardState.matrixShowAllNumbers,
    maxNo: 40,
    classFilter: dashboardState.filters.className,
    gradeFilter: effectiveGrade,
  });

  const subjectChipsHtml = subjectNames.map((s) => {
    const active = s === targetSubject ? 'is-active' : '';
    const color = SUBJECT_COLOR_FALLBACK[s] || '#2563EB';
    return `<button type="button" class="td-subj-chip ${active}" data-matrix-subj="${escapeHtml(s)}" style="--chip-color:${color}">${escapeHtml(s)}</button>`;
  }).join('');

  if (matrix.columns.length === 0) {
    return `
      <div class="td-matrix-toolbar">
        <div class="td-subj-chips">${subjectChipsHtml}</div>
      </div>
      <div class="td-empty-state">「${escapeHtml(effectiveGrade)} ${escapeHtml(targetSubject)}」の単元データが見つかりません。</div>
    `;
  }

  const headerColsHtml = matrix.columns.map((c, idx) => `
    <th class="td-matrix-th" title="${escapeHtml(c.unit_name)} (${escapeHtml(c.unit_code)})">
      <div class="td-unit-th-num">${c.unit_code === 'MOCK' ? '模試' : idx + 1}</div>
      <div class="td-unit-th-name">${escapeHtml(c.unit_name)}</div>
    </th>
  `).join('');

  const bodyRowsHtml = matrix.rows.length === 0
    ? `<tr><td colspan="${matrix.columns.length + 2}" class="td-empty-cell">該当する取組記録はまだありません。「1〜40番をすべて表示」をオンにすると名簿枠を確認できます。</td></tr>`
    : matrix.rows.map((r) => {
      const cellsHtml = matrix.columns.map((c) => {
        const cell = r.cells[c.unit_code];
        if (!cell) {
          return `<td class="td-mcell is-empty" title="${escapeHtml(r.class_name)} ${r.student_no}番 / ${escapeHtml(c.unit_name)}：未取組">—</td>`;
        }
        const cls = pctLevelClass(cell.bestPct);
        return `
          <td class="td-mcell ${cls}">
            <button type="button" class="td-mcell-btn" data-cell-row="${escapeHtml(r.rowId)}" data-cell-unit="${escapeHtml(c.unit_code)}" title="${escapeHtml(r.class_name)} ${r.student_no}番 / ${escapeHtml(c.unit_name)}：最高${cell.bestPct}% (${cell.attempts}回)">
              <span class="td-mcell-pct">${cell.bestPct}%</span>
              <span class="td-mcell-sub">${cell.attempts}回${cell.hasSelfCheck ? '・自' : ''}</span>
            </button>
          </td>
        `;
      }).join('');

      return `
        <tr>
          <th class="td-sticky-col td-student-col">
            <span class="td-st-cls">${escapeHtml(r.grade)} ${escapeHtml(r.class_name)}</span>
            <strong>${r.student_no}番</strong>
          </th>
          <td class="td-progress-col">
            <span class="td-prog-badge">${r.clearedUnits}/${matrix.columns.length}</span>
          </td>
          ${cellsHtml}
        </tr>
      `;
    }).join('');

  return `
    <div class="td-matrix-toolbar">
      <div class="td-subj-chips" aria-label="マトリクス対象教科">${subjectChipsHtml}</div>
      <label class="td-toggle-pill">
        <input type="checkbox" id="td-matrix-all-toggle" ${dashboardState.matrixShowAllNumbers ? 'checked' : ''}>
        <span>1〜40番をすべて表示（未取組も表示）</span>
      </label>
    </div>
    <div class="td-legend-row">
      <span class="td-legend-item"><i class="td-dot is-high"></i>80%以上（よくできた）</span>
      <span class="td-legend-item"><i class="td-dot is-mid"></i>50〜79%（あとすこし）</span>
      <span class="td-legend-item"><i class="td-dot is-low"></i>50%未満（要復習）</span>
      <span class="td-legend-item"><i class="td-dot is-empty"></i>未取組</span>
      <span class="td-legend-hint">※ 各セルをクリックすると詳細な実施履歴を確認できます</span>
    </div>
    <div class="td-matrix-scroll">
      <table class="td-matrix-table">
        <thead>
          <tr>
            <th class="td-sticky-col td-corner-col">組・番号</th>
            <th class="td-progress-th">80%達成</th>
            ${headerColsHtml}
          </tr>
        </thead>
        <tbody>
          ${bodyRowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

function renderStudentsTabHtml(filteredLogs) {
  const list = buildStudentSummaries(filteredLogs);
  if (list.length === 0) {
    return `<div class="td-empty-state">条件に一致する児童の取組記録はまだありません。</div>`;
  }

  const sort = dashboardState.studentSort;
  list.sort((a, b) => {
    if (sort === 'acc_desc') return b.avgAccuracy - a.avgAccuracy || b.attempts - a.attempts;
    if (sort === 'acc_asc') return a.avgAccuracy - b.avgAccuracy || b.attempts - a.attempts;
    if (sort === 'attempts_desc') return b.attempts - a.attempts || b.avgAccuracy - a.avgAccuracy;
    if (sort === 'recent_desc') return a.lastLoggedAt < b.lastLoggedAt ? 1 : a.lastLoggedAt > b.lastLoggedAt ? -1 : 0;
    // default no_asc
    if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, 'ja');
    const cr = classSortRank(a.class_name) - classSortRank(b.class_name);
    if (cr !== 0) return cr;
    return a.student_no - b.student_no;
  });

  const rowsHtml = list.map((st) => {
    const subjBadges = st.subjectStats.map((sb) => `
      <span class="td-mini-subj" style="--chip-color:${SUBJECT_COLOR_FALLBACK[sb.subject] || '#475569'}">
        ${escapeHtml(sb.subject)} ${sb.avgAccuracy}%
      </span>
    `).join('');

    return `
      <tr class="td-clickable-row" data-student-key="${escapeHtml(st.student_key)}">
        <td><strong>${escapeHtml(st.grade)} ${escapeHtml(st.class_name)} ${st.student_no}番</strong></td>
        <td class="td-num">${st.uniqueUnits} 単元 <small>（80%↑ ${st.highScoreUnits}）</small></td>
        <td class="td-num">${st.attempts} 回</td>
        <td class="td-num"><span class="td-score-pill ${pctLevelClass(st.avgAccuracy)}">${st.avgAccuracy}%</span></td>
        <td><div class="td-mini-subj-list">${subjBadges}</div></td>
        <td class="td-date-col">${escapeHtml(st.lastLoggedAt)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-student-key="${escapeHtml(st.student_key)}">カルテ</button></td>
      </tr>
    `;
  }).join('');

  return `
    <div class="td-subbar">
      <span class="td-subbar-count">${list.length} 人の記録</span>
      <label class="td-sort-label">
        並び替え
        <select id="td-student-sort" class="form-select">
          <option value="no_asc" ${sort === 'no_asc' ? 'selected' : ''}>組・出席番号順</option>
          <option value="acc_desc" ${sort === 'acc_desc' ? 'selected' : ''}>平均正答率が高い順</option>
          <option value="acc_asc" ${sort === 'acc_asc' ? 'selected' : ''}>平均正答率が低い順</option>
          <option value="attempts_desc" ${sort === 'attempts_desc' ? 'selected' : ''}>取組回数が多い順</option>
          <option value="recent_desc" ${sort === 'recent_desc' ? 'selected' : ''}>最終取組が新しい順</option>
        </select>
      </label>
    </div>
    <div class="td-table-wrap">
      <table class="td-data-table">
        <thead>
          <tr>
            <th>学年・組・番号</th>
            <th>取組単元数</th>
            <th>延べ回数</th>
            <th>平均正答率</th>
            <th>教科別平均</th>
            <th>最終取組日時</th>
            <th>詳細</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function renderUnitsTabHtml(filteredLogs, problemIndex) {
  const { unitStats, wrongRanking } = buildUnitAndWrongAnalysis(filteredLogs);
  if (unitStats.length === 0) {
    return `<div class="td-empty-state">条件に一致する単元・誤答データはまだありません。</div>`;
  }

  const sort = dashboardState.unitSort;
  unitStats.sort((a, b) => {
    if (sort === 'students_desc') return b.studentCount - a.studentCount || a.avgAccuracy - b.avgAccuracy;
    if (sort === 'attempts_desc') return b.attempts - a.attempts || a.avgAccuracy - b.avgAccuracy;
    if (sort === 'order_asc') return a.subject.localeCompare(b.subject, 'ja') || a.unit_code.localeCompare(b.unit_code);
    return a.avgAccuracy - b.avgAccuracy || b.attempts - a.attempts;
  });

  const wrongHtml = wrongRanking.length === 0
    ? `<p class="td-muted-note">現在の条件では誤答問題（wrong_ids）は記録されていません。</p>`
    : `
      <div class="td-wrong-list">
        ${wrongRanking.map((w, i) => {
          const prob = problemIndex.get(w.problem_id);
          const snippet = prob ? stripRichMarkup(prob.question_text).slice(0, 64) : '';
          return `
            <div class="td-wrong-item">
              <span class="td-wrong-rank">${i + 1}</span>
              <div class="td-wrong-main">
                <div class="td-wrong-head">
                  <span class="td-mini-subj" style="--chip-color:${SUBJECT_COLOR_FALLBACK[w.subject] || '#475569'}">${escapeHtml(w.subject || '-')}</span>
                  <strong>${escapeHtml(w.unit_name || w.unit_code)}</strong>
                  <code class="td-pid-code">${escapeHtml(w.problem_id)}</code>
                </div>
                ${snippet ? `<p class="td-wrong-snippet">${escapeHtml(snippet)}${snippet.length >= 64 ? '…' : ''}</p>` : ''}
              </div>
              <div class="td-wrong-stats">
                <span class="td-wrong-count">${w.count}回誤答</span>
                <small>（${w.studentCount}人）</small>
              </div>
              <button type="button" class="btn btn-primary btn-sm" data-preview-pid="${escapeHtml(w.problem_id)}" data-preview-grade="${escapeHtml(w.grade)}">問題と解説</button>
            </div>
          `;
        }).join('')}
      </div>
    `;

  const unitRowsHtml = unitStats.map((u) => `
    <tr>
      <td>${escapeHtml(u.grade)}</td>
      <td><span class="td-mini-subj" style="--chip-color:${SUBJECT_COLOR_FALLBACK[u.subject] || '#475569'}">${escapeHtml(u.subject)}</span></td>
      <td><strong>${escapeHtml(u.unit_name)}</strong> <small class="td-code-muted">${escapeHtml(u.unit_code)}</small></td>
      <td class="td-num">${u.studentCount} 人</td>
      <td class="td-num">${u.passedStudents} 人</td>
      <td class="td-num">${u.attempts} 回</td>
      <td class="td-num"><span class="td-score-pill ${pctLevelClass(u.avgAccuracy)}">${u.avgAccuracy}%</span></td>
      <td class="td-num">${u.minAccuracy}% 〜 ${u.maxAccuracy}%</td>
    </tr>
  `).join('');

  return `
    <div class="td-section-block">
      <div class="td-section-head">
        <h3>つまずきが多い問題ランキング（誤答数 TOP）</h3>
        <span class="td-section-note">「問題と解説」を押すと、実際の設問文・図版・解説をプレビューできます</span>
      </div>
      ${wrongHtml}
    </div>

    <div class="td-section-block">
      <div class="td-subbar">
        <h3>単元別 実施状況（${unitStats.length} 単元）</h3>
        <label class="td-sort-label">
          並び替え
          <select id="td-unit-sort" class="form-select">
            <option value="acc_asc" ${sort === 'acc_asc' ? 'selected' : ''}>平均正答率が低い順（要指導）</option>
            <option value="students_desc" ${sort === 'students_desc' ? 'selected' : ''}>取組人数が多い順</option>
            <option value="attempts_desc" ${sort === 'attempts_desc' ? 'selected' : ''}>延べ回数が多い順</option>
            <option value="order_asc" ${sort === 'order_asc' ? 'selected' : ''}>教科・コード順</option>
          </select>
        </label>
      </div>
      <div class="td-table-wrap">
        <table class="td-data-table">
          <thead>
            <tr>
              <th>学年</th>
              <th>教科</th>
              <th>単元</th>
              <th>取組人数</th>
              <th>80%達成</th>
              <th>延べ回数</th>
              <th>平均正答率</th>
              <th>範囲</th>
            </tr>
          </thead>
          <tbody>${unitRowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderLogsTabHtml(filteredLogs) {
  if (filteredLogs.length === 0) {
    return `<div class="td-empty-state">条件に一致する実施ログはまだありません。</div>`;
  }
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / LOGS_PER_PAGE));
  if (dashboardState.logPage > totalPages) dashboardState.logPage = totalPages;
  const start = (dashboardState.logPage - 1) * LOGS_PER_PAGE;
  const pageItems = filteredLogs.slice(start, start + LOGS_PER_PAGE);

  const rowsHtml = pageItems.map((l) => {
    const wrongList = String(l.wrong_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    const wrongBtns = wrongList.length === 0
      ? '<span class="td-muted-dash">—</span>'
      : wrongList.slice(0, 4).map((pid) => `<button type="button" class="td-pid-btn" data-preview-pid="${escapeHtml(pid)}" data-preview-grade="${escapeHtml(l.grade)}">${escapeHtml(pid)}</button>`).join('')
        + (wrongList.length > 4 ? `<span class="td-more-wrong">+${wrongList.length - 4}問</span>` : '');

    return `
      <tr>
        <td class="td-date-col">${escapeHtml(l.logged_at)}</td>
        <td>${escapeHtml(l.grade)} ${escapeHtml(l.class_name)} <strong>${l.student_no}番</strong></td>
        <td><span class="td-mini-subj" style="--chip-color:${SUBJECT_COLOR_FALLBACK[l.subject] || '#475569'}">${escapeHtml(l.subject)}</span></td>
        <td>${escapeHtml(l.unit_name || l.unit_code)}</td>
        <td><span class="td-mode-badge">${escapeHtml(MODE_LABELS[l.mode] || l.mode)}</span></td>
        <td class="td-num">${l.score}/${l.total} <span class="td-score-pill ${pctLevelClass(l.accuracy_pct)}">${l.accuracy_pct}%</span></td>
        <td class="td-num">${l.self_check_count > 0 ? `${l.self_check_count}問` : '—'}</td>
        <td class="td-num">${formatDuration(l.duration_sec)}</td>
        <td><div class="td-wrong-chips">${wrongBtns}</div></td>
      </tr>
    `;
  }).join('');

  return `
    <div class="td-subbar">
      <span class="td-subbar-count">${filteredLogs.length} 件中 ${start + 1}〜${start + pageItems.length} 件を表示</span>
      <div class="td-pager">
        <button type="button" class="btn btn-ghost btn-sm" id="td-page-prev" ${dashboardState.logPage <= 1 ? 'disabled' : ''}>← 前へ</button>
        <span>${dashboardState.logPage} / ${totalPages}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="td-page-next" ${dashboardState.logPage >= totalPages ? 'disabled' : ''}>次へ →</button>
      </div>
    </div>
    <div class="td-table-wrap">
      <table class="td-data-table">
        <thead>
          <tr>
            <th>日時</th>
            <th>児童</th>
            <th>教科</th>
            <th>単元</th>
            <th>モード</th>
            <th>得点・正答率</th>
            <th>自己採点</th>
            <th>時間</th>
            <th>誤答問題（クリックで表示）</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

// ================= イベントバインド・詳細モーダル =================

function bindTeacherDashboardEvents(container, ctx, filteredLogs, effectiveGrade, problemIndex) {
  const rerender = () => renderTeacherDashboardView(container, ctx);

  // 最新に更新
  container.querySelector('#td-refresh-btn')?.addEventListener('click', async () => {
    dashboardState.refreshing = true;
    dashboardState.statusMsg = '';
    rerender();
    const res = await refreshTeacherLogs();
    dashboardState.refreshing = false;
    if (!res.ok) {
      if (res.code === 'TOKEN_EXPIRED') {
        ctx.onRequireAuth?.(res.message);
        return;
      }
      dashboardState.statusMsg = res.message;
    } else {
      dashboardState.statusMsg = '最新の取組状況を読み込みました。';
    }
    rerender();
  });

  // ログアウト
  container.querySelector('#td-logout-btn')?.addEventListener('click', async () => {
    await logoutTeacher();
    ctx.onExitToHome?.();
  });

  // フィルタ変更
  container.querySelector('#td-filter-grade')?.addEventListener('change', async (e) => {
    dashboardState.filters.grade = e.target.value;
    dashboardState.logPage = 1;
    if (e.target.value !== 'すべて' && ctx.ensureGradeLoaded) {
      await ctx.ensureGradeLoaded(e.target.value);
    }
    rerender();
  });
  container.querySelector('#td-filter-class')?.addEventListener('change', (e) => {
    dashboardState.filters.className = e.target.value;
    dashboardState.logPage = 1;
    rerender();
  });
  container.querySelector('#td-filter-subject')?.addEventListener('change', (e) => {
    dashboardState.filters.subject = e.target.value;
    if (e.target.value !== 'すべて') dashboardState.matrixSubject = e.target.value;
    dashboardState.logPage = 1;
    rerender();
  });
  container.querySelector('#td-filter-mode')?.addEventListener('change', (e) => {
    dashboardState.filters.mode = e.target.value;
    dashboardState.logPage = 1;
    rerender();
  });
  container.querySelector('#td-filter-period')?.addEventListener('change', (e) => {
    dashboardState.filters.period = e.target.value;
    dashboardState.logPage = 1;
    rerender();
  });
  container.querySelector('#td-date-from')?.addEventListener('change', (e) => {
    dashboardState.filters.dateFrom = e.target.value;
    dashboardState.logPage = 1;
    rerender();
  });
  container.querySelector('#td-date-to')?.addEventListener('change', (e) => {
    dashboardState.filters.dateTo = e.target.value;
    dashboardState.logPage = 1;
    rerender();
  });
  container.querySelector('#td-filter-no')?.addEventListener('input', (e) => {
    dashboardState.filters.studentNo = e.target.value;
    dashboardState.logPage = 1;
    rerender();
    // フォーカス復元
    const input = container.querySelector('#td-filter-no');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });

  // タブ切替
  container.querySelectorAll('[data-td-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashboardState.activeTab = btn.dataset.tdTab;
      dashboardState.statusMsg = '';
      rerender();
    });
  });

  // マトリクス：教科チップ＆1〜40番トグル＆セルクリック
  container.querySelectorAll('[data-matrix-subj]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dashboardState.matrixSubject = btn.dataset.matrixSubj;
      if (dashboardState.filters.subject !== 'すべて') {
        dashboardState.filters.subject = btn.dataset.matrixSubj;
      }
      rerender();
    });
  });
  container.querySelector('#td-matrix-all-toggle')?.addEventListener('change', (e) => {
    dashboardState.matrixShowAllNumbers = e.target.checked;
    rerender();
  });
  container.querySelectorAll('[data-cell-row][data-cell-unit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rowId = btn.dataset.cellRow;
      const unitCode = btn.dataset.cellUnit;
      const targetSubject = dashboardState.matrixSubject;
      const cellLogs = filteredLogs.filter((l) => {
        const id = `${l.grade || ''}__${l.class_name || '未設定'}__${Number(l.student_no) || 0}`;
        return id === rowId && l.unit_code === unitCode && (!l.subject || l.subject === targetSubject);
      });
      openCellHistoryModal(cellLogs, ctx, problemIndex);
    });
  });

  // 児童別ソート＆カルテ開く
  container.querySelector('#td-student-sort')?.addEventListener('change', (e) => {
    dashboardState.studentSort = e.target.value;
    rerender();
  });
  container.querySelectorAll('[data-student-key]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.dataset.studentKey;
      const summary = buildStudentSummaries(filteredLogs).find((s) => s.student_key === key);
      if (summary) openStudentDetailModal(summary, ctx, problemIndex);
    });
  });

  // 単元ソート
  container.querySelector('#td-unit-sort')?.addEventListener('change', (e) => {
    dashboardState.unitSort = e.target.value;
    rerender();
  });

  // ページャ
  container.querySelector('#td-page-prev')?.addEventListener('click', () => {
    if (dashboardState.logPage > 1) {
      dashboardState.logPage--;
      rerender();
    }
  });
  container.querySelector('#td-page-next')?.addEventListener('click', () => {
    dashboardState.logPage++;
    rerender();
  });

  // 誤答問題プレビューボタン
  container.querySelectorAll('[data-preview-pid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.previewPid;
      const grade = btn.dataset.previewGrade || effectiveGrade;
      await openProblemPreviewModal(pid, grade, ctx);
    });
  });
}

function openCellHistoryModal(cellLogs, ctx, problemIndex) {
  if (!cellLogs.length) return;
  const first = cellLogs[0];
  const modal = document.getElementById('teacher-detail-modal');
  const titleEl = document.getElementById('teacher-detail-title');
  const bodyEl = document.getElementById('teacher-detail-body');
  if (!modal || !titleEl || !bodyEl) return;

  titleEl.textContent = `${first.grade} ${first.class_name} ${first.student_no}番 — ${first.unit_name || first.unit_code}`;
  bodyEl.innerHTML = `
    <p class="td-detail-summary">教科：<strong>${escapeHtml(first.subject)}</strong> ／ 取組回数：<strong>${cellLogs.length} 回</strong></p>
    <div class="td-table-wrap">
      <table class="td-data-table">
        <thead>
          <tr><th>日時</th><th>モード</th><th>得点</th><th>正答率</th><th>自己採点</th><th>時間</th><th>誤答問題</th></tr>
        </thead>
        <tbody>
          ${cellLogs.map((l) => {
            const wrongs = String(l.wrong_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
            return `
              <tr>
                <td class="td-date-col">${escapeHtml(l.logged_at)}</td>
                <td><span class="td-mode-badge">${escapeHtml(MODE_LABELS[l.mode] || l.mode)}</span></td>
                <td class="td-num">${l.score} / ${l.total}</td>
                <td class="td-num"><span class="td-score-pill ${pctLevelClass(l.accuracy_pct)}">${l.accuracy_pct}%</span></td>
                <td class="td-num">${l.self_check_count > 0 ? `${l.self_check_count}問` : '—'}</td>
                <td class="td-num">${formatDuration(l.duration_sec)}</td>
                <td>
                  <div class="td-wrong-chips">
                    ${wrongs.length === 0 ? '—' : wrongs.map((pid) => `<button type="button" class="td-pid-btn" data-modal-pid="${escapeHtml(pid)}" data-modal-grade="${escapeHtml(l.grade)}">${escapeHtml(pid)}</button>`).join('')}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  bodyEl.querySelectorAll('[data-modal-pid]').forEach((btn) => {
    btn.addEventListener('click', () => openProblemPreviewModal(btn.dataset.modalPid, btn.dataset.modalGrade, ctx));
  });
  modal.classList.remove('hidden');
}

function openStudentDetailModal(summary, ctx, problemIndex) {
  const modal = document.getElementById('teacher-detail-modal');
  const titleEl = document.getElementById('teacher-detail-title');
  const bodyEl = document.getElementById('teacher-detail-body');
  if (!modal || !titleEl || !bodyEl) return;

  titleEl.textContent = `児童カルテ：${summary.grade} ${summary.class_name} ${summary.student_no}番`;

  const subjCards = summary.subjectStats.map((sb) => `
    <div class="td-karte-subj">
      <div class="td-karte-subj-head">
        <span class="td-mini-subj" style="--chip-color:${SUBJECT_COLOR_FALLBACK[sb.subject] || '#475569'}">${escapeHtml(sb.subject)}</span>
        <strong>平均 ${sb.avgAccuracy}%</strong>
      </div>
      <div class="td-karte-bar"><span style="width:${sb.avgAccuracy}%;background:${SUBJECT_COLOR_FALLBACK[sb.subject] || '#2563EB'}"></span></div>
      <div class="td-karte-subj-meta">取組 ${sb.attemptedUnits} 単元（80%↑ ${sb.clearedUnits}）／ ${sb.attempts} 回</div>
    </div>
  `).join('');

  bodyEl.innerHTML = `
    <div class="td-karte-kpis">
      <div><span>取組単元</span><strong>${summary.uniqueUnits} 単元</strong></div>
      <div><span>80%以上達成</span><strong>${summary.highScoreUnits} 単元</strong></div>
      <div><span>延べ回数</span><strong>${summary.attempts} 回</strong></div>
      <div><span>平均正答率</span><strong>${summary.avgAccuracy}%</strong></div>
    </div>
    <h3 class="td-detail-heading">教科別の状況</h3>
    <div class="td-karte-subj-grid">${subjCards}</div>
    <h3 class="td-detail-heading">直近の取組履歴（最新20件）</h3>
    <div class="td-table-wrap">
      <table class="td-data-table">
        <thead>
          <tr><th>日時</th><th>教科</th><th>単元</th><th>正答率</th><th>誤答問題</th></tr>
        </thead>
        <tbody>
          ${summary.logs.slice(0, 20).map((l) => {
            const wrongs = String(l.wrong_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
            return `
              <tr>
                <td class="td-date-col">${escapeHtml(l.logged_at)}</td>
                <td>${escapeHtml(l.subject)}</td>
                <td>${escapeHtml(l.unit_name || l.unit_code)}</td>
                <td class="td-num"><span class="td-score-pill ${pctLevelClass(l.accuracy_pct)}">${l.accuracy_pct}%</span> (${l.score}/${l.total})</td>
                <td>
                  <div class="td-wrong-chips">
                    ${wrongs.length === 0 ? '—' : wrongs.map((pid) => `<button type="button" class="td-pid-btn" data-modal-pid="${escapeHtml(pid)}" data-modal-grade="${escapeHtml(l.grade)}">${escapeHtml(pid)}</button>`).join('')}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  bodyEl.querySelectorAll('[data-modal-pid]').forEach((btn) => {
    btn.addEventListener('click', () => openProblemPreviewModal(btn.dataset.modalPid, btn.dataset.modalGrade, ctx));
  });
  modal.classList.remove('hidden');
}

async function openProblemPreviewModal(problemId, grade, ctx) {
  let index = buildProblemIndex(ctx.questionsBySheet);
  let prob = index.get(problemId);

  if (!prob && grade && ctx.ensureGradeLoaded) {
    await ctx.ensureGradeLoaded(grade);
    index = buildProblemIndex(ctx.questionsBySheet);
    prob = index.get(problemId);
  }

  const modal = document.getElementById('teacher-detail-modal');
  const titleEl = document.getElementById('teacher-detail-title');
  const bodyEl = document.getElementById('teacher-detail-body');
  if (!modal || !titleEl || !bodyEl) return;

  if (!prob) {
    titleEl.textContent = `問題プレビュー：${problemId}`;
    bodyEl.innerHTML = `<p class="td-empty-state">問題ID「${escapeHtml(problemId)}」のデータが見つかりませんでした（削除または非公開になった可能性があります）。</p>`;
    modal.classList.remove('hidden');
    return;
  }

  titleEl.textContent = `問題プレビュー：${prob.unit_name}（${prob.problem_id}）`;
  const imgs = String(prob.image_path || '').split('|').map((s) => s.trim()).filter(Boolean);
  const expImgs = String(prob.explanation_image || '').split('|').map((s) => s.trim()).filter(Boolean);
  const choicesList = String(prob.choices || '').split('|').map((s) => s.trim()).filter(Boolean);

  bodyEl.innerHTML = `
    <div class="td-prob-meta">
      <span class="badge">${escapeHtml(prob.source_type || '')}</span>
      <span class="badge">${escapeHtml(prob.difficulty || '')}</span>
      <code class="td-pid-code">${escapeHtml(prob.problem_id)}</code>
    </div>
    ${prob.context_text ? `
      <details class="td-prob-context" open>
        <summary>共通文・資料</summary>
        <div class="td-prob-context-body">${renderRichText(prob.context_text)}</div>
      </details>
    ` : ''}
    <div class="td-prob-box">
      <div class="guide-label">設問</div>
      <div class="td-prob-text">${renderRichText(prob.question_text)}</div>
      ${imgs.length ? `<div class="td-prob-imgs">${imgs.map((src) => `<img src="${escapeHtml(src)}" alt="問題図版" class="guide-figure zoomable-img">`).join('')}</div>` : ''}
      ${choicesList.length ? `
        <div class="td-prob-choices">
          <div class="td-sub-label">選択肢・語群</div>
          <div class="td-choice-tags">${choicesList.map((c) => `<span>${renderRichText(c)}</span>`).join('')}</div>
        </div>
      ` : ''}
    </div>
    <div class="td-prob-answer-box">
      <div class="guide-label">正答・模範解答</div>
      <div class="td-prob-answer">${renderRichText(String(prob.answer || '').replace(/\|/g, ' ／ '))}${prob.unit_label ? ` <span class="td-unit-lbl">${escapeHtml(prob.unit_label)}</span>` : ''}</div>
      ${prob.explanation ? `
        <div class="td-prob-exp">
          <strong>ワンポイント解説：</strong>
          <div>${renderRichText(prob.explanation)}</div>
        </div>
      ` : ''}
      ${expImgs.length ? `<div class="td-prob-imgs">${expImgs.map((src) => `<img src="${escapeHtml(src)}" alt="解説図版" class="guide-figure zoomable-img">`).join('')}</div>` : ''}
    </div>
  `;

  bodyEl.querySelectorAll('.zoomable-img').forEach((img) => {
    img.addEventListener('click', () => ctx.onOpenLightbox?.(img.src, img.alt));
  });
  modal.classList.remove('hidden');
}

function stripRichMarkup(text) {
  return String(text || '')
    .replace(/\{([^|{}]+)\|[^|{}]+\}/g, '$1')
    .replace(/\{frac:([^}]+)\}/g, '$1')
    .replace(/\{mixed:([^,]+),([^}]+)\}/g, '$1と$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
