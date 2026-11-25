import assert from 'node:assert/strict';
import { scoreAnswer } from '../js/scorer.js';

// 1. single_choice
assert.equal(scoreAnswer({ question_type: 'single_choice', answer: '犬が' }, '犬が').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'single_choice', answer: '○' }, '×').isCorrect, false);

// 2. multi_choice (順不同)
assert.equal(scoreAnswer({ question_type: 'multi_choice', answer: 'ア|イ|エ' }, ['エ', 'ア', 'イ']).isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'multi_choice', answer: 'ア|イ|エ' }, ['ア', 'イ']).isCorrect, false);

// 3. word_bank (複数空欄・重複使用)
assert.equal(scoreAnswer({ question_type: 'word_bank', answer: '上がる|成長する' }, ['上がる', '成長する']).isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'word_bank', answer: '0℃|0℃' }, ['０℃', '0℃']).isCorrect, true);

// 4. matching (別解あり: 社会くらしをささえる水 ④エも○)
const matchProb = {
  question_type: 'matching',
  answer: 'ア じゃ口をこまめに|ウ コップに水をくむ|エ おふろの残り湯|イ バケツに水をくんで',
  accepted_answers: 'ア じゃ口をこまめに|ウ コップに水をくむ|エ おふろの残り湯|エ おふろの残り湯',
};
assert.equal(scoreAnswer(matchProb, ['ア じゃ口をこまめに', 'ウ コップに水をくむ', 'エ おふろの残り湯', 'エ おふろの残り湯']).isCorrect, true);
assert.equal(scoreAnswer(matchProb, ['ア', 'ウ', 'エ', 'イ']).isCorrect, true);

// 5. ordering
assert.equal(
  scoreAnswer({ question_type: 'ordering', answer: '{frac:1/3}|1|{frac:7/3}|{mixed:2,2/3}' }, ['{frac:1/3}', '1', '{frac:7/3}', '{mixed:2,2/3}']).isCorrect,
  true
);

// 6. number_input (大数カンマ・全角・小数末尾0・単位付き・あまり)
assert.equal(scoreAnswer({ question_type: 'number_input', answer: '570200800000' }, '５７０，２００，８００，０００').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'number_input', answer: '5.7' }, '5.70').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'number_input', answer: '96', unit_label: 'cm²' }, '96cm²').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'number_input', answer: '15あまり2' }, '１５あまり２').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'number_input', answer: '9', unit_label: '画' }, '九画').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'number_input', answer: '615|624' }, ['615', '624']).isCorrect, true);

// 7. fraction_input (仮分数⇔帯分数・整数同値・形式指定)
assert.equal(scoreAnswer({ question_type: 'fraction_input', question_text: '計算しましょう', answer: '8/6', accepted_answers: '1 2/6' }, '1 2/6').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'fraction_input', question_text: '計算しましょう', answer: '13/13', accepted_answers: '1' }, '1').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'fraction_input', question_text: '仮分数で書きましょう', answer: '19/9' }, '2 1/9').isCorrect, false);
assert.equal(scoreAnswer({ question_type: 'fraction_input', question_text: '帯分数で書きましょう', answer: '2 1/9' }, '19/9').isCorrect, false);
assert.equal(scoreAnswer({ question_type: 'fraction_input', question_text: '帯分数で書きましょう', answer: '2 1/9' }, '2 1/9').isCorrect, true);

// 8. formula_input (演算子正規化・同値式・=答え有無)
assert.equal(scoreAnswer({ question_type: 'formula_input', answer: '180÷12=15' }, '180 / 12 = 15').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'formula_input', answer: '180÷12=15' }, '180÷12').isCorrect, true);
assert.equal(
  scoreAnswer({ question_type: 'formula_input', answer: '□+○=5', accepted_answers: '○+□=5|○=5-□|□=5-○' }, '〇＝５－□').isCorrect,
  true
);

// 9. text_input (別解・単位吸収・複数空欄別解)
assert.equal(scoreAnswer({ question_type: 'text_input', answer: 'ひなん訓練', accepted_answers: '防災訓練|ひなんくんれん' }, '防災訓練').isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'text_input', answer: '滋賀', unit_label: '県' }, '滋賀県').isCorrect, true);
assert.equal(
  scoreAnswer({ question_type: 'text_input', answer: 'バッタ|にげ', accepted_answers: 'バッタ,トノサマバッタ;;にげ,逃げ' }, ['トノサマバッタ', '逃げ']).isCorrect,
  true
);

// 10. self_check
assert.equal(scoreAnswer({ question_type: 'self_check_draw', answer: '働' }, { selfJudgedCorrect: true }).isCorrect, true);
assert.equal(scoreAnswer({ question_type: 'self_check_text', answer: '模範解答' }, { selfJudgedCorrect: false, text: 'てすと' }).isCorrect, false);

console.log('ALL SCORER TESTS PASSED!');
