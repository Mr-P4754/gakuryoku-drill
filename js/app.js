/**
 * 標準学力調査対策デジタルドリル SPA メインアプリケーション
 */
import { APP_CONFIG } from './config.js';
import {
  loadMeta,
  loadSubjectQuestions,
  loadUnitGuides,
  clearDataCache,
  getGasApiUrl,
  setCustomGasApiUrl,
} from './dataLoader.js';
import {
  getProfile,
  saveProfile,
  validateSchoolCode,
  formatProfileBadge,
  getSettings,
  saveSettings,
  getAllProgress,
  getUnitRecords,
  getUnitRecord,
  recordProblemAttempt,
  recordUnitCompletion,
  resetAllLearningHistory,
  submitScoreLog,
  getPendingLogQueue,
  flushPendingLogQueue,
} from './logger.js';
import { scoreAnswer } from './scorer.js';
import {
  escapeHtml,
  renderRichText,
  renderDekitakanaSvg,
  renderSubjectIcon,
  mountQuestionUI,
} from './renderers.js';
import { DrawingCanvas } from './canvas.js';

const state = {
  meta: null,
  currentGrade: APP_CONFIG.DEFAULT_GRADE,
  subjects: [],
  guides: [],
  questionsBySheet: {}, // sheet_name -> Problem[]
  currentSubject: null,
  sourceFilter: 'すべて',
  quiz: null, // active quiz session
  scratchCanvas: null,
  scratchOpen: false,
};

const $app = () => document.getElementById('app-main');

// ================= 初期化 =================

async function init() {
  applySettingsToBody(getSettings());
  bindGlobalModals();
  bindScratchpad();
  updateHeaderBadges();

  // バックグラウンドで未送信キューを再送試行
  flushPendingLogQueue().then(() => updateHeaderBadges()).catch(() => {});

  try {
    state.meta = await loadMeta({
      onRemoteUpdate: (remoteMeta) => {
        const prevGrades = [...new Set((state.meta?.subjects || []).map((s) => s.grade))].join(',');
        const nextGradesList = [...new Set((remoteMeta?.subjects || []).map((s) => s.grade))];
        const nextGrades = nextGradesList.join(',');
        state.meta = remoteMeta;
        if (prevGrades !== nextGrades) {
          const profSelect = document.getElementById('prof-grade');
          if (profSelect && nextGradesList.length) {
            const prevVal = profSelect.value;
            profSelect.innerHTML = nextGradesList.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
            profSelect.value = nextGradesList.includes(prevVal) ? prevVal : nextGradesList[0];
          }
          if (!location.hash || location.hash.startsWith('#home')) {
            renderHomeView();
          }
        }
      },
    });
    const profile = getProfile();
    if (profile?.grade) state.currentGrade = profile.grade;
    await loadGradeBundle(state.currentGrade);

    // ハッシュルーティング確認
    window.addEventListener('hashchange', handleRoute);
    await handleRoute();

    // 初回アクセスでプロフィール未登録なら優しく設定モーダルを表示
    if (!profile || !profile.school_code) {
      openProfileModal(true);
    }
  } catch (err) {
    console.error(err);
    $app().innerHTML = `
      <div class="card error-card">
        <h2>データの読み込みに失敗しました</h2>
        <p>${escapeHtml(err.message || String(err))}</p>
        <button type="button" class="btn btn-primary" onclick="location.reload()">もういちど読み込む</button>
      </div>
    `;
  }
}

async function loadGradeBundle(grade, { forceRemote = false } = {}) {
  state.currentGrade = grade;
  state.subjects = (state.meta?.subjects || [])
    .filter((s) => s.grade === grade && s.is_active !== false)
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

  const [guides, ...subjectLists] = await Promise.all([
    loadUnitGuides(grade, { forceRemote }).catch(() => []),
    ...state.subjects.map((s) => loadSubjectQuestions(s, { forceRemote }).catch(() => [])),
  ]);

  state.guides = guides || [];
  state.subjects.forEach((s, idx) => {
    state.questionsBySheet[s.sheet_name] = subjectLists[idx] || [];
  });
}

// ================= ルーティング =================

async function handleRoute() {
  closeScratchpad();
  const rawHash = location.hash || '#home';
  const [route, queryStr] = rawHash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(queryStr || '');

  // 学年パラメータ対応 (4 -> 4年)
  if (params.get('grade')) {
    let g = params.get('grade');
    if (/^\d+$/.test(g)) g = `${g}年`;
    if (g !== state.currentGrade) {
      await loadGradeBundle(g);
    }
  }

  if (route === 'subject') {
    const subjKey = params.get('subject');
    const subj = findSubject(subjKey);
    if (subj) {
      state.currentSubject = subj;
      state.sourceFilter = 'すべて';
      renderUnitListView(subj);
      return;
    }
  }

  if (route === 'drill') {
    const subjKey = params.get('subject');
    const unitCode = params.get('unit');
    const source = params.get('source') || 'すべて';
    const subj = findSubject(subjKey);
    if (subj && unitCode) {
      state.currentSubject = subj;
      startUnitQuiz(subj, unitCode, source);
      return;
    }
  }

  if (route === 'mock') {
    const subjKey = params.get('subject');
    const count = parseInt(params.get('count') || '10', 10);
    const subj = findSubject(subjKey);
    if (subj) {
      state.currentSubject = subj;
      startMockQuiz(subj, count);
      return;
    }
  }

  if (route === 'review') {
    const subjKey = params.get('subject');
    startReviewQuiz(subjKey ? findSubject(subjKey) : null);
    return;
  }

  renderHomeView();
}

