/**
 * 全11タイプ対応 採点・表記ゆれ正規化エンジン
 */

const KANJI_NUM_MAP = {
  '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

/**
 * 漢数字（1〜99程度）を算用数字文字列へ変換（変換不能なら元文字列）
 */
export function kanjiToArabic(str) {
  const s = String(str || '').trim();
  if (!/^[〇零一二三四五六七八九十百]+$/.test(s)) return s;
  let total = 0;
  let current = 0;
  for (const ch of s) {
    if (ch === '十') {
      total += (current === 0 ? 1 : current) * 10;
      current = 0;
    } else if (ch === '百') {
      total += (current === 0 ? 1 : current) * 100;
      current = 0;
    } else if (ch in KANJI_NUM_MAP) {
      current = current * 10 + KANJI_NUM_MAP[ch];
    }
  }
  total += current;
  return String(total);
}

/**
 * 全角英数字・記号を半角へ正規化
 */
export function toHalfWidth(str) {
  return String(str || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

/**
 * 共通テキスト正規化
 */
export function normalizeText(str, { stripSpaces = false, stripPunctuation = true } = {}) {
  let s = toHalfWidth(str).trim();
  s = s
    .replace(/[‐‑‒–—―ー−]/g, '-')
    .replace(/[〜～~]/g, '〜')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/「|」|『|』/g, (m) => m);
  if (stripPunctuation) {
    s = s.replace(/[。．.]+$/g, '');
  }
  if (stripSpaces) {
    s = s.replace(/\s+/g, '');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return s;
}

/**
 * 単位ラベルが末尾についている場合に除去した候補も生成
 */
function stripUnitLabel(val, unitLabel) {
  const v = normalizeText(val, { stripSpaces: true, stripPunctuation: false });
  if (!unitLabel) return v;
  const u = normalizeText(unitLabel, { stripSpaces: true, stripPunctuation: false });
  if (u && v.endsWith(u) && v.length > u.length) {
    return v.slice(0, v.length - u.length);
  }
  // よくある単位の揺れ (cm2/cm², m2/m², 度/°, l/L)
  const stripped = v.replace(/(cm2|cm²|m2|m²|km|mm|cm|m|kg|g|dl|dL|l|L|℃|度|°|人|こ|本|まい|枚|つ|画|県|日間|日|円|倍|点)$/i, '');
  if (stripped && u && v.toLowerCase().endsWith(u.toLowerCase())) {
    return v.slice(0, v.length - u.length);
  }
  return v;
}

/**
 * 数値文字列の正規化（カンマ除去、先頭/末尾ゼロの調整、漢数字対応）
 */
export function normalizeNumber(str, unitLabel = '') {
  let s = stripUnitLabel(str, unitLabel);
  s = s.replace(/,/g, '').replace(/\s+/g, '');
  // あまりのあるわり算: "15あまり2", "15余り2", "15...2", "15・・・2"
  const remMatch = s.match(/^(\d+)(?:あまり|余り|\.{2,3}|…|・{2,3}|r)(\d+)$/i);
  if (remMatch) {
    return `${Number(remMatch[1])}あまり${Number(remMatch[2])}`;
  }
  // 漢数字
  const arab = kanjiToArabic(s);
  if (/^-?\d+(\.\d+)?$/.test(arab)) {
    // 大きな整数（13〜14桁：億・兆）は精度を失わないよう文字列のまま先頭ゼロ整理
    if (!arab.includes('.')) {
      return arab.replace(/^(-?)0+(\d)/, '$1$2');
    }
    // 小数は末尾の不要な0と小数点を落とす (5.70 -> 5.7, 21.0 -> 21)
    let [intPart, decPart] = arab.split('.');
    intPart = intPart.replace(/^(-?)0+(\d)/, '$1$2');
    decPart = decPart.replace(/0+$/, '');
    return decPart ? `${intPart}.${decPart}` : intPart;
  }
  return s;
}

/**
 * 数式の正規化
 */
export function normalizeFormula(str) {
  let s = toHalfWidth(str).trim();
  s = s
    .replace(/\s+/g, '')
    .replace(/[×✕✖＊*]/g, '×')
    .replace(/[÷／/]/g, '÷')
    .replace(/[＋+]/g, '＋')
    .replace(/[−ー―–‐-]/g, '－')
    .replace(/[＝=]/g, '＝')
    .replace(/[〇○◯]/g, '○')
    .replace(/[□◻■⬜]/g, '□')
    .replace(/[△▲]/g, '△');
  return s;
}

/**
 * 分数・帯分数のパース:
 * "3/5" -> { whole: 0, num: 3, den: 5, value: 0.6, form: 'proper_or_improper' }
 * "2 1/9" or "2と1/9" -> { whole: 2, num: 1, den: 9, value: 19/9, form: 'mixed' }
 * "1" -> { whole: 1, num: 0, den: 1, value: 1, form: 'integer' }
 */
export function parseFraction(raw) {
  let s = toHalfWidth(String(raw || '')).trim();
  if (!s) return null;
  // {frac:3/5} や {mixed:1,2/5} 形式も受け入れる
  s = s.replace(/^\{frac:([^}]+)\}$/, '$1').replace(/^\{mixed:(\d+),(\d+\/\d+)\}$/, '$1 $2');
  s = s.replace(/と/g, ' ').replace(/\s+/g, ' ').trim();

  // 帯分数: "2 1/9"
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = parseInt(mixed[1], 10);
    const num = parseInt(mixed[2], 10);
    const den = parseInt(mixed[3], 10);
    if (den === 0) return null;
    return { whole, num, den, totalNum: whole * den + num, form: 'mixed' };
  }
  // 分数: "19/9"
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const num = parseInt(frac[1], 10);
    const den = parseInt(frac[2], 10);
    if (den === 0) return null;
    return { whole: 0, num, den, totalNum: num, form: num >= den ? 'improper' : 'proper' };
  }
  // 整数: "1"
  const intM = s.match(/^(\d+)$/);
  if (intM) {
    const whole = parseInt(intM[1], 10);
    return { whole, num: 0, den: 1, totalNum: whole, form: 'integer' };
  }
  return null;
}

