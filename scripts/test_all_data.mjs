#!/usr/bin/env node
/**
 * 全4教科のすべての問題レコードに対して js/scorer.js の scoreAnswer() を実行し、
 * 正答が必ず正解と判定されること・データ形式の不整合がないことを一括検証するスクリプト
 */
import fs from 'node:fs';
import path from 'node:path';
import { scoreAnswer } from '../js/scorer.js';

const DATA_DIR = path.resolve(import.meta.dirname, '../data');
const FILES = ['4年_国語.json', '4年_社会.json', '4年_算数.json', '4年_理科.json'];

let total = 0;
let failures = [];

for (const fname of FILES) {
  const fpath = path.join(DATA_DIR, fname);
  if (!fs.existsSync(fpath)) {
    failures.push(`${fname}: file not found`);
    continue;
  }
  const rows = JSON.parse(fs.readFileSync(fpath, 'utf-8'));

  for (const q of rows) {
    total++;
    const type = q.question_type;
    const ans = String(q.answer || '');

    // パイプ衝突チェック: choices/answer 内に {漢字|かんじ} があると split('|') が壊れる
    if (/\{[^|{}]+\|[^|{}]+\}/.test(q.choices || '')) {
      failures.push(`${fname}:${q.problem_id}: ruby pipe conflict in choices`);
    }
    if (/\{[^|{}]+\|[^|{}]+\}/.test(ans)) {
      failures.push(`${fname}:${q.problem_id}: ruby pipe conflict in answer`);
    }

    let simulatedUserAns;
    if (type === 'self_check_draw' || type === 'self_check_text') {
      simulatedUserAns = { selfJudgedCorrect: true, text: ans };
    } else if (type === 'multi_choice') {
      simulatedUserAns = ans.split('|').map((s) => s.trim()).filter(Boolean).reverse();
    } else if (type === 'word_bank' || type === 'matching' || type === 'ordering') {
      simulatedUserAns = ans.split('|').map((s) => s.trim());
    } else if (type === 'text_input' || type === 'number_input' || type === 'fraction_input' || type === 'formula_input') {
      const parts = ans.split('|').map((s) => s.trim());
      simulatedUserAns = parts.length === 1 ? parts[0] : parts;
    } else {
      simulatedUserAns = ans;
    }

    const res = scoreAnswer(q, simulatedUserAns);
    if (!res.isCorrect) {
      failures.push(`${fname}:${q.problem_id} (${type}): answer "${ans}" failed scorer!`);
    }

    // single_choice: answer must exist in choices
    if (type === 'single_choice') {
      const choices = String(q.choices || '').split('|').map((s) => s.trim());
      if (!choices.includes(ans.trim())) {
        failures.push(`${fname}:${q.problem_id}: single_choice answer "${ans}" not in choices [${choices.join(', ')}]`);
      }
    }

    // multi_choice: all answers must exist in choices
    if (type === 'multi_choice') {
      const choices = String(q.choices || '').split('|').map((s) => s.trim());
      for (const a of ans.split('|').map((s) => s.trim())) {
        if (!choices.includes(a)) {
          failures.push(`${fname}:${q.problem_id}: multi_choice answer "${a}" not in choices`);
        }
      }
    }

    // word_bank: all answers must exist in choices
    if (type === 'word_bank') {
      const choices = String(q.choices || '').split('|').map((s) => s.trim());
      for (const a of ans.split('|').map((s) => s.trim())) {
        if (!choices.includes(a)) {
          failures.push(`${fname}:${q.problem_id}: word_bank answer "${a}" not in choices [${choices.join(', ')}]`);
        }
      }
    }
  }
}

console.log(`[DATA SCORER TEST] Checked ${total} questions across ${FILES.length} subjects.`);
if (failures.length > 0) {
  console.error(`[FAIL] ${failures.length} failure(s):`);
  for (const f of failures.slice(0, 40)) console.error('  -', f);
  process.exit(1);
}
console.log('[SUCCESS] 100% of questions passed scorer & choice-integrity tests!');