function findSubject(keyOrName) {
  if (!keyOrName) return null;
  return state.subjects.find(
    (s) => s.subject_key === keyOrName || s.subject === keyOrName || s.sheet_name === keyOrName
  );
}

// ================= ホーム画面 =================

function renderHomeView() {
  const allGrades = [...new Set((state.meta?.subjects || []).map((s) => s.grade))];
  const progress = getAllProgress();
  const unitRecords = getUnitRecords();

  let totalUnits = 0;
  let clearedUnits = 0;
  let totalQuestions = 0;
  let reviewCount = 0;

  const subjectCardsHtml = state.subjects
    .map((subj) => {
      const qs = state.questionsBySheet[subj.sheet_name] || [];
      const units = groupUnits(qs);
      totalUnits += units.length;
      totalQuestions += qs.length;

      let subjCleared = 0;
      units.forEach((u) => {
        const rec = getUnitRecord(unitRecords, subj.grade, subj.subject_key, u.unit_code);
        if (rec && rec.bestPct >= 80) subjCleared++;
      });
      clearedUnits += subjCleared;

      const subjWrong = qs.filter((q) => progress[q.problem_id]?.needsReview).length;
      reviewCount += subjWrong;

      const pct = units.length ? Math.round((subjCleared / units.length) * 100) : 0;

      return `
        <article class="subject-card" style="--subj-color: ${subj.theme_color}; --subj-bg: ${subj.theme_bg}">
          <div class="subject-card-head">
            <div class="subject-icon-wrap">${renderSubjectIcon(subj.subject_key)}</div>
            <div class="subject-title-wrap">
              <span class="subject-grade-tag">${escapeHtml(subj.grade)}</span>
              <h2>${escapeHtml(subj.subject)}</h2>
            </div>
          </div>
          <div class="subject-stats">
            <span>全 ${units.length} 単元</span>
            <span class="dot">・</span>
            <span>${qs.length} 問</span>
            ${subjWrong > 0 ? `<span class="wrong-pill">復習 ${subjWrong}問</span>` : ''}
          </div>
          <div class="progress-track" aria-label="${escapeHtml(subj.subject)}の達成率 ${pct}%">
            <div class="progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="subject-progress-label">
            <span>クリア単元: <strong>${subjCleared}</strong> / ${units.length}</span>
            <span>${pct}%</span>
          </div>
          <div class="subject-card-actions">
            <a href="#subject?grade=${encodeURIComponent(subj.grade)}&subject=${encodeURIComponent(subj.subject_key)}" class="btn btn-subject">単元をえらぶ</a>
            <a href="#mock?grade=${encodeURIComponent(subj.grade)}&subject=${encodeURIComponent(subj.subject_key)}&count=10" class="btn btn-ghost btn-sm">力だめし10問</a>
          </div>
        </article>
      `;
    })
    .join('');

  const gradeTabsHtml = allGrades.length > 1
    ? `<div class="grade-tabs">${allGrades.map((g) => `<button type="button" class="grade-tab ${g === state.currentGrade ? 'is-active' : ''}" data-grade="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}</div>`
    : '';

  const overallPct = totalUnits ? Math.round((clearedUnits / totalUnits) * 100) : 0;

  $app().innerHTML = `
    <section class="home-hero">
      <div class="hero-copy">
        <h1>${escapeHtml(state.currentGrade)} 標準学力調査たいさく</h1>
        <p>フォローアッププリントとたしかめドリルで、4教科の力をしっかりつけよう！</p>
        ${gradeTabsHtml}
      </div>
      <div class="hero-summary-card">
        <div class="summary-metric">
          <span class="metric-label">クリア単元</span>
          <span class="metric-value"><strong>${clearedUnits}</strong><small> / ${totalUnits}</small></span>
        </div>
        <div class="summary-metric">
          <span class="metric-label">全収録もんだい</span>
          <span class="metric-value"><strong>${totalQuestions}</strong><small> 問</small></span>
        </div>
        <div class="summary-metric">
          <span class="metric-label">達成度</span>
          <span class="metric-value"><strong>${overallPct}</strong><small>%</small></span>
        </div>
      </div>
    </section>

    ${reviewCount > 0 ? `
      <div class="review-banner">
        <div class="review-banner-text">
          <strong>にがて復習ボックスに ${reviewCount} 問あるよ！</strong>
          <span>まちがえた問題をやり直して、しっかり身につけよう。</span>
        </div>
        <a href="#review" class="btn btn-accent">にがて問題にチャレンジ</a>
      </div>
    ` : ''}

    <section class="subjects-section" aria-label="教科一覧">
      <div class="subject-grid">${subjectCardsHtml}</div>
    </section>
  `;

  $app().querySelectorAll('.grade-tab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await loadGradeBundle(btn.dataset.grade);
      renderHomeView();
    });
  });
}

// ================= 単元一覧画面 =================

