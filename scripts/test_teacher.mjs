#!/usr/bin/env node
/**
 * 先生用ダッシュボード集計ロジック (js/teacher.js) および GAS (gas/Code.gs) ロジック単体テスト
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  extractDateYmd,
  filterTeacherLogs,
  computeKpiSummary,
  buildProgressMatrix,
  buildStudentSummaries,
  buildUnitAndWrongAnalysis,
} from '../js/teacher.js';

// ================= 1. js/teacher.js 集計テスト =================

const sampleLogs = [
  {
    logged_at: '2026-11-25 10:15:00',
    school_code: 'hino',
    grade: '4年',
    class_name: '1組',
    student_no: 16,
    student_key: 'hino_4年_1組_16',
    subject: '国語',
    unit_code: 'P5JA1_007',
    unit_name: 'ことわざ',
    mode: 'unit',
    score: 10,
    total: 12,
    accuracy_pct: 83,
    self_check_count: 0,
    wrong_ids: '4JA_007_D_01,4JA_007_D_03',
    duration_sec: 120,
  },
  {
    logged_at: '2026-11-25 09:00:00',
    school_code: 'hino',
    grade: '4年',
    class_name: '1組',
    student_no: 16,
    student_key: 'hino_4年_1組_16',
    subject: '国語',
    unit_code: 'P5JA1_007',
    unit_name: 'ことわざ',
    mode: 'unit',
    score: 6,
    total: 12,
    accuracy_pct: 50,
    self_check_count: 0,
    wrong_ids: '4JA_007_D_01',
    duration_sec: 150,
  },
  {
    logged_at: '2026-11-20 14:30:00',
    school_code: 'hino',
    grade: '4年',
    class_name: '2組',
    student_no: 5,
    student_key: 'hino_4年_2組_05',
    subject: '算数',
    unit_code: 'P5MA1_005',
    unit_name: 'わり算',
    mode: 'unit',
    score: 4,
    total: 10,
    accuracy_pct: 40,
    self_check_count: 1,
    wrong_ids: '4MA_005_D_01,4MA_005_D_02',
    duration_sec: 210,
  },
  {
    logged_at: '2026-11-01 08:40:00',
    school_code: 'hino',
    grade: '4年',
    class_name: '1組',
    student_no: 3,
    student_key: 'hino_4年_1組_03',
    subject: '国語',
    unit_code: 'MOCK',
    unit_name: '国語 模擬テスト',
    mode: 'mock',
    score: 9,
    total: 10,
    accuracy_pct: 90,
    self_check_count: 0,
    wrong_ids: '4JA_007_D_01',
    duration_sec: 180,
  },
];

const now = new Date('2026-11-25T12:00:00');

assert.equal(extractDateYmd('2026-11-25 10:15:00'), '2026-11-25');
assert.equal(filterTeacherLogs(sampleLogs, { period: 'today' }, now).length, 2);
assert.equal(filterTeacherLogs(sampleLogs, { period: '7d' }, now).length, 3);
assert.equal(filterTeacherLogs(sampleLogs, { className: '2組' }, now).length, 1);
assert.equal(filterTeacherLogs(sampleLogs, { studentNo: '16' }, now).length, 2);
assert.equal(filterTeacherLogs(sampleLogs, { mode: 'mock' }, now).length, 1);

const kpi = computeKpiSummary(sampleLogs, now);
assert.equal(kpi.uniqueStudents, 3);
assert.equal(kpi.totalAttempts, 4);
assert.equal(kpi.todayAttempts, 2);
assert.equal(kpi.avgAccuracy, 66);
assert.equal(kpi.passRate, 50);

// マトリクス：通常モード（ログのある児童のみ）
const kokugoUnits = [
  { unit_code: 'P5JA1_001', unit_order: 1, unit_name: '漢字を読む' },
  { unit_code: 'P5JA1_007', unit_order: 6, unit_name: 'ことわざ' },
];
const kokugoLogs = sampleLogs.filter((l) => l.subject === '国語');
const mNormal = buildProgressMatrix(kokugoLogs, kokugoUnits, { showAllNumbers: false });
assert.equal(mNormal.rows.length, 2); // 1組 3番, 1組 16番
assert.equal(mNormal.columns.length, 3); // 2単元 + MOCK自動追加
assert.equal(mNormal.rows[1].student_no, 16);
assert.equal(mNormal.rows[1].cells['P5JA1_007'].bestPct, 83);
assert.equal(mNormal.rows[1].cells['P5JA1_007'].attempts, 2);

// マトリクス：1〜40番全員表示トグルON
const mAll = buildProgressMatrix(kokugoLogs, kokugoUnits, {
  showAllNumbers: true,
  maxNo: 40,
  classFilter: '1組',
  gradeFilter: '4年',
});
assert.equal(mAll.rows.length, 40);
assert.equal(mAll.rows[0].student_no, 1);
assert.equal(mAll.rows[0].cells['P5JA1_007'], null);
assert.equal(mAll.rows[15].student_no, 16);
assert.equal(mAll.rows[15].cells['P5JA1_007'].bestPct, 83);

// 児童別サマリー
const summaries = buildStudentSummaries(sampleLogs);
assert.equal(summaries.length, 3);
const st16 = summaries.find((s) => s.student_key === 'hino_4年_1組_16');
assert.equal(st16.attempts, 2);
assert.equal(st16.uniqueUnits, 1);
assert.equal(st16.highScoreUnits, 1);

// 単元・誤答分析
const { unitStats, wrongRanking } = buildUnitAndWrongAnalysis(sampleLogs);
assert.equal(unitStats.length, 3);
assert.equal(wrongRanking[0].problem_id, '4JA_007_D_01');
assert.equal(wrongRanking[0].count, 3);
assert.equal(wrongRanking[0].studentCount, 2);

console.log('[OK] js/teacher.js aggregation tests passed!');

// ================= 2. gas/Code.gs セキュリティ＆認証シミュレーション =================

const gasCode = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const hashSecret = 'sha256:' + crypto.createHash('sha256').update('sakuraPass!').digest('hex');

const fakeSheets = {
  'マスタ_教科一覧': [
    ['grade', 'subject', 'subject_key', 'sheet_name', 'is_active'],
    ['4年', '国語', 'kokugo', '4年_国語', true],
  ],
  '4年_国語': [
    ['problem_id', 'unit_name'],
    ['4JA_007_D_01', 'ことわざ'],
  ],
  'マスタ_学校認証': [
    ['school_code', 'school_label', 'password', 'is_active', 'memo'],
    ['hino', 'hino校', 'hino2026', true, 'test'],
    ['sakura', 'さくら小', hashSecret, true, 'hashed'],
    ['disabled', '停止校', 'pass123', false, 'inactive'],
  ],
  '学習ログ': [
    ['logged_at', 'school_code', 'grade', 'class_name', 'student_no', 'student_key', 'subject', 'unit_code', 'unit_name', 'mode', 'score', 'total', 'accuracy_pct', 'self_check_count', 'wrong_ids', 'duration_sec', 'device_id'],
    ['2026-11-25 10:00:00', 'hino', '4年', '1組', 16, 'hino_4年_1組_16', '国語', 'P5JA1_007', 'ことわざ', 'unit', 10, 12, 83, 0, '4JA_007_D_01', 90, 'dev1'],
    ['2026-11-25 10:05:00', 'sakura', '4年', '2組', 8, 'sakura_4年_2組_08', '国語', 'P5JA1_007', 'ことわざ', 'unit', 12, 12, 100, 0, '', 70, 'dev2'],
  ],
};

const fakeCacheStore = new Map();
const sandbox = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getId: () => 'FAKE_SS_ID',
      getSheetByName: (name) => {
        if (!fakeSheets[name]) return null;
        return {
          getDataRange: () => ({ getValues: () => fakeSheets[name] }),
          getLastRow: () => fakeSheets[name].length,
          getRange: (_r, _c, _nr, _nc) => ({
            setValues: (rows) => { rows.forEach((row) => fakeSheets[name].push(row)); },
          }),
          appendRow: (row) => fakeSheets[name].push(row),
        };
      },
      insertSheet: (name) => {
        fakeSheets[name] = [];
        return sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      },
    }),
  },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => (fakeCacheStore.has(k) ? fakeCacheStore.get(k) : null),
      put: (k, v) => fakeCacheStore.set(k, String(v)),
      remove: (k) => fakeCacheStore.delete(k),
    }),
  },
  LockService: {
    getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
  },
  Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (_alg, str) => [...crypto.createHash('sha256').update(str, 'utf8').digest()],
    formatDate: (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 19),
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (str) => ({
      _body: str,
      setMimeType() { return this; },
    }),
  },
};

vm.createContext(sandbox);
vm.runInContext(gasCode, sandbox);

const callGet = (params) => JSON.parse(sandbox.doGet({ parameter: params })._body);
const callPost = (obj) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(obj) } })._body);

// ホワイトリスト保護確認
assert.equal(callGet({ action: 'sheet', name: '4年_国語' }).status, 'ok');
assert.equal(callGet({ action: 'sheet', name: 'マスタ_学校認証' }).status, 'error');
assert.equal(callGet({ action: 'sheet', name: '学習ログ' }).status, 'error');
assert.equal(callGet({ action: 'sheet', name: '集計_クラス進捗' }).status, 'error');

// 平文パスワード照合 + 他校データ隔離確認
const authHino = callPost({ action: 'teacher_auth', school_code: 'HINO', password: 'hino2026', logs: [] });
assert.equal(authHino.status, 'ok');
assert.equal(authHino.school_code, 'hino');
assert.equal(authHino.logs.length, 1);
assert.equal(authHino.logs[0].school_code, 'hino');
assert.ok(authHino.token.length >= 32);

// sha256 ハッシュ照合 + 他校データ隔離確認
const authSakura = callPost({ action: 'teacher_auth', school_code: 'sakura', password: 'sakuraPass!', logs: [] });
assert.equal(authSakura.status, 'ok');
assert.equal(authSakura.logs.length, 1);
assert.equal(authSakura.logs[0].school_code, 'sakura');

// 他校トークンで hino を覗こうとしても拒否
const crossTry = callPost({ action: 'teacher_logs', school_code: 'hino', token: authSakura.token, logs: [] });
assert.equal(crossTry.status, 'error');
assert.equal(crossTry.code, 'TOKEN_EXPIRED');

// 無効化学校は拒否
const disabledTry = callPost({ action: 'teacher_auth', school_code: 'disabled', password: 'pass123', logs: [] });
assert.equal(disabledTry.status, 'error');
assert.equal(disabledTry.code, 'AUTH_FAILED');

// 5回連続失敗でロック確認
for (let i = 1; i <= 4; i++) {
  const f = callPost({ action: 'teacher_auth', school_code: 'hino', password: 'wrong', logs: [] });
  assert.equal(f.code, 'AUTH_FAILED');
}
const locked = callPost({ action: 'teacher_auth', school_code: 'hino', password: 'wrong', logs: [] });
assert.equal(locked.code, 'LOCKED');
// ロック中は正しいパスワードでも拒否
const lockedValid = callPost({ action: 'teacher_auth', school_code: 'hino', password: 'hino2026', logs: [] });
assert.equal(lockedValid.code, 'LOCKED');

// ログアウトでトークン無効化
const logoutRes = callPost({ action: 'teacher_logout', token: authHino.token, logs: [] });
assert.equal(logoutRes.status, 'ok');
const afterLogout = callPost({ action: 'teacher_logs', school_code: 'hino', token: authHino.token, logs: [] });
assert.equal(afterLogout.code, 'TOKEN_EXPIRED');

// 児童スコア追記（後方互換）
const prevLen = fakeSheets['学習ログ'].length;
const appendRes = callPost({
  logs: [{ school_code: 'hino', grade: '4年', class_name: '1組', student_no: 20, subject: '算数', unit_code: 'P5MA1_005', unit_name: 'わり算', mode: 'unit', score: 8, total: 10 }],
});
assert.equal(appendRes.status, 'ok');
assert.equal(fakeSheets['学習ログ'].length, prevLen + 1);

console.log('[OK] gas/Code.gs security, isolation, lock, hash & backward-compat tests passed!');
