/**
 * 標準学力調査対策デジタルドリル Google Apps Script (Web API)
 *
 * 【セットアップ / 更新方法】
 * 1. スプレッドシート「標準学力調査対策_デジタルドリルDB」を開く
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. このファイルの内容を貼り付けて保存する
 * 4. 初回：「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員
 *    更新時：「デプロイ」→「デプロイを管理」→ 鉛筆アイコン → バージョン「新バージョン」→「デプロイ」
 *    （※更新時はURLを変えずに新機能を反映できます）
 * 5. 発行されたURLを js/config.js の GAS_API_URL（またはアプリの設定画面）に設定する
 *
 * 【エンドポイント】
 * - GET  ?action=meta                       : マスタ_教科一覧をJSON返却
 * - GET  ?action=sheet&name=4年_国語        : マスタ_教科一覧登録済みの問題シートのみJSON返却（ホワイトリスト保護）
 * - GET  ?action=guide&grade=4年            : 指定学年の単元ガイドシートをJSON返却
 * - GET  ?action=bundle&grade=4年           : 指定学年のマスタ・ガイド・全教科を一括JSON返却
 * - POST { logs: [...] }                    : 学習ログシートへ簡易スコアを追記
 * - POST { action: "teacher_auth", school_code, password } : 学校別パスワード照合＋短命トークン発行＋当該校ログ返却
 * - POST { action: "teacher_logs", school_code, token }    : 認証済みトークンで当該校の最新ログを再取得
 * - POST { action: "teacher_logout", token }               : セッショントークンを即時無効化
 */

const LOG_SHEET_NAME = '学習ログ';
const MASTER_SHEET_NAME = 'マスタ_教科一覧';
const AUTH_SHEET_NAME = 'マスタ_学校認証';

const TEACHER_TOKEN_TTL_SEC = 1800; // 30分
const AUTH_FAIL_MAX = 5;            // 連続失敗上限
const AUTH_LOCK_SEC = 300;          // ロック時間（5分）
const MAX_TEACHER_LOGS = 5000;      // 1回の返却上限件数

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || 'meta';
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'meta') {
      const subjects = readSheetAsObjects_(ss, MASTER_SHEET_NAME);
      return jsonResponse_({
        status: 'ok',
        spreadsheet_id: ss.getId(),
        updated_at: new Date().toISOString(),
        subjects: subjects,
      });
    }

    if (action === 'sheet') {
      const name = String(params.name || '').trim();
      if (!name) return jsonResponse_({ status: 'error', message: 'name parameter is required' });
      // ホワイトリスト保護：マスタ_教科一覧に登録されている問題シートのみ許可
      // （マスタ_学校認証・学習ログ・集計_クラス進捗等への外部GET読取を完全遮断）
      const allowedSheets = getAllowedQuestionSheets_(ss);
      if (!allowedSheets[name]) {
        return jsonResponse_({ status: 'error', message: 'Access denied for restricted sheet' });
      }
      const rows = readSheetAsObjects_(ss, name);
      return jsonResponse_({
        status: 'ok',
        sheet_name: name,
        updated_at: new Date().toISOString(),
        rows: rows,
      });
    }

    if (action === 'guide') {
      const grade = sanitizeText_(params.grade || '4年', 10);
      const allowedGrades = getAllowedGrades_(ss);
      if (!allowedGrades[grade]) {
        return jsonResponse_({ status: 'error', message: 'Access denied for restricted guide' });
      }
      const guideName = grade + '_単元ガイド';
      const rows = readSheetAsObjects_(ss, guideName);
      return jsonResponse_({
        status: 'ok',
        sheet_name: guideName,
        updated_at: new Date().toISOString(),
        rows: rows,
      });
    }

    if (action === 'bundle') {
      const grade = sanitizeText_(params.grade || '4年', 10);
      const subjects = readSheetAsObjects_(ss, MASTER_SHEET_NAME).filter(function(s) {
        return String(s.grade) === String(grade) && toBool_(s.is_active);
      });
      const guideName = grade + '_単元ガイド';
      const guides = subjects.length > 0 ? readSheetAsObjects_(ss, guideName) : [];
      const sheets = {};
      subjects.forEach(function(s) {
        if (s.sheet_name) {
          sheets[s.sheet_name] = readSheetAsObjects_(ss, s.sheet_name);
        }
      });
      return jsonResponse_({
        status: 'ok',
        grade: grade,
        updated_at: new Date().toISOString(),
        subjects: subjects,
        guides: guides,
        sheets: sheets,
      });
    }

    return jsonResponse_({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse_({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ status: 'error', message: 'Empty payload' });
    }

    const payload = JSON.parse(e.postData.contents);
    const action = String(payload.action || '').trim();

    // 先生用：取組状況確認エンドポイント（読取専用のため書き込みロック不要）
    if (action === 'teacher_auth') {
      return handleTeacherAuth_(payload);
    }
    if (action === 'teacher_logs') {
      return handleTeacherLogs_(payload);
    }
    if (action === 'teacher_logout') {
      return handleTeacherLogout_(payload);
    }

    // 児童用：簡易スコア追記（既存仕様）
    return handleAppendLogs_(payload);
  } catch (err) {
    return jsonResponse_({ status: 'error', message: String(err) });
  }
}