function renderUnitListView(subj) {
  const allQs = state.questionsBySheet[subj.sheet_name] || [];
  const sources = ['すべて', 'フォローアップ', 'たしかめドリル', 'チャレンジ'].filter(
    (s) => s === 'すべて' || allQs.some((q) => q.source_type === s)
  );
  const filteredQs = state.sourceFilter === 'すべて'
    ? allQs
    : allQs.filter((q) => q.source_type === state.sourceFilter);

  const units = groupUnits(filteredQs);
  const unitRecords = getUnitRecords();
  const progress = getAllProgress();
  const wrongCount = allQs.filter((q) => progress[q.problem_id]?.needsReview).length;

  const filterHtml = sources
    .map((src) => `<button type="button" class="filter-chip ${state.sourceFilter === src ? 'is-active' : ''}" data-source="${escapeHtml(src)}">${escapeHtml(src)}</button>`)
    .join('');

  const unitsHtml = units
    .map((u) => {
      const rec = getUnitRecord(unitRecords, subj.grade, subj.subject_key, u.unit_code);
      const guide = findGuide(u.unit_code);
      const sourceTags = [...new Set(u.questions.map((q) => q.source_type))]
        .map((st) => `<span class="source-badge source-${sourceSlug(st)}">${escapeHtml(st)}</span>`)
        .join('');
      const hasSelfCheck = u.questions.some((q) => q.question_type.startsWith('self_check'));

      return `
        <article class="unit-card">
          <div class="unit-card-left">
            <div class="unit-num">${u.unit_order}</div>
            <div class="unit-info">
              <div class="unit-tags">
                ${sourceTags}
                <span class="unit-count-tag">${u.questions.length}問</span>
                ${hasSelfCheck ? '<span class="self-tag">手書き・記述あり</span>' : ''}
              </div>
              <h3 class="unit-name">${escapeHtml(u.unit_name)}</h3>
              ${guide?.goal ? `<p class="unit-goal">${renderRichText(guide.goal)}</p>` : ''}
            </div>
          </div>
          <div class="unit-card-right">
            <div class="unit-score-area">
              ${rec ? `
                ${renderDekitakanaSvg(rec.mark, 38)}
                <div class="unit-best-text">最高 <strong>${rec.bestPct}%</strong></div>
              ` : '<span class="unit-unattempted">未挑戦</span>'}
            </div>
            <div class="unit-actions">
              ${guide ? `<button type="button" class="btn btn-ghost btn-sm open-guide-btn" data-unit="${escapeHtml(u.unit_code)}">要点</button>` : ''}
              <button type="button" class="btn btn-subject btn-sm start-unit-btn" data-unit="${escapeHtml(u.unit_code)}">スタート</button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  $app().innerHTML = `
    <div class="view-container" style="--subj-color: ${subj.theme_color}; --subj-bg: ${subj.theme_bg}">
      <div class="breadcrumb-row">
        <a href="#home" class="back-link">← ホームにもどる</a>
      </div>

      <header class="subject-header-banner">
        <div class="subject-banner-left">
          <div class="subject-icon-wrap lg">${renderSubjectIcon(subj.subject_key)}</div>
          <div>
            <span class="subject-grade-tag">${escapeHtml(subj.grade)}</span>
            <h1>${escapeHtml(subj.subject)}</h1>
            <p>全 ${groupUnits(allQs).length} 単元・${allQs.length} 問</p>
          </div>
        </div>
        <div class="subject-banner-actions">
          <a href="#mock?grade=${encodeURIComponent(subj.grade)}&subject=${encodeURIComponent(subj.subject_key)}&count=10" class="btn btn-subject">力だめしテスト（10問）</a>
          ${wrongCount > 0 ? `<a href="#review?subject=${encodeURIComponent(subj.subject_key)}" class="btn btn-accent btn-sm">まちがい復習 (${wrongCount}問)</a>` : ''}
        </div>
      </header>

      <div class="filter-bar" role="tablist" aria-label="出題区分でしぼり込み">${filterHtml}</div>

      <div class="unit-list">${unitsHtml || '<p class="empty-msg">該当する単元がありません。</p>'}</div>
    </div>
  `;

  $app().querySelectorAll('.filter-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sourceFilter = btn.dataset.source;
      renderUnitListView(subj);
    });
  });

  $app().querySelectorAll('.open-guide-btn').forEach((btn) => {
    btn.addEventListener('click', () => openGuideModal(subj, btn.dataset.unit));
  });

  $app().querySelectorAll('.start-unit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const unitCode = btn.dataset.unit;
      location.hash = `#drill?grade=${encodeURIComponent(subj.grade)}&subject=${encodeURIComponent(subj.subject_key)}&unit=${encodeURIComponent(unitCode)}&source=${encodeURIComponent(state.sourceFilter)}`;
    });
  });
}

// ================= 問題演習セッション =================

function startUnitQuiz(subj, unitCode, sourceFilter = 'すべて') {
  const allQs = state.questionsBySheet[subj.sheet_name] || [];
  let qs = allQs.filter((q) => q.unit_code === unitCode);
  if (sourceFilter && sourceFilter !== 'すべて') {
    const sub = qs.filter((q) => q.source_type === sourceFilter);
    if (sub.length > 0) qs = sub;
  }
  if (qs.length === 0) {
    renderUnitListView(subj);
    return;
  }
  beginQuizSession({
    subject: subj,
    mode: 'unit',
    unitCode,
    unitName: qs[0].unit_name,
    questions: qs,
  });
}