function fractionsEqualValue(a, b) {
  if (!a || !b) return false;
  return a.totalNum * b.den === b.totalNum * a.den;
}

function fractionsExactSame(a, b) {
  if (!a || !b) return false;
  return a.whole === b.whole && a.num === b.num && a.den === b.den;
}

/**
 * 複数空欄用の許容リストをパース
 * 単一空欄: "A|B" -> [['A', 'B']]
 * 複数空欄: "A1,A2;;B1,B2" -> [['A1','A2'], ['B1','B2']]
 */
function parseAcceptedForSlots(acceptedStr, slotCount) {
  if (!acceptedStr) return Array.from({ length: slotCount }, () => []);
  if (slotCount === 1) {
    return [acceptedStr.split('|').map((s) => s.trim()).filter(Boolean)];
  }
  const parts = acceptedStr.split(';;');
  return Array.from({ length: slotCount }, (_, idx) => {
    const raw = parts[idx] || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  });
}

/**
 * メイン採点関数
 * @param {object} problem 問題オブジェクト
 * @param {any} userAnswer ユーザーの回答（型は問題タイプに準拠）
 * @returns {{ isCorrect: boolean, isSelfCheck?: boolean, slotResults?: boolean[], displayUserAnswer: string, displayCorrectAnswer: string }}
 */