// ================= 先生用：取組状況認証・ログ取得 =================

function handleTeacherAuth_(payload) {
  const schoolCode = sanitizeAlpha_(payload.school_code);
  const rawPassword = String(payload.password || '');

  if (!schoolCode || !rawPassword) {
    return jsonResponse_({
      status: 'error',
      code: 'AUTH_FAILED',
      message: '学校名またはパスワードが正しくありません。',
    });
  }

  const cache = CacheService.getScriptCache();
  const failKey = 'tfail_' + schoolCode;
  const failCount = Number(cache.get(failKey) || 0);
  if (failCount >= AUTH_FAIL_MAX) {
    return jsonResponse_({
      status: 'error',
      code: 'LOCKED',
      message: '入力ミスが続いたため一時的にロックされています。5分ほど待ってからやり直してください。',
    });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const authSheet = ss.getSheetByName(AUTH_SHEET_NAME);
  if (!authSheet) {
    return jsonResponse_({
      status: 'error',
      code: 'NOT_CONFIGURED',
      message: '先生用の認証設定がまだ登録されていません。スプレッドシートの「マスタ_学校認証」を確認してください。',
    });
  }

  const authRows = readSheetAsObjects_(ss, AUTH_SHEET_NAME);
  const activeRows = authRows.filter(function(r) {
    return sanitizeAlpha_(r.school_code) && toBool_(r.is_active) && String(r.password || '').trim() !== '';
  });
  if (activeRows.length === 0) {
    return jsonResponse_({
      status: 'error',
      code: 'NOT_CONFIGURED',
      message: '先生用の認証設定がまだ登録されていません。スプレッドシートの「マスタ_学校認証」を確認してください。',
    });
  }

  let matched = null;
  for (let i = 0; i < activeRows.length; i++) {
    const row = activeRows[i];
    if (sanitizeAlpha_(row.school_code) === schoolCode) {
      if (verifyPassword_(rawPassword, String(row.password || '').trim())) {
        matched = row;
        break;
      }
    }
  }

  if (!matched) {
    const nextFail = failCount + 1;
    cache.put(failKey, String(nextFail), AUTH_LOCK_SEC);
    if (nextFail >= AUTH_FAIL_MAX) {
      return jsonResponse_({
        status: 'error',
        code: 'LOCKED',
        message: '入力ミスが続いたため一時的にロックされています。5分ほど待ってからやり直してください。',
      });
    }
    return jsonResponse_({
      status: 'error',
      code: 'AUTH_FAILED',
      message: '学校名またはパスワードが正しくありません。',
    });
  }

  // 認証成功：失敗カウンタをリセットし短命トークンを発行
  cache.remove(failKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const schoolLabel = String(matched.school_label || '').trim() || schoolCode;
  const sessionObj = {
    school_code: schoolCode,
    school_label: schoolLabel,
    created_at: new Date().toISOString(),
  };
  cache.put('ttok_' + token, JSON.stringify(sessionObj), TEACHER_TOKEN_TTL_SEC);

  const logResult = fetchSchoolLogs_(ss, schoolCode);
  return jsonResponse_({
    status: 'ok',
    token: token,
    expires_in_sec: TEACHER_TOKEN_TTL_SEC,
    school_code: schoolCode,
    school_label: schoolLabel,
    fetched_at: new Date().toISOString(),
    total_count: logResult.total_count,
    truncated: logResult.truncated,
    logs: logResult.logs,
  });
}

function handleTeacherLogs_(payload) {
  const token = String(payload.token || '').trim();
  const reqSchool = sanitizeAlpha_(payload.school_code);
  if (!token) {
    return jsonResponse_({
      status: 'error',
      code: 'TOKEN_EXPIRED',
      message: '確認セッションの有効期限が切れました。もう一度パスワードを入力してください。',
    });
  }

  const cache = CacheService.getScriptCache();
  const rawSession = cache.get('ttok_' + token);
  if (!rawSession) {
    return jsonResponse_({
      status: 'error',
      code: 'TOKEN_EXPIRED',
      message: '確認セッションの有効期限が切れました。もう一度パスワードを入力してください。',
    });
  }

  const session = JSON.parse(rawSession);
  if (reqSchool && session.school_code !== reqSchool) {
    return jsonResponse_({
      status: 'error',
      code: 'TOKEN_EXPIRED',
      message: '学校情報が一致しません。もう一度パスワードを入力してください。',
    });
  }

  // トークン有効期限をスライディング延長
  cache.put('ttok_' + token, rawSession, TEACHER_TOKEN_TTL_SEC);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logResult = fetchSchoolLogs_(ss, session.school_code);
  return jsonResponse_({
    status: 'ok',
    expires_in_sec: TEACHER_TOKEN_TTL_SEC,
    school_code: session.school_code,
    school_label: session.school_label || session.school_code,
    fetched_at: new Date().toISOString(),
    total_count: logResult.total_count,
    truncated: logResult.truncated,
    logs: logResult.logs,
  });
}

function handleTeacherLogout_(payload) {
  const token = String(payload.token || '').trim();
  if (token) {
    CacheService.getScriptCache().remove('ttok_' + token);
  }
  return jsonResponse_({ status: 'ok' });
}

function fetchSchoolLogs_(ss, schoolCode) {
  const sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    return { total_count: 0, truncated: false, logs: [] };
  }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { total_count: 0, truncated: false, logs: [] };
  }

  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const headers = values[0].map(function(h) { return String(h).trim(); });
  const idx = {};
  headers.forEach(function(h, i) {
    if (h) idx[h] = i;
  });

  const schoolIdx = idx['school_code'];
  if (schoolIdx === undefined) {
    return { total_count: 0, truncated: false, logs: [] };
  }

  const matched = [];
  // 新しい記録を優先するため末尾から走査
  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    if (sanitizeAlpha_(row[schoolIdx]) !== schoolCode) continue;

    const rawLoggedAt = idx['logged_at'] !== undefined ? row[idx['logged_at']] : '';
    let loggedAtStr = '';
    if (rawLoggedAt instanceof Date) {
      loggedAtStr = Utilities.formatDate(rawLoggedAt, tz, 'yyyy-MM-dd HH:mm:ss');
    } else {
      loggedAtStr = String(rawLoggedAt || '').trim();
    }

    const grade = String(idx['grade'] !== undefined ? row[idx['grade']] : '').trim();
    const className = String(idx['class_name'] !== undefined ? row[idx['class_name']] : '').trim();
    const studentNo = Number(idx['student_no'] !== undefined ? row[idx['student_no']] : 0) || 0;
    const studentKey = String(idx['student_key'] !== undefined ? row[idx['student_key']] : '').trim()
      || (schoolCode + '_' + grade + '_' + className + '_' + String(studentNo).padStart(2, '0'));

    matched.push({
      logged_at: loggedAtStr,
      school_code: schoolCode,
      grade: grade,
      class_name: className,
      student_no: studentNo,
      student_key: studentKey,
      subject: String(idx['subject'] !== undefined ? row[idx['subject']] : '').trim(),
      unit_code: String(idx['unit_code'] !== undefined ? row[idx['unit_code']] : '').trim(),
      unit_name: String(idx['unit_name'] !== undefined ? row[idx['unit_name']] : '').trim(),
      mode: String(idx['mode'] !== undefined ? row[idx['mode']] : 'unit').trim(),
      score: Number(idx['score'] !== undefined ? row[idx['score']] : 0) || 0,
      total: Number(idx['total'] !== undefined ? row[idx['total']] : 0) || 0,
      accuracy_pct: Number(idx['accuracy_pct'] !== undefined ? row[idx['accuracy_pct']] : 0) || 0,
      self_check_count: Number(idx['self_check_count'] !== undefined ? row[idx['self_check_count']] : 0) || 0,
      wrong_ids: String(idx['wrong_ids'] !== undefined ? row[idx['wrong_ids']] : '').trim(),
      duration_sec: Number(idx['duration_sec'] !== undefined ? row[idx['duration_sec']] : 0) || 0,
    });
  }

  // 日時降順に安定ソート
  matched.sort(function(a, b) {
    return a.logged_at < b.logged_at ? 1 : a.logged_at > b.logged_at ? -1 : 0;
  });

  const totalCount = matched.length;
  const truncated = totalCount > MAX_TEACHER_LOGS;
  const logs = truncated ? matched.slice(0, MAX_TEACHER_LOGS) : matched;
  return { total_count: totalCount, truncated: truncated, logs: logs };
}