function startMockQuiz(subj, count = 10) {
  const allQs = state.questionsBySheet[subj.sheet_name] || [];
  // 模擬テストはランダムに抽出（自己採点系も含めて幅広く出題）
  const shuffled = [...allQs].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, Math.min(count, shuffled.length));
  if (picked.length === 0) {
    renderUnitListView(subj);
    return;
  }
  beginQuizSession({
    subject: subj,
    mode: 'mock',
    unitCode: 'MOCK',
    unitName: `${subj.subject} 力だめしテスト（${picked.length}問）`,
    questions: picked,
  });
}

function startReviewQuiz(subj = null) {
  const progress = getAllProgress();
  let pool = [];
  const targetSubjects = subj ? [subj] : state.subjects;
  targetSubjects.forEach((s) => {
    const qs = state.questionsBySheet[s.sheet_name] || [];
    qs.forEach((q) => {
      if (progress[q.problem_id]?.needsReview) {
        pool.push({ ...q, _subjectMeta: s });
      }
    });
  });

  if (pool.length === 0) {
    renderHomeView();
    return;
  }

  beginQuizSession({
    subject: subj || targetSubjects[0],
    mode: 'retry',
    unitCode: 'RETRY',
    unitName: subj ? `${subj.subject} にがて復習` : '4教科 にがて復習',
    questions: pool.slice(0, 20),
  });
}

