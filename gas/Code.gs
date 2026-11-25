/**
 * 標準学力調査対策デジタルドリル Google Apps Script (Web API)
 *
 * 【セットアップ方法】
 * 1. スプレッドシート「標準学力調査対策_デジタルドリルDB」を開く
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. このファイルの内容を貼り付けて保存する
 * 4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 5. 発行されたURLを js/config.js の GAS_API_URL（またはアプリの設定画面）に設定する
 *
 * 【エンドポイント】
 * - GET  ?action=meta                       : マスタ_教科一覧をJSON返却
 * - GET  ?action=sheet&name=4年_国語        : 指定シートをオブジェクト配列JSONで返却
 * - GET  ?action=guide&grade=4年            : 指定学年の単元ガイドシートをJSON返却
 * - GET  ?action=bundle&grade=4年           : 指定学年のマスタ・ガイド・全教科を一括JSON返却
 * - POST (Content-Type: text/plain JSON)   : 学習ログシートへ簡易スコアを追記
 */

const LOG_SHEET_NAME = '学習ログ';
const MASTER_SHEET_NAME = 'マスタ_教科一覧';

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
      const name = params.name;
      if (!name) return jsonResponse_({ status: 'error', message: 'name parameter is required' });
      // 学習ログなど管理シートはGETでの外部読取を拒否
      if (name === LOG_SHEET_NAME || name.indexOf('集計_') === 0) {
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
      const grade = params.grade || '4年';
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
      const grade = params.grade || '4年';
      const subjects = readSheetAsObjects_(ss, MASTER_SHEET_NAME).filter(function(s) {
        return String(s.grade) === String(grade) && toBool_(s.is_active);
      });
      const guideName = grade + '_単元ガイド';
      const guides = readSheetAsObjects_(ss, guideName);
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
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ status: 'error', message: 'Empty payload' });
    }

    const payload = JSON.parse(e.postData.contents);
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
  } catch (err) {
    return jsonResponse_({ status: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
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
