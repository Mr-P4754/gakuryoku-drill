/**
 * インライン教材記法パーサー & 全11タイプ問題UIレンダラー
 */
import { DrawingCanvas } from './canvas.js';

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 教材用リッチテキスト変換:
 * - {漢字|かんじ} -> <ruby>漢字<rt>かんじ</rt></ruby>
 * - [[傍線]] -> <span class="underline-mark">傍線</span>
 * - ~~波線~~ -> <span class="wavy-mark">波線</span>
 * - {mixed:1,2/5} -> 帯分数HTML
 * - {frac:3/5} -> 分数HTML
 * - cm^2 / m^2 -> cm<sup>2</sup>
 * - \n -> <br>
 */
export function renderRichText(raw) {
  if (raw === null || raw === undefined) return '';
  let html = escapeHtml(String(raw));

  // 帯分数 {mixed:1,2/5}
  html = html.replace(/\{mixed:(\d+),(\d+)\/(\d+)\}/g, (_, w, n, d) =>
    `<span class="math-mixed"><span class="math-whole">${w}</span><span class="math-frac"><span class="math-num">${n}</span><span class="math-den">${d}</span></span></span>`
  );

  // 分数 {frac:3/5}
  html = html.replace(/\{frac:([^}/]+)\/([^}]+)\}/g, (_, n, d) =>
    `<span class="math-frac"><span class="math-num">${n}</span><span class="math-den">${d}</span></span>`
  );

  // ルビ {漢字|かんじ}
  html = html.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, (_, base, ruby) =>
    `<ruby>${base}<rt>${ruby}</rt></ruby>`
  );

  // 傍線 [[...]]
  html = html.replace(/\[\[([^\]]+)\]\]/g, '<span class="underline-mark">$1</span>');

  // 波線 ~~...~~
  html = html.replace(/~~([^~]+)~~/g, '<span class="wavy-mark">$1</span>');

  // 上付き cm^2 / m^2
  html = html.replace(/(cm|m)\^2/g, '$1<sup>2</sup>');
  html = html.replace(/cm²/g, 'cm<sup>2</sup>').replace(/m²/g, 'm<sup>2</sup>');

  // 改行
  html = html.replace(/\n/g, '<br>');
  return html;
}

/**
 * できたかなマーク SVG（にっこり・ふつう・もうすこし）
 */
export function renderDekitakanaSvg(mark, size = 44) {
  if (mark === 'smile') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-label="よくできた" class="mark-svg mark-smile">
      <circle cx="24" cy="24" r="21" fill="#DCFCE7" stroke="#16A34A" stroke-width="3"/>
      <circle cx="16.5" cy="19" r="2.8" fill="#15803D"/>
      <circle cx="31.5" cy="19" r="2.8" fill="#15803D"/>
      <path d="M14 27.5 C16.5 34.5, 31.5 34.5, 34 27.5" fill="none" stroke="#15803D" stroke-width="3.2" stroke-linecap="round"/>
    </svg>`;
  }
  if (mark === 'normal') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-label="ふつう" class="mark-svg mark-normal">
      <circle cx="24" cy="24" r="21" fill="#FEF3C7" stroke="#D97706" stroke-width="3"/>
      <circle cx="16.5" cy="19" r="2.8" fill="#B45309"/>
      <circle cx="31.5" cy="19" r="2.8" fill="#B45309"/>
      <line x1="16" y1="30" x2="32" y2="30" stroke="#B45309" stroke-width="3.2" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-label="もうすこし" class="mark-svg mark-try">
    <circle cx="24" cy="24" r="21" fill="#FEE2E2" stroke="#DC2626" stroke-width="3"/>
    <circle cx="16.5" cy="19" r="2.8" fill="#B91C1C"/>
    <circle cx="31.5" cy="19" r="2.8" fill="#B91C1C"/>
    <path d="M16 33 C19 28.5, 29 28.5, 32 33" fill="none" stroke="#B91C1C" stroke-width="3.2" stroke-linecap="round"/>
  </svg>`;
}

/**
 * 教科アイコンSVG
 */
export function renderSubjectIcon(subjectKey) {
  const icons = {
    kokugo: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4H15v23H7.5A2.5 2.5 0 0 0 5 29.5V6.5z"/><path d="M27 6.5A2.5 2.5 0 0 0 24.5 4H17v23h7.5a2.5 2.5 0 0 1 2.5 2.5V6.5z"/><path d="M9 10h3M9 15h3M20 10h3M20 15h3"/></svg>`,
    shakai: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="16" r="12"/><ellipse cx="16" cy="16" rx="5.5" ry="12"/><line x1="4.5" y1="12" x2="27.5" y2="12"/><line x1="4.5" y1="20" x2="27.5" y2="20"/></svg>`,
    sansu: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="24" height="24" rx="4"/><path d="M9 11h5M11.5 8.5v5M18 11h5M9.5 19.5l4 4M13.5 19.5l-4 4M18 20h5M18 23h5"/></svg>`,
    rika: `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4h8M13 4v7.5L6.5 24a2.5 2.5 0 0 0 2.2 3.7h14.6a2.5 2.5 0 0 0 2.2-3.7L19 11.5V4"/><path d="M9.5 20h13"/></svg>`,
  };
  return icons[subjectKey] || icons.kokugo;
}