export function scoreAnswer(problem, userAnswer) {
  const type = problem.question_type;
  const answerStr = String(problem.answer || '').trim();
  const acceptedStr = String(problem.accepted_answers || '').trim();
  const unitLabel = String(problem.unit_label || '').trim();

  // 1. 自己採点タイプ
  if (type === 'self_check_draw' || type === 'self_check_text') {
    const passed = Boolean(userAnswer && userAnswer.selfJudgedCorrect);
    return {
      isCorrect: passed,
      isSelfCheck: true,
      displayUserAnswer:
        type === 'self_check_text'
          ? (userAnswer?.text || '（記述あり）')
          : (passed ? 'できた（自己採点）' : 'もういちど（自己採点）'),
      displayCorrectAnswer: answerStr,
    };
  }

  // 2. 単一選択
  if (type === 'single_choice') {
    const ua = normalizeText(userAnswer, { stripSpaces: true });
    const ca = normalizeText(answerStr, { stripSpaces: true });
    const alts = acceptedStr ? acceptedStr.split('|').map((s) => normalizeText(s, { stripSpaces: true })) : [];
    const isCorrect = ua === ca || alts.includes(ua);
    return {
      isCorrect,
      displayUserAnswer: String(userAnswer || '（未選択）'),
      displayCorrectAnswer: answerStr,
    };
  }

  // 3. 複数選択（順不同集合一致）
  if (type === 'multi_choice') {
    const userSet = new Set((Array.isArray(userAnswer) ? userAnswer : []).map((s) => normalizeText(s, { stripSpaces: true })).filter(Boolean));
    const ansList = answerStr.split('|').map((s) => s.trim()).filter(Boolean);
    const ansSet = new Set(ansList.map((s) => normalizeText(s, { stripSpaces: true })));
    const isCorrect = userSet.size === ansSet.size && [...ansSet].every((x) => userSet.has(x));
    return {
      isCorrect,
      displayUserAnswer: Array.isArray(userAnswer) && userAnswer.length ? userAnswer.join('、') : '（未選択）',
      displayCorrectAnswer: ansList.join('、'),
    };
  }

  // 4. 語群穴埋め
  if (type === 'word_bank') {
    const expected = answerStr.split('|').map((s) => s.trim());
    const uaList = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
    const altPerSlot = parseAcceptedForSlots(acceptedStr, expected.length);
    const slotResults = expected.map((exp, idx) => {
      const u = normalizeText(uaList[idx] || '', { stripSpaces: true });
      const candidates = [exp, ...altPerSlot[idx]].map((c) => normalizeText(c, { stripSpaces: true }));
      return candidates.includes(u);
    });
    return {
      isCorrect: slotResults.every(Boolean),
      slotResults,
      displayUserAnswer: uaList.map((v) => v || '＿').join(' ／ '),
      displayCorrectAnswer: expected.join(' ／ '),
    };
  }

  // 5. マッチング（組み合わせ）
  if (type === 'matching') {
    const expected = answerStr.split('|').map((s) => s.trim());
    const uaList = Array.isArray(userAnswer) ? userAnswer : [];
    const normalizedUser = uaList.map((s) => normalizeText(s || '', { stripSpaces: true }));

    // 別解は "パターン1(a|b|c|d);;パターン2" または 各スロット別解のどちらにも対応
    const altPatterns = [expected];
    if (acceptedStr) {
      acceptedStr.split(';;').forEach((pat) => {
        const arr = pat.split('|').map((s) => s.trim());
        if (arr.length === expected.length) {
          altPatterns.push(arr);
        }
      });
    }

    let bestSlots = expected.map(() => false);
    let matched = false;
    for (const pat of altPatterns) {
      const results = pat.map((exp, idx) => {
        const eNorm = normalizeText(exp, { stripSpaces: true });
        const uNorm = normalizedUser[idx] || '';
        if (!uNorm) return false;
        // 記号のみ（例: ア）と全文（例: ア 説明文）の先頭記号一致も許容
        if (uNorm === eNorm) return true;
        if (eNorm.length === 1 && uNorm.startsWith(eNorm)) return true;
        if (uNorm.length === 1 && eNorm.startsWith(uNorm)) return true;
        return false;
      });
      if (results.every(Boolean)) {
        matched = true;
        bestSlots = results;
        break;
      }
      if (results.filter(Boolean).length > bestSlots.filter(Boolean).length) {
        bestSlots = results;
      }
    }
    return {
      isCorrect: matched,
      slotResults: bestSlots,
      displayUserAnswer: uaList.map((v, i) => `(${i + 1}) ${v || '未選択'}`).join(' ／ '),
      displayCorrectAnswer: expected.map((v, i) => `(${i + 1}) ${v}`).join(' ／ '),
    };
  }

  // 6. 並び替え
  if (type === 'ordering') {
    const expected = answerStr.split('|').map((s) => s.trim());
    const uaList = Array.isArray(userAnswer) ? userAnswer : [];
    const slotResults = expected.map((exp, idx) =>
      normalizeText(uaList[idx] || '', { stripSpaces: true }) === normalizeText(exp, { stripSpaces: true })
    );
    return {
      isCorrect: uaList.length === expected.length && slotResults.every(Boolean),
      slotResults,
      displayUserAnswer: uaList.length ? uaList.join(' → ') : '（未回答）',
      displayCorrectAnswer: expected.join(' → '),
    };
  }

  // 7. 数値・あまり入力
  if (type === 'number_input') {
    const expected = answerStr.split('|').map((s) => s.trim());
    const uaList = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
    const altPerSlot = parseAcceptedForSlots(acceptedStr, expected.length);
    const slotResults = expected.map((exp, idx) => {
      const rawU = String(uaList[idx] ?? '').trim();
      if (!rawU) return false;
      const uNorm = normalizeNumber(rawU, unitLabel);
      const candidates = [exp, ...altPerSlot[idx]].map((c) => normalizeNumber(c, unitLabel));
      return candidates.includes(uNorm);
    });
    return {
      isCorrect: slotResults.every(Boolean),
      slotResults,
      displayUserAnswer: uaList.map((v) => (v ? `${v}${unitLabel && !String(v).endsWith(unitLabel) ? unitLabel : ''}` : '（未入力）')).join(' ／ '),
      displayCorrectAnswer: expected.map((v) => `${v}${unitLabel && !v.endsWith(unitLabel) ? unitLabel : ''}`).join(' ／ '),
    };
  }

  // 8. 分数・帯分数入力
  if (type === 'fraction_input') {
    const expected = answerStr.split('|').map((s) => s.trim());
    const uaList = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
    const altPerSlot = parseAcceptedForSlots(acceptedStr, expected.length);
    const qText = String(problem.question_text || '');
    const requireImproper = qText.includes('仮分数で') && !qText.includes('帯分数');
    const requireMixed = qText.includes('帯分数で') && !qText.includes('仮分数');

    const slotResults = expected.map((exp, idx) => {
      const uParsed = parseFraction(uaList[idx] || '');
      if (!uParsed) return false;
      const expParsed = parseFraction(exp);
      const altParsed = altPerSlot[idx].map(parseFraction).filter(Boolean);

      // 形式指定がある場合は形式もチェック
      if (requireImproper && uParsed.form === 'mixed') return false;
      if (requireMixed && uParsed.form === 'improper') return false;

      if (expParsed && fractionsExactSame(uParsed, expParsed)) return true;
      if (altParsed.some((ap) => fractionsExactSame(uParsed, ap))) return true;
      // 形式指定がない場合（分数のたし算・ひき算等）は分母一致かつ値同値（仮分数⇔帯分数・整数）を許容
      if (!requireImproper && !requireMixed && expParsed && fractionsEqualValue(uParsed, expParsed)) {
        return true;
      }
      return false;
    });

    return {
      isCorrect: slotResults.every(Boolean),
      slotResults,
      displayUserAnswer: uaList.map((v) => v || '（未入力）').join(' ／ '),
      displayCorrectAnswer: expected.join(' ／ ') + (acceptedStr ? `（${acceptedStr.replace(/\|/g, '・')} も○）` : ''),
    };
  }

  // 9. 数式・関係式入力
  if (type === 'formula_input') {
    const expected = answerStr.split('|').map((s) => s.trim());
    const uaList = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
    const altPerSlot = parseAcceptedForSlots(acceptedStr, expected.length);
    const slotResults = expected.map((exp, idx) => {
      const uNorm = normalizeFormula(uaList[idx] || '');
      if (!uNorm) return false;
      const candidates = [exp, ...altPerSlot[idx]].map(normalizeFormula);
      if (candidates.includes(uNorm)) return true;
      // 「=答え」の有無のゆれを自動許容 (例: 正解が "180÷12=15" のとき "180÷12" も、または逆も検討)
      for (const c of candidates) {
        if (c.includes('＝') && !uNorm.includes('＝')) {
          const lhs = c.split('＝')[0];
          if (uNorm === lhs && !c.includes('□') && !c.includes('○')) return true;
        }
      }
      return false;
    });
    return {
      isCorrect: slotResults.every(Boolean),
      slotResults,
      displayUserAnswer: uaList.map((v) => v || '（未入力）').join(' ／ '),
      displayCorrectAnswer: expected.join(' ／ '),
    };
  }

  // 10. 短答テキスト入力 (text_input)
  const expected = answerStr.split('|').map((s) => s.trim());
  const uaList = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
  const altPerSlot = parseAcceptedForSlots(acceptedStr, expected.length);

  const slotResults = expected.map((exp, idx) => {
    const rawU = String(uaList[idx] ?? '').trim();
    if (!rawU) return false;
    const uClean = normalizeText(stripUnitLabel(rawU, unitLabel), { stripSpaces: true });
    const uRawNorm = normalizeText(rawU, { stripSpaces: true });
    const uNum = kanjiToArabic(uClean);

    const candidates = [exp, ...altPerSlot[idx]];
    return candidates.some((cand) => {
      const cClean = normalizeText(stripUnitLabel(cand, unitLabel), { stripSpaces: true });
      const cRawNorm = normalizeText(cand, { stripSpaces: true });
      const cNum = kanjiToArabic(cClean);
      return (
        uClean === cClean ||
        uRawNorm === cRawNorm ||
        (uNum !== '' && uNum === cNum)
      );
    });
  });

  return {
    isCorrect: slotResults.every(Boolean),
    slotResults,
    displayUserAnswer: uaList.map((v) => (v ? `${v}${unitLabel && !String(v).endsWith(unitLabel) ? unitLabel : ''}` : '（未入力）')).join(' ／ '),
    displayCorrectAnswer: expected.map((v) => `${v}${unitLabel && !v.endsWith(unitLabel) ? unitLabel : ''}`).join(' ／ '),
  };
}