function beginQuizSession({ subject, mode, unitCode, unitName, questions }) {
  state.quiz = {
    subject,
    mode,
    unitCode,
    unitName,
    questions,
    index: 0,
    results: [],
    startedAt: Date.now(),
    controller: null,
    answered: false,
  };
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const quiz = state.quiz;
  if (!quiz) return;
  const q = quiz.questions[quiz.index];
  const subj = q._subjectMeta || quiz.subject;
  const settings = getSettings();
  const guide = findGuide(q.unit_code);
  const total = quiz.questions.length;
  const pct = Math.round(((quiz.index) / total) * 100);
  quiz.answered = false;

  const isDrawSelfCheck = q.question_type === 'self_check_draw' && !String(q.choices || '').startsWith('kanji');
  const images = (q.image_path || '').split('|').map((s) => s.trim()).filter(Boolean);
  const showSideImages = !isDrawSelfCheck && images.length > 0;
  const hasContext = Boolean((q.context_text || '').trim());
  const hasLeftPane = hasContext || showSideImages;
  const isVertical = q.display_mode === 'vertical' && settings.verticalText;

  const imagesHtml = showSideImages
    ? `<div class="context-images">${images.map((src, i) => `
        <figure class="figure-card">
          <img src="${escapeHtml(src)}" alt="問題図版 ${i + 1}" class="problem-figure zoomable-img" loading="lazy">
          <figcaption class="figure-caption">タップで拡大できるよ</figcaption>
        </figure>
      `).join('')}</div>`
    : '';

  const contextHtml = hasContext
    ? `<div class="context-passage-wrap">
        ${q.display_mode === 'vertical' ? `
          <div class="passage-toolbar">
            <span class="passage-badge">本文・資料</span>
            <button type="button" class="btn btn-ghost btn-xs" id="toggle-vertical-inline">
              ${isVertical ? '横書きにする' : '縦書きにする'}
            </button>
          </div>
        ` : ''}
        <div class="context-text ${isVertical ? 'is-vertical' : ''}">${renderRichText(q.context_text)}</div>
       </div>`
    : '';

  $app().innerHTML = `
    <div class="quiz-shell" style="--subj-color: ${subj.theme_color}; --subj-bg: ${subj.theme_bg}">
      <div class="quiz-topbar">
        <div class="quiz-topbar-left">
          <button type="button" class="btn btn-ghost btn-sm" id="quiz-exit-btn">← もどる</button>
          <div class="quiz-unit-title">
            <span class="quiz-subj-pill">${escapeHtml(subj.subject)}</span>
            <strong>${escapeHtml(quiz.unitName)}</strong>
          </div>
        </div>
        <div class="quiz-topbar-right">
          ${guide ? `<button type="button" class="btn btn-ghost btn-sm" id="quiz-guide-btn">要点</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" id="quiz-scratch-btn">計算メモ</button>
          <span class="quiz-counter"><strong>${quiz.index + 1}</strong> / ${total}</span>
        </div>
      </div>

      <div class="quiz-progress-bar">
        <div class="quiz-progress-fill" style="width: ${pct}%"></div>
      </div>

      <div class="quiz-body ${hasLeftPane ? 'has-split' : 'single-pane'}">
        ${hasLeftPane ? `
          <aside class="quiz-left-pane">
            ${contextHtml}
            ${imagesHtml}
          </aside>
        ` : ''}

        <section class="quiz-right-pane">
          <div class="question-card">
            <div class="question-meta">
              <span class="source-badge source-${sourceSlug(q.source_type)}">${escapeHtml(q.source_type)}</span>
              <span class="diff-badge">${escapeHtml(q.difficulty || '標準')}</span>
              <span class="qid-label">${escapeHtml(q.problem_id)}</span>
            </div>

            <div class="question-stem">${renderRichText(q.question_text)}</div>

            <div id="question-input-mount" class="question-input-mount"></div>

            ${q.hint ? `
              <div class="hint-area">
                <button type="button" class="hint-toggle-btn" id="hint-toggle-btn">💡 ヒントを見る</button>
                <div class="hint-content hidden" id="hint-content">${renderRichText(q.hint)}</div>
              </div>
            ` : ''}

            <div class="quiz-submit-row" id="quiz-submit-row">
              <button type="button" class="btn btn-subject btn-lg" id="check-answer-btn" disabled>こたえあわせ</button>
            </div>

            <div id="feedback-area" class="feedback-area hidden"></div>
          </div>
        </section>
      </div>
    </div>
  `;

  // 入力UIマウント
  const mountEl = document.getElementById('question-input-mount');
  const submitBtn = document.getElementById('check-answer-btn');
  const submitRow = document.getElementById('quiz-submit-row');

  const controller = mountQuestionUI(mountEl, q, {
    onReadyChange: (ready) => {
      if (submitBtn) submitBtn.disabled = !ready;
    },
    onSelfJudge: (selfPayload) => {
      handleCheckAnswer(selfPayload);
    },
  });
  quiz.controller = controller;

  // 自己採点タイプは内蔵の判定ボタンを使うため通常の「こたえあわせ」ボタンを隠す
  if (controller.isSelfCheck) {
    submitRow.classList.add('hidden');
  }

  // イベント結線
  submitBtn?.addEventListener('click', () => handleCheckAnswer(controller.getAnswer()));

  // Enterキーで回答確定（textarea以外）
  mountEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !quiz.answered && !controller.isSelfCheck) {
      if (controller.isReady()) {
        e.preventDefault();
        handleCheckAnswer(controller.getAnswer());
      }
    }
  });

  document.getElementById('hint-toggle-btn')?.addEventListener('click', () => {
    document.getElementById('hint-content')?.classList.toggle('hidden');
  });

  document.getElementById('quiz-guide-btn')?.addEventListener('click', () => {
    openGuideModal(subj, q.unit_code, false);
  });

  document.getElementById('quiz-scratch-btn')?.addEventListener('click', toggleScratchpad);

  document.getElementById('quiz-exit-btn')?.addEventListener('click', () => {
    if (quiz.mode === 'retry' && !state.currentSubject) {
      location.hash = '#home';
    } else {
      location.hash = `#subject?grade=${encodeURIComponent(subj.grade)}&subject=${encodeURIComponent(subj.subject_key)}`;
    }
  });

  document.getElementById('toggle-vertical-inline')?.addEventListener('click', () => {
    const next = saveSettings({ verticalText: !getSettings().verticalText });
    const ctxEl = $app().querySelector('.context-text');
    ctxEl?.classList.toggle('is-vertical', next.verticalText);
    const btn = document.getElementById('toggle-vertical-inline');
    if (btn) btn.textContent = next.verticalText ? '横書きにする' : '縦書きにする';
  });

  $app().querySelectorAll('.zoomable-img').forEach((img) => {
    img.addEventListener('click', () => openLightbox(img.src, img.alt));
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleCheckAnswer(userAnswer) {
  const quiz = state.quiz;
  if (!quiz || quiz.answered) return;
  quiz.answered = true;
  quiz.controller?.disable();

  const q = quiz.questions[quiz.index];
  const scored = scoreAnswer(q, userAnswer);
  recordProblemAttempt(q.problem_id, scored.isCorrect);

  quiz.results.push({
    problem: q,
    userAnswer,
    ...scored,
  });

  const submitRow = document.getElementById('quiz-submit-row');
  submitRow?.classList.add('hidden');

  const feedbackEl = document.getElementById('feedback-area');
  const isLast = quiz.index === quiz.questions.length - 1;

  const expImgHtml = q.explanation_image && q.question_type !== 'self_check_draw'
    ? `<div class="exp-img-wrap"><img src="${escapeHtml(q.explanation_image)}" alt="解説の図" class="exp-figure zoomable-img"></div>`
    : '';

  feedbackEl.className = `feedback-area ${scored.isCorrect ? 'is-correct' : 'is-wrong'}`;
  feedbackEl.innerHTML = `
    <div class="feedback-header">
      <span class="feedback-badge">${scored.isCorrect ? '○ せいかい！' : '× おしい！'}</span>
      ${scored.isSelfCheck ? '<span class="self-tag">自己採点</span>' : ''}
    </div>
    ${!scored.isCorrect ? `
      <div class="feedback-correct-row">
        <span class="label">ただしい答え：</span>
        <strong class="correct-val">${renderRichText(scored.displayCorrectAnswer)}</strong>
      </div>
    ` : ''}
    ${q.explanation ? `
      <div class="feedback-explanation">
        <div class="exp-title">ワンポイントアドバイス</div>
        <div class="exp-body">${renderRichText(q.explanation)}</div>
      </div>
    ` : ''}
    ${expImgHtml}
    <div class="feedback-next-row">
      <button type="button" class="btn btn-primary btn-lg" id="next-question-btn">
        ${isLast ? 'けっかを見る →' : 'つぎのもんだいへ →'}
      </button>
    </div>
  `;

  feedbackEl.querySelectorAll('.zoomable-img').forEach((img) => {
    img.addEventListener('click', () => openLightbox(img.src, img.alt));
  });

  const nextBtn = document.getElementById('next-question-btn');
  nextBtn.addEventListener('click', () => {
    if (isLast) {
      finishQuizSession();
    } else {
      quiz.index++;
      renderQuizQuestion();
    }
  });
  nextBtn.focus();
  feedbackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ================= 結果・ふりかえり画面 =================

async function finishQuizSession() {
  closeScratchpad();
  const quiz = state.quiz;
  if (!quiz) return;

  const total = quiz.results.length;
  const score = quiz.results.filter((r) => r.isCorrect).length;
  const selfCheckCount = quiz.results.filter((r) => r.isSelfCheck).length;
  const wrongResults = quiz.results.filter((r) => !r.isCorrect);
  const wrongIds = wrongResults.map((r) => r.problem.problem_id);
  const durationSec = Math.max(1, Math.round((Date.now() - quiz.startedAt) / 1000));
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const mark = pct >= 80 ? 'smile' : pct >= 50 ? 'normal' : 'try';

  if (quiz.mode === 'unit') {
    recordUnitCompletion({
      grade: quiz.subject.grade,
      subjectKey: quiz.subject.subject_key,
      unitCode: quiz.unitCode,
      score,
      total,
    });
  }

  const praise =
    pct === 100
      ? 'パーフェクト！すばらしい集中力だね！'
      : pct >= 80
        ? 'よくできました！この調子で本番もバッチリ！'
        : pct >= 50
          ? 'いい調子！まちがえた問題をやり直すとさらに伸びるよ！'
          : 'がんばって最後まで取り組んだね！解説を読んで再チャレンジしよう！';

  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  const timeStr = mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;

  const reviewRowsHtml = quiz.results
    .map((r, i) => `
      <div class="result-item ${r.isCorrect ? 'is-ok' : 'is-ng'}">
        <div class="result-item-head">
          <span class="result-mark">${r.isCorrect ? '○' : '×'}</span>
          <span class="result-qnum">第${i + 1}問</span>
          <span class="result-unit-mini">${escapeHtml(r.problem.unit_name)}</span>
        </div>
        <div class="result-qtext">${renderRichText(r.problem.question_text)}</div>
        <div class="result-answers">
          <div><span class="ans-lbl">あなたの答え：</span>${renderRichText(r.displayUserAnswer)}</div>
          ${!r.isCorrect ? `<div><span class="ans-lbl">正しい答え：</span><strong>${renderRichText(r.displayCorrectAnswer)}</strong></div>` : ''}
        </div>
        ${r.problem.explanation ? `<div class="result-exp">${renderRichText(r.problem.explanation)}</div>` : ''}
      </div>
    `)
    .join('');

  $app().innerHTML = `
    <div class="result-shell" style="--subj-color: ${quiz.subject.theme_color}; --subj-bg: ${quiz.subject.theme_bg}">
      <section class="result-hero-card">
        <div class="result-mark-wrap">${renderDekitakanaSvg(mark, 84)}</div>
        <span class="quiz-subj-pill">${escapeHtml(quiz.subject.subject)}</span>
        <h1>${escapeHtml(quiz.unitName)}</h1>
        <p class="result-praise">${praise}</p>

        <div class="result-stats-grid">
          <div class="res-stat">
            <span class="res-stat-label">正答数</span>
            <span class="res-stat-val"><strong>${score}</strong> / ${total}</span>
          </div>
          <div class="res-stat">
            <span class="res-stat-label">正答率</span>
            <span class="res-stat-val"><strong>${pct}</strong>%</span>
          </div>
          <div class="res-stat">
            <span class="res-stat-label">かかった時間</span>
            <span class="res-stat-val"><strong>${timeStr}</strong></span>
          </div>
        </div>

        <div id="sync-status-bar" class="sync-status-bar is-sending">
          先生へのきろくを送信しています...
        </div>

        <div class="result-actions">
          ${wrongResults.length > 0 ? `<button type="button" class="btn btn-accent btn-lg" id="retry-wrong-btn">まちがえた ${wrongResults.length} 問だけやり直す</button>` : ''}
          <button type="button" class="btn btn-subject" id="retry-all-btn">もういちど全問やる</button>
          <a href="#subject?grade=${encodeURIComponent(quiz.subject.grade)}&subject=${encodeURIComponent(quiz.subject.subject_key)}" class="btn btn-ghost">単元一覧へもどる</a>
          <a href="#home" class="btn btn-ghost">ホームへ</a>
        </div>
      </section>

      <section class="result-review-section">
        <h2>もんだいのふりかえり</h2>
        <div class="result-list">${reviewRowsHtml}</div>
      </section>
    </div>
  `;

  document.getElementById('retry-wrong-btn')?.addEventListener('click', () => {
    beginQuizSession({
      subject: quiz.subject,
      mode: 'retry',
      unitCode: quiz.unitCode,
      unitName: `${quiz.unitName}（やり直し）`,
      questions: wrongResults.map((r) => r.problem),
    });
  });

  document.getElementById('retry-all-btn')?.addEventListener('click', () => {
    beginQuizSession({
      subject: quiz.subject,
      mode: quiz.mode,
      unitCode: quiz.unitCode,
      unitName: quiz.unitName,
      questions: quiz.questions,
    });
  });

  // 簡易スコア送信
  const syncResult = await submitScoreLog({
    subject: quiz.subject.subject,
    unitCode: quiz.unitCode,
    unitName: quiz.unitName,
    mode: quiz.mode,
    score,
    total,
    selfCheckCount,
    wrongIds,
    durationSec,
  });

  const statusBar = document.getElementById('sync-status-bar');
  if (statusBar) {
    const profile = getProfile();
    const who = formatProfileBadge(profile);
    statusBar.className = `sync-status-bar status-${syncResult.status}`;
    statusBar.textContent = `${who}：${syncResult.message}`;
  }
  updateHeaderBadges();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ================= モーダル・計算メモ・ライトボックス =================

function bindGlobalModals() {
  document.getElementById('profile-badge-btn')?.addEventListener('click', () => openProfileModal(false));
  document.getElementById('settings-btn')?.addEventListener('click', openSettingsModal);

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-backdrop')?.classList.add('hidden');
    });
  });

  // プロフィールフォーム送信
  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const schoolRaw = document.getElementById('prof-school').value;
    const check = validateSchoolCode(schoolRaw);
    const errEl = document.getElementById('prof-school-error');
    if (!check.valid) {
      errEl.textContent = check.error;
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    const grade = document.getElementById('prof-grade').value;
    const className = document.getElementById('prof-class').value;
    const studentNo = Number(document.getElementById('prof-number').value);
    saveProfile({ school_code: check.value, grade, class_name: className, student_no: studentNo });
    updateHeaderBadges();
    document.getElementById('profile-modal').classList.add('hidden');

    // 学年が切り替わった場合は即座に該当学年のデータへ切り替え
    if (grade && grade !== state.currentGrade) {
      await loadGradeBundle(grade);
      if (location.hash && !location.hash.startsWith('#home')) {
        location.hash = `#home?grade=${encodeURIComponent(grade)}`;
      } else {
        renderHomeView();
      }
    }
  });

  // 設定フォームのイベント
  document.getElementById('setting-ruby')?.addEventListener('change', (e) => {
    applySettingsToBody(saveSettings({ showRuby: e.target.checked }));
  });
  document.getElementById('setting-vertical')?.addEventListener('change', (e) => {
    saveSettings({ verticalText: e.target.checked });
  });
  document.getElementById('save-gas-url-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('setting-gas-url');
    setCustomGasApiUrl(input.value);
    clearDataCache();
    const msg = document.getElementById('setting-sync-msg');
    msg.textContent = 'URLを保存しました。最新データ取得と未送信ログ再送を試行中...';
    try {
      state.meta = await loadMeta({ forceRemote: true });
      await loadGradeBundle(state.currentGrade, { forceRemote: true });
      const flushed = await flushPendingLogQueue();
      updateHeaderBadges();
      msg.textContent = `同期完了！（未送信ログ送信: ${flushed.flushed}件 / 残り: ${flushed.remaining}件）`;
      handleRoute();
    } catch (err) {
      msg.textContent = `通信できませんでした（静的キャッシュで動作します）: ${err.message}`;
    }
  });

  document.getElementById('flush-queue-btn')?.addEventListener('click', async () => {
    const msg = document.getElementById('setting-sync-msg');
    const res = await flushPendingLogQueue();
    updateHeaderBadges();
    msg.textContent = res.flushed > 0
      ? `${res.flushed}件のきろくを先生に送信しました！（残り ${res.remaining}件）`
      : `送信できませんでした（未送信 ${res.remaining}件。GAS URLとネット接続をご確認ください）`;
  });

  document.getElementById('reset-history-btn')?.addEventListener('click', () => {
    if (confirm('この端末に保存されている学習きろくをすべて消しますか？')) {
      resetAllLearningHistory();
      document.getElementById('settings-modal').classList.add('hidden');
      renderHomeView();
    }
  });
}