/**
 * 問題UIを指定コンテナへマウントし、回答取得コントローラを返す
 * @returns {{ getAnswer: () => any, disable: () => void, isReady: () => boolean, isSelfCheck: boolean, resizeCanvases: () => void }}
 */
export function mountQuestionUI(container, problem, { onSelfJudge, onReadyChange }) {
  const type = problem.question_type;
  container.innerHTML = '';

  // 1. 単一選択 (single_choice)
  if (type === 'single_choice') {
    const choices = splitPipe(problem.choices);
    const isOX = choices.length === 2 && choices.includes('○') && choices.includes('×');
    let selected = null;

    const wrap = document.createElement('div');
    wrap.className = isOX ? 'choice-grid choice-grid-ox' : 'choice-grid';

    choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isOX ? 'choice-btn choice-btn-ox' : 'choice-btn';
      btn.dataset.value = choice;
      btn.innerHTML = isOX
        ? `<span class="ox-symbol">${escapeHtml(choice)}</span><span class="ox-label">${choice === '○' ? '正しい' : 'まちがい'}</span>`
        : `<span class="choice-index">${idx + 1}</span><span class="choice-text">${renderRichText(choice)}</span>`;
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        selected = choice;
        wrap.querySelectorAll('.choice-btn').forEach((b) => b.classList.toggle('is-selected', b === btn));
        onReadyChange?.(true);
      });
      wrap.appendChild(btn);
    });

    container.appendChild(wrap);
    return {
      isSelfCheck: false,
      isReady: () => selected !== null,
      getAnswer: () => selected,
      disable: () => wrap.querySelectorAll('button').forEach((b) => (b.disabled = true)),
      resizeCanvases: () => {},
    };
  }

  // 2. 複数選択 (multi_choice)
  if (type === 'multi_choice') {
    const choices = splitPipe(problem.choices);
    const selected = new Set();

    const guide = document.createElement('p');
    guide.className = 'input-guide';
    guide.textContent = 'あてはまるものをすべて選ぼう（いくつでもタップできます）';
    container.appendChild(guide);

    const wrap = document.createElement('div');
    wrap.className = 'choice-grid';

    choices.forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn choice-btn-multi';
      btn.innerHTML = `<span class="choice-check" aria-hidden="true"></span><span class="choice-text">${renderRichText(choice)}</span>`;
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        if (selected.has(choice)) {
          selected.delete(choice);
          btn.classList.remove('is-selected');
        } else {
          selected.add(choice);
          btn.classList.add('is-selected');
        }
        onReadyChange?.(selected.size > 0);
      });
      wrap.appendChild(btn);
    });

    container.appendChild(wrap);
    return {
      isSelfCheck: false,
      isReady: () => selected.size > 0,
      getAnswer: () => [...selected],
      disable: () => wrap.querySelectorAll('button').forEach((b) => (b.disabled = true)),
      resizeCanvases: () => {},
    };
  }

  // 3. 語群穴埋め (word_bank)
  if (type === 'word_bank') {
    const expected = splitPipe(problem.answer);
    const bank = splitPipe(problem.choices);
    const values = Array(expected.length).fill('');
    let activeSlot = 0;

    const slotsWrap = document.createElement('div');
    slotsWrap.className = 'word-bank-slots';

    const slotButtons = expected.map((_, idx) => {
      const slotRow = document.createElement('div');
      slotRow.className = 'wb-slot-row';
      const label = expected.length > 1 ? `(${idx + 1})` : 'こたえ';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wb-slot-btn' + (idx === 0 ? ' is-active' : '');
      btn.innerHTML = `<span class="wb-slot-num">${label}</span><span class="wb-slot-val">タップしてえらぶ</span>`;
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        if (activeSlot === idx && values[idx]) {
          values[idx] = '';
          renderSlots();
        } else {
          activeSlot = idx;
          renderSlots();
        }
      });
      slotRow.appendChild(btn);
      slotsWrap.appendChild(slotRow);
      return btn;
    });

    const bankLabel = document.createElement('div');
    bankLabel.className = 'wb-bank-label';
    bankLabel.textContent = '下のことばから選んでタップしよう（空らんをタップするとやり直せるよ）';

    const bankWrap = document.createElement('div');
    bankWrap.className = 'wb-chips';

    const chipButtons = bank.map((word) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wb-chip';
      chip.innerHTML = renderRichText(word);
      chip.addEventListener('click', () => {
        if (chip.disabled) return;
        values[activeSlot] = word;
        // 次の空スロットへ自動移動
        const nextEmpty = values.findIndex((v, i) => !v && i > activeSlot);
        const firstEmpty = values.findIndex((v) => !v);
        if (nextEmpty !== -1) activeSlot = nextEmpty;
        else if (firstEmpty !== -1) activeSlot = firstEmpty;
        renderSlots();
      });
      bankWrap.appendChild(chip);
      return chip;
    });

    function renderSlots() {
      slotButtons.forEach((btn, idx) => {
        const val = values[idx];
        btn.classList.toggle('is-active', idx === activeSlot);
        btn.classList.toggle('is-filled', Boolean(val));
        const valSpan = btn.querySelector('.wb-slot-val');
        valSpan.innerHTML = val ? renderRichText(val) : 'ここに入る言葉を選ぶ';
      });
      onReadyChange?.(values.every(Boolean));
    }

    container.appendChild(slotsWrap);
    container.appendChild(bankLabel);
    container.appendChild(bankWrap);

    return {
      isSelfCheck: false,
      isReady: () => values.every(Boolean),
      getAnswer: () => [...values],
      disable: () => {
        slotButtons.forEach((b) => (b.disabled = true));
        chipButtons.forEach((b) => (b.disabled = true));
      },
      resizeCanvases: () => {},
    };
  }

  // 4. マッチング (matching)
  if (type === 'matching') {
    const { lefts, rights } = parseMatchingChoices(problem.choices);
    const selections = Array(lefts.length).fill('');

    const guide = document.createElement('p');
    guide.className = 'input-guide';
    guide.textContent = 'それぞれに合うものを選ぼう';
    container.appendChild(guide);

    const list = document.createElement('div');
    list.className = 'matching-list';

    const selects = lefts.map((leftText, idx) => {
      const row = document.createElement('div');
      row.className = 'matching-row';

      const leftEl = document.createElement('div');
      leftEl.className = 'matching-left';
      leftEl.innerHTML = `<span class="matching-num">${idx + 1}</span><span>${renderRichText(leftText)}</span>`;

      const select = document.createElement('select');
      select.className = 'matching-select';
      select.setAttribute('aria-label', `${leftText} に合う選択肢`);

      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '―― えらんでね ――';
      select.appendChild(defaultOpt);

      rights.forEach((r) => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = stripRubyForOption(r);
        select.appendChild(opt);
      });

      select.addEventListener('change', () => {
        selections[idx] = select.value;
        onReadyChange?.(selections.every(Boolean));
      });

      row.appendChild(leftEl);
      row.appendChild(select);
      list.appendChild(row);
      return select;
    });

    // 右の選択肢一覧（ルビ付きで確認しやすい参照ボックス）
    const refBox = document.createElement('div');
    refBox.className = 'matching-ref-box';
    refBox.innerHTML = `<div class="matching-ref-title">えらぶことば一覧</div>` +
      rights.map((r) => `<div class="matching-ref-item">${renderRichText(r)}</div>`).join('');

    container.appendChild(list);
    container.appendChild(refBox);

    return {
      isSelfCheck: false,
      isReady: () => selections.every(Boolean),
      getAnswer: () => [...selections],
      disable: () => selects.forEach((s) => (s.disabled = true)),
      resizeCanvases: () => {},
    };
  }

  // 5. 並び替え (ordering)
  if (type === 'ordering') {
    const items = splitPipe(problem.choices);
    const chosenIndices = [];

    const guide = document.createElement('p');
    guide.className = 'input-guide';
    guide.textContent = '下のカードを、正しい順番にタップして並べよう';
    container.appendChild(guide);

    const answerBar = document.createElement('div');
    answerBar.className = 'ordering-slots';

    const poolWrap = document.createElement('div');
    poolWrap.className = 'ordering-pool';

    const controls = document.createElement('div');
    controls.className = 'ordering-controls';
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'btn btn-ghost btn-sm';
    undoBtn.textContent = '1つもどす';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-ghost btn-sm';
    clearBtn.textContent = 'やりなおす';
    controls.append(undoBtn, clearBtn);

    let disabled = false;

    function renderOrdering() {
      answerBar.innerHTML = '';
      for (let i = 0; i < items.length; i++) {
        const slot = document.createElement('div');
        slot.className = 'ordering-slot' + (i < chosenIndices.length ? ' is-filled' : '');
        if (i < chosenIndices.length) {
          slot.innerHTML = `<span class="order-badge">${i + 1}</span><span class="order-val">${renderRichText(items[chosenIndices[i]])}</span>`;
        } else {
          slot.innerHTML = `<span class="order-badge">${i + 1}</span><span class="order-placeholder">？</span>`;
        }
        answerBar.appendChild(slot);
      }

      poolWrap.innerHTML = '';
      items.forEach((item, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ordering-card';
        btn.disabled = disabled || chosenIndices.includes(idx);
        btn.innerHTML = renderRichText(item);
        btn.addEventListener('click', () => {
          if (disabled || chosenIndices.includes(idx)) return;
          chosenIndices.push(idx);
          renderOrdering();
        });
        poolWrap.appendChild(btn);
      });

      undoBtn.disabled = disabled || chosenIndices.length === 0;
      clearBtn.disabled = disabled || chosenIndices.length === 0;
      onReadyChange?.(chosenIndices.length === items.length);
    }

    undoBtn.addEventListener('click', () => {
      if (disabled || !chosenIndices.length) return;
      chosenIndices.pop();
      renderOrdering();
    });
    clearBtn.addEventListener('click', () => {
      if (disabled) return;
      chosenIndices.length = 0;
      renderOrdering();
    });

    container.append(answerBar, poolWrap, controls);
    renderOrdering();

    return {
      isSelfCheck: false,
      isReady: () => chosenIndices.length === items.length,
      getAnswer: () => chosenIndices.map((i) => items[i]),
      disable: () => {
        disabled = true;
        renderOrdering();
      },
      resizeCanvases: () => {},
    };
  }

  // 6. 分数・帯分数入力 (fraction_input)
  if (type === 'fraction_input') {
    const expected = splitPipe(problem.answer);
    const unitLabel = problem.unit_label || '';
    const groups = [];

    const guide = document.createElement('p');
    guide.className = 'input-guide';
    guide.textContent = '分数の上のマスに分子、下のマスに分母を入れよう（帯分数や整数のときは左のマスも使ってね）';
    container.appendChild(guide);

    const wrap = document.createElement('div');
    wrap.className = 'fraction-input-list';

    expected.forEach((_, idx) => {
      const box = document.createElement('div');
      box.className = 'fraction-box';

      if (expected.length > 1) {
        const tag = document.createElement('span');
        tag.className = 'slot-tag';
        tag.textContent = `(${idx + 1})`;
        box.appendChild(tag);
      }

      const wholeInput = document.createElement('input');
      wholeInput.type = 'text';
      wholeInput.inputMode = 'numeric';
      wholeInput.className = 'frac-whole-input';
      wholeInput.placeholder = '整数';
      wholeInput.setAttribute('aria-label', '整数部分');

      const fracStack = document.createElement('div');
      fracStack.className = 'frac-stack';

      const numInput = document.createElement('input');
      numInput.type = 'text';
      numInput.inputMode = 'numeric';
      numInput.className = 'frac-part-input';
      numInput.placeholder = '分子';
      numInput.setAttribute('aria-label', '分子');

      const bar = document.createElement('div');
      bar.className = 'frac-bar';

      const denInput = document.createElement('input');
      denInput.type = 'text';
      denInput.inputMode = 'numeric';
      denInput.className = 'frac-part-input';
      denInput.placeholder = '分母';
      denInput.setAttribute('aria-label', '分母');

      fracStack.append(numInput, bar, denInput);
      box.append(wholeInput, fracStack);

      if (unitLabel) {
        const u = document.createElement('span');
        u.className = 'unit-label';
        u.innerHTML = renderRichText(unitLabel);
        box.appendChild(u);
      }

      const checkReady = () => {
        const allOk = groups.every((g) => {
          const w = g.whole.value.trim();
          const n = g.num.value.trim();
          const d = g.den.value.trim();
          return (n && d) || (w && !n && !d);
        });
        onReadyChange?.(allOk);
      };

      [wholeInput, numInput, denInput].forEach((el) => el.addEventListener('input', checkReady));
      groups.push({ whole: wholeInput, num: numInput, den: denInput });
      wrap.appendChild(box);
    });

    container.appendChild(wrap);
    return {
      isSelfCheck: false,
      isReady: () =>
        groups.every((g) => {
          const w = g.whole.value.trim();
          const n = g.num.value.trim();
          const d = g.den.value.trim();
          return (n && d) || (w && !n && !d);
        }),
      getAnswer: () => {
        const list = groups.map((g) => {
          const w = g.whole.value.trim();
          const n = g.num.value.trim();
          const d = g.den.value.trim();
          if (w && n && d) return `${w} ${n}/${d}`;
          if (n && d) return `${n}/${d}`;
          return w;
        });
        return list.length === 1 ? list[0] : list;
      },
      disable: () => groups.forEach((g) => { g.whole.disabled = g.num.disabled = g.den.disabled = true; }),
      resizeCanvases: () => {},
    };
  }

  // 7. 数値・あまり入力 (number_input)
  if (type === 'number_input') {
    const expected = splitPipe(problem.answer);
    const isRemainder = expected.length === 1 && /あまり/.test(expected[0]);
    const unitLabel = problem.unit_label || '';

    if (isRemainder) {
      const row = document.createElement('div');
      row.className = 'remainder-input-row';

      const qInput = document.createElement('input');
      qInput.type = 'text';
      qInput.inputMode = 'numeric';
      qInput.className = 'drill-input drill-input-num';
      qInput.placeholder = '商';
      qInput.setAttribute('aria-label', '商');

      const remLabel = document.createElement('span');
      remLabel.className = 'remainder-word';
      remLabel.textContent = 'あまり';

      const rInput = document.createElement('input');
      rInput.type = 'text';
      rInput.inputMode = 'numeric';
      rInput.className = 'drill-input drill-input-num';
      rInput.placeholder = 'あまり';
      rInput.setAttribute('aria-label', 'あまり');

      const update = () => onReadyChange?.(Boolean(qInput.value.trim() && rInput.value.trim()));
      qInput.addEventListener('input', update);
      rInput.addEventListener('input', update);

      row.append(qInput, remLabel, rInput);
      container.appendChild(row);
      setTimeout(() => qInput.focus(), 50);

      return {
        isSelfCheck: false,
        isReady: () => Boolean(qInput.value.trim() && rInput.value.trim()),
        getAnswer: () => `${qInput.value.trim()}あまり${rInput.value.trim()}`,
        disable: () => { qInput.disabled = rInput.disabled = true; },
        resizeCanvases: () => {},
      };
    }

    const inputs = [];
    const wrap = document.createElement('div');
    wrap.className = 'text-input-list';

    expected.forEach((_, idx) => {
      const row = document.createElement('div');
      row.className = 'text-input-row';
      if (expected.length > 1) {
        const tag = document.createElement('span');
        tag.className = 'slot-tag';
        tag.textContent = `(${idx + 1})`;
        row.appendChild(tag);
      }
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.className = 'drill-input';
      input.placeholder = '数字を入力';
      input.autocomplete = 'off';
      input.addEventListener('input', () => onReadyChange?.(inputs.every((el) => el.value.trim() !== '')));
      row.appendChild(input);

      if (unitLabel) {
        const u = document.createElement('span');
        u.className = 'unit-label';
        u.innerHTML = renderRichText(unitLabel);
        row.appendChild(u);
      }
      inputs.push(input);
      wrap.appendChild(row);
    });

    container.appendChild(wrap);
    setTimeout(() => inputs[0]?.focus(), 50);

    return {
      isSelfCheck: false,
      isReady: () => inputs.every((el) => el.value.trim() !== ''),
      getAnswer: () => (inputs.length === 1 ? inputs[0].value.trim() : inputs.map((el) => el.value.trim())),
      disable: () => inputs.forEach((el) => (el.disabled = true)),
      resizeCanvases: () => {},
    };
  }

  // 8. 式・関係式入力 (formula_input)
  if (type === 'formula_input') {
    const expected = splitPipe(problem.answer);
    const inputs = [];
    let activeInput = null;

    const wrap = document.createElement('div');
    wrap.className = 'text-input-list';

    expected.forEach((_, idx) => {
      const row = document.createElement('div');
      row.className = 'text-input-row';
      if (expected.length > 1) {
        const tag = document.createElement('span');
        tag.className = 'slot-tag';
        tag.textContent = `(${idx + 1})`;
        row.appendChild(tag);
      }
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'drill-input drill-input-formula';
      input.placeholder = '式を入力しよう（下の記号ボタンも使えるよ）';
      input.autocomplete = 'off';
      input.addEventListener('focus', () => { activeInput = input; });
      input.addEventListener('input', () => onReadyChange?.(inputs.every((el) => el.value.trim() !== '')));
      row.appendChild(input);
      inputs.push(input);
      wrap.appendChild(row);
    });
    activeInput = inputs[0];

    const symbols = ['＋', '－', '×', '÷', '＝', '(', ')', '□', '○'];
    const pad = document.createElement('div');
    pad.className = 'symbol-pad';
    const padBtns = symbols.map((sym) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'symbol-btn';
      b.textContent = sym;
      b.addEventListener('click', () => {
        if (!activeInput || activeInput.disabled) return;
        const start = activeInput.selectionStart ?? activeInput.value.length;
        const end = activeInput.selectionEnd ?? activeInput.value.length;
        activeInput.value = activeInput.value.slice(0, start) + sym + activeInput.value.slice(end);
        activeInput.focus();
        activeInput.setSelectionRange(start + sym.length, start + sym.length);
        onReadyChange?.(inputs.every((el) => el.value.trim() !== ''));
      });
      pad.appendChild(b);
      return b;
    });

    container.append(wrap, pad);
    setTimeout(() => inputs[0]?.focus(), 50);

    return {
      isSelfCheck: false,
      isReady: () => inputs.every((el) => el.value.trim() !== ''),
      getAnswer: () => (inputs.length === 1 ? inputs[0].value.trim() : inputs.map((el) => el.value.trim())),
      disable: () => {
        inputs.forEach((el) => (el.disabled = true));
        padBtns.forEach((b) => (b.disabled = true));
      },
      resizeCanvases: () => {},
    };
  }

  // 9. 自己採点：手書き・作図 (self_check_draw)
  if (type === 'self_check_draw') {
    const modeSpec = String(problem.choices || 'draw').trim();
    const isKanji = modeSpec.startsWith('kanji');
    const kanjiCount = isKanji ? Math.max(1, parseInt(modeSpec.split(':')[1] || '1', 10)) : 0;
    const checklists = splitPipe(problem.accepted_answers);
    const canvases = [];
    let revealed = false;

    const wrap = document.createElement('div');
    wrap.className = 'self-check-draw-wrap';

    // ツールバー
    const toolbar = document.createElement('div');
    toolbar.className = 'draw-toolbar';

    if (!isKanji) {
      const freeBtn = createToolBtn('ペン', true);
      const lineBtn = createToolBtn('直線定規', false);
      const eraserBtn = createToolBtn('消しゴム', false);
      const undoBtn = createToolBtn('1つもどす', false);
      const clearBtn = createToolBtn('ぜんぶ消す', false);

      freeBtn.addEventListener('click', () => {
        canvases.forEach((c) => { c.setColor('#2563EB'); c.setMode('free'); });
        setActiveTool(toolbar, freeBtn);
      });
      lineBtn.addEventListener('click', () => {
        canvases.forEach((c) => { c.setColor('#2563EB'); c.setMode('line'); });
        setActiveTool(toolbar, lineBtn);
      });
      eraserBtn.addEventListener('click', () => {
        canvases.forEach((c) => c.setMode('eraser'));
        setActiveTool(toolbar, eraserBtn);
      });
      undoBtn.addEventListener('click', () => canvases.forEach((c) => c.undo()));
      clearBtn.addEventListener('click', () => canvases.forEach((c) => c.clear()));
      toolbar.append(freeBtn, lineBtn, eraserBtn, undoBtn, clearBtn);
    } else {
      const penBtn = createToolBtn('書く', true);
      const undoBtn = createToolBtn('1画もどす', false);
      const clearBtn = createToolBtn('ぜんぶ消す', false);
      penBtn.addEventListener('click', () => canvases.forEach((c) => c.setMode('free')));
      undoBtn.addEventListener('click', () => {
        const lastWithInk = [...canvases].reverse().find((c) => c.hasInk());
        lastWithInk?.undo();
      });
      clearBtn.addEventListener('click', () => canvases.forEach((c) => c.clear()));
      toolbar.append(penBtn, undoBtn, clearBtn);
    }

    wrap.appendChild(toolbar);

    // キャンバス領域
    let overlayImg = null;
    let opacityRow = null;
    let modelPanel = null;

    if (isKanji) {
      const kanjiArea = document.createElement('div');
      kanjiArea.className = 'kanji-boxes-area';

      for (let i = 0; i < kanjiCount; i++) {
        const box = document.createElement('div');
        box.className = 'kanji-pad-box';
        const cv = document.createElement('canvas');
        cv.className = 'kanji-canvas';
        box.appendChild(cv);
        kanjiArea.appendChild(box);
        canvases.push(new DrawingCanvas(cv, { mode: 'free', color: '#1E293B', lineWidth: 5 }));
      }
      if (problem.unit_label) {
        const okuri = document.createElement('span');
        okuri.className = 'kanji-okurigana';
        okuri.textContent = problem.unit_label;
        kanjiArea.appendChild(okuri);
      }
      wrap.appendChild(kanjiArea);
    } else {
      const stage = document.createElement('div');
      stage.className = 'draw-stage';
      if (problem.image_path) {
        const bgImg = document.createElement('img');
        bgImg.src = splitPipe(problem.image_path)[0];
        bgImg.alt = '作図の下絵';
        bgImg.className = 'draw-bg-img';
        stage.appendChild(bgImg);
      }
      if (problem.explanation_image) {
        overlayImg = document.createElement('img');
        overlayImg.src = problem.explanation_image;
        overlayImg.alt = '模範作図オーバーレイ';
        overlayImg.className = 'draw-overlay-img hidden';
        stage.appendChild(overlayImg);
      }
      const cv = document.createElement('canvas');
      cv.className = 'draw-canvas';
      stage.appendChild(cv);
      wrap.appendChild(stage);
      canvases.push(new DrawingCanvas(cv, { mode: 'free', color: '#2563EB', lineWidth: 3.5 }));

      if (problem.explanation_image) {
        opacityRow = document.createElement('div');
        opacityRow.className = 'overlay-control hidden';
        opacityRow.innerHTML = `<label>答えの重ね合わせの濃さ：<input type="range" min="10" max="100" value="65" class="overlay-slider"></label>`;
        const slider = opacityRow.querySelector('input');
        slider.addEventListener('input', () => {
          if (overlayImg) overlayImg.style.opacity = String(Number(slider.value) / 100);
        });
        wrap.appendChild(opacityRow);
      }
    }

    // 答えを見るボタン & 自己判定パネル
    const revealBtn = document.createElement('button');
    revealBtn.type = 'button';
    revealBtn.className = 'btn btn-primary reveal-self-btn';
    revealBtn.textContent = isKanji ? '答えを見てたしかめる' : '模範作図を重ねてたしかめる';

    modelPanel = document.createElement('div');
    modelPanel.className = 'self-judge-panel hidden';
    const checkHtml = checklists.length
      ? `<div class="checklist-box">
          <div class="checklist-title">たしかめチェック</div>
          ${checklists.map((c) => `<label class="checklist-item"><input type="checkbox"> <span>${renderRichText(c)}</span></label>`).join('')}
         </div>`
      : '';

    modelPanel.innerHTML = `
      <div class="model-answer-box">
        <div class="model-answer-label">お手本（答え）</div>
        <div class="${isKanji ? 'model-kanji-display' : 'model-text-display'}">${renderRichText(problem.answer)}${isKanji && problem.unit_label ? `<span class="model-kanji-okuri">${escapeHtml(problem.unit_label)}</span>` : ''}</div>
      </div>
      ${checkHtml}
      <div class="self-judge-actions">
        <p class="self-judge-prompt">お手本とくらべて、自分でマルつけしよう！</p>
        <div class="self-judge-btns">
          <button type="button" class="btn btn-success self-ok-btn">できた！（○）</button>
          <button type="button" class="btn btn-danger-outline self-ng-btn">もういちど（×）</button>
        </div>
      </div>
    `;

    revealBtn.addEventListener('click', () => {
      revealed = true;
      revealBtn.classList.add('hidden');
      modelPanel.classList.remove('hidden');
      if (overlayImg) {
        overlayImg.classList.remove('hidden');
        overlayImg.style.opacity = '0.65';
      }
      if (opacityRow) opacityRow.classList.remove('hidden');
    });

    const okBtn = modelPanel.querySelector('.self-ok-btn');
    const ngBtn = modelPanel.querySelector('.self-ng-btn');
    okBtn.addEventListener('click', () => onSelfJudge?.({ selfJudgedCorrect: true }));
    ngBtn.addEventListener('click', () => onSelfJudge?.({ selfJudgedCorrect: false }));

    wrap.append(revealBtn, modelPanel);
    container.appendChild(wrap);

    requestAnimationFrame(() => canvases.forEach((c) => c.resize()));

    return {
      isSelfCheck: true,
      isReady: () => revealed,
      getAnswer: () => ({ selfJudgedCorrect: false }),
      disable: () => {
        okBtn.disabled = ngBtn.disabled = revealBtn.disabled = true;
        toolbar.querySelectorAll('button').forEach((b) => (b.disabled = true));
      },
      resizeCanvases: () => canvases.forEach((c) => c.resize()),
    };
  }

  // 10. 自己採点：作文・自由記述 (self_check_text)
  if (type === 'self_check_text') {
    const meta = parseTextMeta(problem.choices);
    const checklists = splitPipe(problem.accepted_answers);
    let revealed = false;

    const wrap = document.createElement('div');
    wrap.className = 'self-check-text-wrap';

    const textarea = document.createElement('textarea');
    textarea.className = 'drill-textarea';
    textarea.rows = meta.max >= 100 ? 6 : 4;
    textarea.placeholder = meta.min
      ? `ここに文章を書こう（${meta.min}字〜${meta.max}字の間で書いてみよう）`
      : '自分の考えやわけを書いてみよう';

    const counterRow = document.createElement('div');
    counterRow.className = 'char-counter-row';

    function updateCounter() {
      const len = textarea.value.replace(/\r?\n/g, '').length;
      if (meta.min && meta.max) {
        const status = len < meta.min
          ? `あと ${meta.min - len} 字`
          : len > meta.max
            ? `${len - meta.max} 字オーバー`
            : 'ちょうどよい字数だよ！';
        const cls = len >= meta.min && len <= meta.max ? 'is-good' : len > meta.max ? 'is-over' : '';
        counterRow.innerHTML = `<span class="char-count ${cls}">いま <strong>${len}</strong> 字（めやす：${meta.min}〜${meta.max}字）— ${status}</span>`;
      } else {
        counterRow.innerHTML = `<span class="char-count">いま <strong>${len}</strong> 字</span>`;
      }
    }
    textarea.addEventListener('input', updateCounter);
    updateCounter();

    const revealBtn = document.createElement('button');
    revealBtn.type = 'button';
    revealBtn.className = 'btn btn-primary reveal-self-btn';
    revealBtn.textContent = '答えの例とチェックリストを見る';

    const modelPanel = document.createElement('div');
    modelPanel.className = 'self-judge-panel hidden';
    const checkHtml = checklists.length
      ? `<div class="checklist-box">
          <div class="checklist-title">じぶんでチェックしよう</div>
          ${checklists.map((c) => `<label class="checklist-item"><input type="checkbox"> <span>${renderRichText(c)}</span></label>`).join('')}
         </div>`
      : '';

    modelPanel.innerHTML = `
      <div class="model-answer-box">
        <div class="model-answer-label">答えの例（模範解答）</div>
        <div class="model-text-display">${renderRichText(problem.answer)}</div>
      </div>
      ${checkHtml}
      <div class="self-judge-actions">
        <p class="self-judge-prompt">チェックできたら、じぶんで判定しよう！</p>
        <div class="self-judge-btns">
          <button type="button" class="btn btn-success self-ok-btn">できた！（○）</button>
          <button type="button" class="btn btn-danger-outline self-ng-btn">もういちど（×）</button>
        </div>
      </div>
    `;

    revealBtn.addEventListener('click', () => {
      revealed = true;
      revealBtn.classList.add('hidden');
      modelPanel.classList.remove('hidden');
    });

    const okBtn = modelPanel.querySelector('.self-ok-btn');
    const ngBtn = modelPanel.querySelector('.self-ng-btn');
    okBtn.addEventListener('click', () => onSelfJudge?.({ selfJudgedCorrect: true, text: textarea.value.trim() }));
    ngBtn.addEventListener('click', () => onSelfJudge?.({ selfJudgedCorrect: false, text: textarea.value.trim() }));

    wrap.append(textarea, counterRow, revealBtn, modelPanel);
    container.appendChild(wrap);

    return {
      isSelfCheck: true,
      isReady: () => revealed,
      getAnswer: () => ({ selfJudgedCorrect: false, text: textarea.value.trim() }),
      disable: () => {
        textarea.disabled = okBtn.disabled = ngBtn.disabled = revealBtn.disabled = true;
      },
      resizeCanvases: () => {},
    };
  }

  // 11. 短答テキスト入力 (text_input)
  const expected = splitPipe(problem.answer);
  const unitLabel = problem.unit_label || '';
  const inputs = [];

  const wrap = document.createElement('div');
  wrap.className = 'text-input-list';

  expected.forEach((_, idx) => {
    const row = document.createElement('div');
    row.className = 'text-input-row';
    if (expected.length > 1) {
      const tag = document.createElement('span');
      tag.className = 'slot-tag';
      tag.textContent = `(${idx + 1})`;
      row.appendChild(tag);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'drill-input';
    input.placeholder = 'こたえを入力';
    input.autocomplete = 'off';
    input.addEventListener('input', () => onReadyChange?.(inputs.every((el) => el.value.trim() !== '')));
    row.appendChild(input);

    if (unitLabel) {
      const u = document.createElement('span');
      u.className = 'unit-label';
      u.innerHTML = renderRichText(unitLabel);
      row.appendChild(u);
    }
    inputs.push(input);
    wrap.appendChild(row);
  });

  container.appendChild(wrap);
  setTimeout(() => inputs[0]?.focus(), 50);

  return {
    isSelfCheck: false,
    isReady: () => inputs.every((el) => el.value.trim() !== ''),
    getAnswer: () => (inputs.length === 1 ? inputs[0].value.trim() : inputs.map((el) => el.value.trim())),
    disable: () => inputs.forEach((el) => (el.disabled = true)),
    resizeCanvases: () => {},
  };
}

function splitPipe(str) {
  return String(str || '').split('|').map((s) => s.trim()).filter(Boolean);
}

function parseMatchingChoices(str) {
  const s = String(str || '');
  if (s.includes(';;RIGHT::')) {
    const [leftPart, rightPart] = s.split(';;RIGHT::');
    const lefts = splitPipe(leftPart.replace(/^LEFT::/, ''));
    const rights = splitPipe(rightPart);
    return { lefts, rights };
  }
  const parts = splitPipe(s);
  return { lefts: parts, rights: parts };
}

function stripRubyForOption(str) {
  return String(str || '').replace(/\{([^|{}]+)\|[^|{}]+\}/g, '$1');
}

function parseTextMeta(str) {
  const s = String(str || '');
  const minM = s.match(/min:(\d+)/);
  const maxM = s.match(/max:(\d+)/);
  return {
    min: minM ? parseInt(minM[1], 10) : 0,
    max: maxM ? parseInt(maxM[1], 10) : 0,
  };
}

function createToolBtn(label, active) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool-btn' + (active ? ' is-active' : '');
  b.textContent = label;
  return b;
}

function setActiveTool(toolbar, activeBtn) {
  toolbar.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('is-active'));
  activeBtn.classList.add('is-active');
}