function verifyPassword_(input, stored) {
  if (!stored) return false;
  if (/^sha256:/i.test(stored)) {
    const expectedHex = stored.slice(7).trim().toLowerCase();
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
    const computedHex = digest.map(function(b) {
      const v = b < 0 ? b + 256 : b;
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
    return constantTimeEquals_(computedHex, expectedHex);
  }
  return constantTimeEquals_(String(input), String(stored));
}

function constantTimeEquals_(a, b) {
  const s1 = String(a);
  const s2 = String(b);
  const maxLen = Math.max(s1.length, s2.length);
  let diff = s1.length ^ s2.length;
  for (let i = 0; i < maxLen; i++) {
    const c1 = i < s1.length ? s1.charCodeAt(i) : 0;
    const c2 = i < s2.length ? s2.charCodeAt(i) : 0;
    diff |= (c1 ^ c2);
  }
  return diff === 0;
}

// ================= 児童用：簡易スコア追記（既存機能） =================

function handleAppendLogs_(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const items = Array.isArray(payload.logs) ? payload.logs : [payload];
    if (items.length === 0 || items.length > 50) {
      return jsonResponse_({ status: 'error', message: 'Invalid batch size' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow([
        'logged_at', 'school_code', 'grade', 'class_name', 'student_no',
        'student_key', 'subject', 'unit_code', 'unit_name', 'mode',
        'score', 'total', 'accuracy_pct', 'self_check_count',
        'wrong_ids', 'duration_sec', 'device_id'
      ]);
    }

    const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    const rowsToAppend = [];

    items.forEach(function(item) {
      const schoolCode = sanitizeAlpha_(item.school_code);
      const grade = sanitizeText_(item.grade || '4年', 10);
      const className = sanitizeText_(item.class_name || '', 10);
      const studentNo = Number(item.student_no) || 0;
      const studentKey = schoolCode + '_' + grade + '_' + className + '_' + String(studentNo).padStart(2, '0');
      const score = Math.max(0, Number(item.score) || 0);
      const total = Math.max(1, Number(item.total) || 1);
      const accuracy = Math.round((score / total) * 100);
      const loggedAt = item.logged_at
        ? Utilities.formatDate(new Date(item.logged_at), tz, 'yyyy-MM-dd HH:mm:ss')
        : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');

      rowsToAppend.push([
        loggedAt,
        schoolCode,
        grade,
        className,
        studentNo,
        studentKey,
        sanitizeText_(item.subject || '', 20),
        sanitizeText_(item.unit_code || '', 30),
        sanitizeText_(item.unit_name || '', 80),
        sanitizeText_(item.mode || 'unit', 20),
        score,
        total,
        accuracy,
        Math.max(0, Number(item.self_check_count) || 0),
        sanitizeText_(item.wrong_ids || '', 1000),
        Math.max(0, Number(item.duration_sec) || 0),
        sanitizeText_(item.device_id || '', 64),
      ]);
    });

    if (rowsToAppend.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }

    return jsonResponse_({
      status: 'ok',
      saved: rowsToAppend.length,
      timestamp: new Date().toISOString(),
    });
  } finally {
    lock.releaseLock();
  }
}

// ================= 共通ヘルパー =================

function getAllowedQuestionSheets_(ss) {
  const subjects = readSheetAsObjects_(ss, MASTER_SHEET_NAME);
  const map = {};
  subjects.forEach(function(s) {
    if (s.sheet_name && toBool_(s.is_active)) {
      map[String(s.sheet_name).trim()] = true;
    }
  });
  return map;
}

function getAllowedGrades_(ss) {
  const subjects = readSheetAsObjects_(ss, MASTER_SHEET_NAME);
  const map = {};
  subjects.forEach(function(s) {
    if (s.grade && toBool_(s.is_active)) {
      map[String(s.grade).trim()] = true;
    }
  });
  return map;
}

function readSheetAsObjects_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(function(h) { return String(h).trim(); });
  const results = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(function(cell) { return cell === '' || cell === null; })) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      let val = row[j];
      if (headers[j] === 'is_active') {
        val = toBool_(val);
      } else if (headers[j] === 'unit_order' || headers[j] === 'display_order') {
        val = Number(val) || 0;
      } else if (val === null || val === undefined) {
        val = '';
      } else {
        val = String(val);
      }
      obj[headers[j]] = val;
    }
    results.push(obj);
  }
  return results;
}

function toBool_(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function sanitizeAlpha_(str) {
  return String(str || '').replace(/[^A-Za-z]/g, '').toLowerCase().slice(0, 32);
}

function sanitizeText_(str, maxLen) {
  const s = String(str || '').trim();
  // スプレッドシート数式インジェクション防止
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return safe.slice(0, maxLen);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