function openProfileModal(isFirstVisit = false) {
  const modal = document.getElementById('profile-modal');
  const profile = getProfile();
  const gradeSelect = document.getElementById('prof-grade');
  const classSelect = document.getElementById('prof-class');
  const numSelect = document.getElementById('prof-number');

  const grades = [...new Set((state.meta?.subjects || []).map((s) => s.grade))];
  if (!grades.length) grades.push(APP_CONFIG.DEFAULT_GRADE);
  gradeSelect.innerHTML = grades.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  classSelect.innerHTML = APP_CONFIG.CLASS_OPTIONS.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  numSelect.innerHTML = Array.from({ length: APP_CONFIG.MAX_STUDENT_NO }, (_, i) => `<option value="${i + 1}">${i + 1}番</option>`).join('');

  document.getElementById('prof-school').value = profile?.school_code || '';
  gradeSelect.value = profile?.grade || state.currentGrade;
  classSelect.value = profile?.class_name || '1組';
  numSelect.value = String(profile?.student_no || 1);
  document.getElementById('prof-school-error').classList.add('hidden');
  document.getElementById('prof-skip-btn').classList.toggle('hidden', !isFirstVisit);

  modal.classList.remove('hidden');
}

function openSettingsModal() {
  const settings = getSettings();
  document.getElementById('setting-ruby').checked = settings.showRuby;
  document.getElementById('setting-vertical').checked = settings.verticalText;
  document.getElementById('setting-gas-url').value = getGasApiUrl();
  const qLen = getPendingLogQueue().length;
  document.getElementById('pending-queue-count').textContent = `${qLen} 件`;
  document.getElementById('setting-sync-msg').textContent = '';
  document.getElementById('settings-modal').classList.remove('hidden');
}

function openGuideModal(subj, unitCode, showStartBtn = true) {
  const guide = findGuide(unitCode);
  if (!guide) return;
  const modal = document.getElementById('guide-modal');
  document.getElementById('guide-modal-title').textContent = `${guide.unit_name} — 要点チェック`;
  const body = document.getElementById('guide-modal-body');
  body.innerHTML = `
    <div class="guide-block">
      <div class="guide-label">ねらい・めあて</div>
      <p>${renderRichText(guide.goal)}</p>
    </div>
    ${guide.key_points ? `
      <div class="guide-block">
        <div class="guide-label">要点チェック</div>
        <div class="guide-points">${renderRichText(guide.key_points)}</div>
      </div>
    ` : ''}
    ${guide.example_text ? `
      <div class="guide-block">
        <div class="guide-label">例題と解き方のポイント</div>
        <div class="guide-example">${renderRichText(guide.example_text)}</div>
      </div>
    ` : ''}
    ${guide.guide_image ? `<div class="guide-img-wrap"><img src="${escapeHtml(guide.guide_image)}" alt="要点図" class="guide-figure zoomable-img"></div>` : ''}
  `;
  body.querySelectorAll('.zoomable-img').forEach((img) => {
    img.addEventListener('click', () => openLightbox(img.src, img.alt));
  });

  const startBtn = document.getElementById('guide-start-btn');
  startBtn.classList.toggle('hidden', !showStartBtn);
  startBtn.onclick = () => {
    modal.classList.add('hidden');
    location.hash = `#drill?grade=${encodeURIComponent(subj.grade)}&subject=${encodeURIComponent(subj.subject_key)}&unit=${encodeURIComponent(unitCode)}`;
  };
  modal.classList.remove('hidden');
}

function openLightbox(src, alt = '') {
  const lb = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  img.src = src;
  img.alt = alt;
  img.style.transform = 'scale(1)';
  document.getElementById('lightbox-zoom-range').value = '100';
  lb.classList.remove('hidden');
}

function bindScratchpad() {
  const overlay = document.getElementById('scratchpad-overlay');
  const cv = document.getElementById('scratchpad-canvas');
  if (!overlay || !cv) return;

  state.scratchCanvas = new DrawingCanvas(cv, { mode: 'free', color: '#1E293B', lineWidth: 3 });

  overlay.querySelectorAll('[data-pen-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.scratchCanvas.setColor(btn.dataset.penColor);
      overlay.querySelectorAll('[data-pen-color], #scratch-eraser').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  document.getElementById('scratch-eraser')?.addEventListener('click', (e) => {
    state.scratchCanvas.setMode('eraser');
    overlay.querySelectorAll('[data-pen-color]').forEach((b) => b.classList.remove('is-active'));
    e.currentTarget.classList.add('is-active');
  });
  document.getElementById('scratch-undo')?.addEventListener('click', () => state.scratchCanvas.undo());
  document.getElementById('scratch-clear')?.addEventListener('click', () => state.scratchCanvas.clear());
  document.getElementById('scratch-close')?.addEventListener('click', closeScratchpad);

  document.getElementById('lightbox-zoom-range')?.addEventListener('input', (e) => {
    const scale = Number(e.target.value) / 100;
    const img = document.getElementById('lightbox-img');
    if (img) img.style.transform = `scale(${scale})`;
  });

  window.addEventListener('resize', () => {
    if (state.scratchOpen) state.scratchCanvas?.resize();
    state.quiz?.controller?.resizeCanvases?.();
  });
}

function toggleScratchpad() {
  const overlay = document.getElementById('scratchpad-overlay');
  if (!overlay) return;
  state.scratchOpen = !state.scratchOpen;
  overlay.classList.toggle('hidden', !state.scratchOpen);
  if (state.scratchOpen) {
    requestAnimationFrame(() => state.scratchCanvas?.resize());
  }
}

function closeScratchpad() {
  state.scratchOpen = false;
  document.getElementById('scratchpad-overlay')?.classList.add('hidden');
}

// ================= ヘルパー =================

function applySettingsToBody(settings) {
  document.body.classList.toggle('hide-ruby', !settings.showRuby);
}

function updateHeaderBadges() {
  const profile = getProfile();
  const badgeText = document.getElementById('profile-badge-text');
  if (badgeText) badgeText.textContent = formatProfileBadge(profile);

  const qLen = getPendingLogQueue().length;
  const qBadge = document.getElementById('header-queue-badge');
  if (qBadge) {
    qBadge.textContent = `未送信 ${qLen}`;
    qBadge.classList.toggle('hidden', qLen === 0 || !getGasApiUrl());
  }
}

function groupUnits(questions) {
  const map = new Map();
  questions.forEach((q) => {
    if (!map.has(q.unit_code)) {
      map.set(q.unit_code, {
        unit_code: q.unit_code,
        unit_order: Number(q.unit_order) || 999,
        unit_name: q.unit_name,
        questions: [],
      });
    }
    map.get(q.unit_code).questions.push(q);
  });
  return [...map.values()].sort((a, b) => a.unit_order - b.unit_order);
}

function findGuide(unitCode) {
  return state.guides.find((g) => g.unit_code === unitCode) || null;
}

function sourceSlug(sourceType) {
  if (sourceType === 'フォローアップ') return 'followup';
  if (sourceType === 'たしかめドリル') return 'drill';
  return 'challenge';
}

document.addEventListener('DOMContentLoaded', init);
