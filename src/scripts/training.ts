export interface QuizTerm {
  slug: string;
  titleJa: string;
  titleEn: string;
  tags: string[];
  prompt: string;
}

type Direction = 'term-to-meaning' | 'meaning-to-term';
type Mode = 'normal' | 'time-attack-total' | 'time-attack-per-question';

interface Question {
  term: QuizTerm;
  direction: Direction;
  choices: QuizTerm[];
  correctIndex: number;
}

interface Session {
  mode: Mode;
  questions: Question[];
  askedPool: QuizTerm[];
  index: number;
  correct: number;
  completedCount: number;
  wrongThisRun: Set<string>;
  answered: boolean;
  firstAttemptPending: boolean;
  startedAt: number;
  totalTimeLimitSec?: number;
  perQuestionTimeLimitSec?: number;
  sessionDeadline?: number;
  questionDeadline?: number;
  timerHandle?: number;
}

const WEAK_STORAGE_KEY = 'tld-training-weak-v1';

function loadWeakSlugs(): string[] {
  try {
    const raw = localStorage.getItem(WEAK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveWeakSlugs(slugs: string[]): void {
  try {
    localStorage.setItem(WEAK_STORAGE_KEY, JSON.stringify(slugs));
  } catch {
    /* ignore（プライベートモード等で保存できない場合は無視） */
  }
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildQuestions(
  askedPool: QuizTerm[],
  allTerms: QuizTerm[],
  count: number,
): Question[] {
  const picked = shuffle(askedPool).slice(0, Math.min(count, askedPool.length));
  return picked.map((term) => {
    const direction: Direction = Math.random() < 0.5 ? 'term-to-meaning' : 'meaning-to-term';
    const distractorSource = allTerms.filter((t) => t.slug !== term.slug);
    const distractors = shuffle(distractorSource).slice(0, 3);
    const choices = shuffle([term, ...distractors]);
    const correctIndex = choices.findIndex((c) => c.slug === term.slug);
    return { term, direction, choices, correctIndex };
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function initTraining(): void {
  const dataEl = document.getElementById('training-data');
  if (!dataEl) return;

  let allTerms: QuizTerm[] = [];
  try {
    allTerms = JSON.parse(dataEl.textContent || '[]');
  } catch {
    allTerms = [];
  }
  if (allTerms.length === 0) return;

  const termsBaseHref = dataEl.getAttribute('data-terms-base') || '';

  const setupSection = document.getElementById('training-setup');
  const quizSection = document.getElementById('training-quiz');
  const resultSection = document.getElementById('training-result');
  const startBtn = document.getElementById('training-start-btn');
  const setupError = document.getElementById('training-setup-error');
  const weakOnlyCheckbox = document.getElementById('weak-only') as HTMLInputElement | null;
  const weakCountEl = document.getElementById('weak-count');
  const countSelect = document.getElementById('training-count') as HTMLSelectElement | null;
  const totalTimeSelect = document.getElementById('training-total-time') as HTMLSelectElement | null;
  const perQuestionTimeSelect = document.getElementById(
    'training-per-question-time',
  ) as HTMLSelectElement | null;
  const countBlock = document.getElementById('count-block');
  const totalTimeBlock = document.getElementById('total-time-block');
  const perQuestionTimeBlock = document.getElementById('per-question-time-block');

  const progressText = document.getElementById('training-progress-text');
  const timerEl = document.getElementById('training-timer');
  const directionHint = document.getElementById('training-direction-hint');
  const instructionEl = document.getElementById('training-instruction');
  const promptEl = document.getElementById('training-prompt');
  const choicesEl = document.getElementById('training-choices');
  const feedbackEl = document.getElementById('training-feedback');
  const nextBtn = document.getElementById('training-next-btn');

  const scoreEl = document.getElementById('training-score');
  const missedWrap = document.getElementById('training-missed-wrap');
  const missedListEl = document.getElementById('training-missed-list');
  const retrySameBtn = document.getElementById('training-retry-same-btn');
  const retryWeakBtn = document.getElementById('training-retry-weak-btn');
  const backBtn = document.getElementById('training-back-btn');

  if (
    !setupSection ||
    !quizSection ||
    !resultSection ||
    !startBtn ||
    !choicesEl ||
    !promptEl ||
    !nextBtn
  ) {
    return;
  }

  const weakSlugs = new Set<string>(loadWeakSlugs().filter((s) => allTerms.some((t) => t.slug === s)));
  let session: Session | null = null;

  function updateWeakUi(): void {
    if (weakCountEl) weakCountEl.textContent = String(weakSlugs.size);
    if (weakOnlyCheckbox) {
      weakOnlyCheckbox.disabled = weakSlugs.size === 0;
      if (weakSlugs.size === 0) weakOnlyCheckbox.checked = false;
    }
  }

  function getSelectedMode(): Mode {
    const checked = document.querySelector<HTMLInputElement>('input[name="training-mode"]:checked');
    const v = checked?.value;
    if (v === 'time-attack-total' || v === 'time-attack-per-question') return v;
    return 'normal';
  }

  function updateModeVisibility(): void {
    const mode = getSelectedMode();
    if (countBlock) countBlock.hidden = mode === 'time-attack-total';
    if (totalTimeBlock) totalTimeBlock.hidden = mode !== 'time-attack-total';
    if (perQuestionTimeBlock) perQuestionTimeBlock.hidden = mode !== 'time-attack-per-question';
  }

  function showSection(target: 'setup' | 'quiz' | 'result'): void {
    setupSection!.hidden = target !== 'setup';
    quizSection!.hidden = target !== 'quiz';
    resultSection!.hidden = target !== 'result';
    if (target === 'setup') {
      updateWeakUi();
      updateModeVisibility();
    }
  }

  function getSelectedTags(): string[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>('.training-tag-check:checked')).map(
      (el) => el.value,
    );
  }

  function getPool(): QuizTerm[] {
    if (weakOnlyCheckbox?.checked) {
      return allTerms.filter((t) => weakSlugs.has(t.slug));
    }
    const selectedTags = getSelectedTags();
    if (selectedTags.length === 0) return allTerms;
    return allTerms.filter((t) => t.tags.some((tag) => selectedTags.includes(tag)));
  }

  function clearTimer(): void {
    if (session?.timerHandle !== undefined) {
      window.clearInterval(session.timerHandle);
      session.timerHandle = undefined;
    }
  }

  function updateTimerDisplay(remainSec: number | null): void {
    if (!timerEl) return;
    if (remainSec === null) {
      timerEl.textContent = '';
      timerEl.hidden = true;
      return;
    }
    timerEl.hidden = false;
    timerEl.textContent = `残り ${remainSec}秒`;
  }

  function tick(): void {
    if (!session) return;
    const now = Date.now();
    if (session.mode === 'time-attack-total' && session.sessionDeadline !== undefined) {
      const remain = Math.max(0, Math.ceil((session.sessionDeadline - now) / 1000));
      updateTimerDisplay(remain);
      if (remain <= 0) {
        clearTimer();
        finishSession();
      }
    } else if (session.mode === 'time-attack-per-question' && session.questionDeadline !== undefined) {
      const remain = Math.max(0, Math.ceil((session.questionDeadline - now) / 1000));
      updateTimerDisplay(remain);
      if (remain <= 0) {
        clearTimer();
        onQuestionTimeout();
      }
    }
  }

  function extendQuestions(s: Session): void {
    const more = buildQuestions(s.askedPool, allTerms, s.askedPool.length);
    s.questions.push(...more);
  }

  function runSession(askedPool: QuizTerm[], mode: Mode): void {
    if (askedPool.length === 0) {
      if (setupError) {
        setupError.textContent = '対象の用語が0件です。タグの選択や「苦手な用語だけ」の設定を見直してください。';
        setupError.hidden = false;
      }
      return;
    }
    if (setupError) setupError.hidden = true;

    clearTimer();

    let questions: Question[];
    let totalTimeLimitSec: number | undefined;
    let perQuestionTimeLimitSec: number | undefined;

    if (mode === 'time-attack-total') {
      totalTimeLimitSec = Number(totalTimeSelect?.value ?? 60) || 60;
      questions = buildQuestions(askedPool, allTerms, askedPool.length);
    } else if (mode === 'time-attack-per-question') {
      perQuestionTimeLimitSec = Number(perQuestionTimeSelect?.value ?? 10) || 10;
      const desiredCount = Number(countSelect?.value ?? 10) || 10;
      questions = buildQuestions(askedPool, allTerms, Math.min(desiredCount, askedPool.length));
    } else {
      const desiredCount = Number(countSelect?.value ?? 10) || 10;
      questions = buildQuestions(askedPool, allTerms, Math.min(desiredCount, askedPool.length));
    }

    session = {
      mode,
      questions,
      askedPool,
      index: 0,
      correct: 0,
      completedCount: 0,
      wrongThisRun: new Set(),
      answered: false,
      firstAttemptPending: true,
      startedAt: Date.now(),
      totalTimeLimitSec,
      perQuestionTimeLimitSec,
    };

    if (mode === 'time-attack-total') {
      session.sessionDeadline = Date.now() + totalTimeLimitSec! * 1000;
    }

    showSection('quiz');
    renderQuestion();

    if (mode !== 'normal') {
      session.timerHandle = window.setInterval(tick, 200);
    }
  }

  function choiceLabel(term: QuizTerm, direction: Direction): string {
    return direction === 'term-to-meaning' ? term.prompt : term.titleJa;
  }

  function renderQuestion(): void {
    if (!session) return;
    const q = session.questions[session.index];
    if (!q) return;

    session.answered = false;
    session.firstAttemptPending = true;

    if (progressText) {
      if (session.mode === 'time-attack-total') {
        progressText.textContent = `${session.completedCount + 1}問目`;
      } else {
        progressText.textContent = `${session.index + 1} / ${session.questions.length}`;
      }
    }

    if (session.mode === 'time-attack-per-question') {
      session.questionDeadline = Date.now() + session.perQuestionTimeLimitSec! * 1000;
      updateTimerDisplay(session.perQuestionTimeLimitSec!);
    } else if (session.mode === 'time-attack-total') {
      const remain = session.sessionDeadline
        ? Math.max(0, Math.ceil((session.sessionDeadline - Date.now()) / 1000))
        : null;
      updateTimerDisplay(remain);
    } else {
      updateTimerDisplay(null);
    }

    if (directionHint) {
      directionHint.textContent =
        q.direction === 'term-to-meaning' ? '略語 → 意味' : '意味 → 略語';
    }
    if (instructionEl) {
      instructionEl.textContent =
        q.direction === 'term-to-meaning' ? 'この略語の意味は？' : '次の説明に当てはまる略語は？';
    }
    if (promptEl) {
      promptEl.textContent =
        q.direction === 'term-to-meaning'
          ? `${q.term.titleJa}（${q.term.titleEn}）`
          : q.term.prompt;
    }

    choicesEl!.innerHTML = '';
    q.choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'training-choice';
      btn.dataset.index = String(idx);
      btn.textContent = choiceLabel(choice, q.direction);
      btn.addEventListener('click', () => onChoiceClick(idx));
      choicesEl!.appendChild(btn);
    });

    if (feedbackEl) {
      feedbackEl.hidden = true;
      feedbackEl.innerHTML = '';
      feedbackEl.classList.remove('is-correct', 'is-wrong');
    }
    nextBtn!.hidden = true;

    if (session.mode === 'time-attack-total') {
      // 出題が尽きないよう、残りが少なくなったら先読みで継ぎ足す
      if (session.index >= session.questions.length - 3) {
        extendQuestions(session);
      }
    }
  }

  function showFeedback(kind: 'correct' | 'retry' | 'timeout', q: Question): void {
    if (!feedbackEl) return;
    feedbackEl.classList.remove('is-correct', 'is-wrong');

    if (kind === 'retry') {
      feedbackEl.textContent = '不正解。もう一度選んでください。';
      feedbackEl.classList.add('is-wrong');
      feedbackEl.hidden = false;
      return;
    }

    const correctLabel = choiceLabel(q.term, q.direction);
    const detailHref = `${termsBaseHref}${q.term.slug}/`;
    feedbackEl.innerHTML =
      kind === 'correct'
        ? `正解！ 「${escapeHtml(correctLabel)}」`
        : `時間切れ。正解は「${escapeHtml(correctLabel)}」でした。`;
    const link = document.createElement('a');
    link.href = detailHref;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'training-feedback-link';
    link.textContent = 'この用語の詳細を見る →';
    feedbackEl.appendChild(document.createElement('br'));
    feedbackEl.appendChild(link);
    feedbackEl.hidden = false;
    feedbackEl.classList.add(kind === 'correct' ? 'is-correct' : 'is-wrong');
  }

  function onChoiceClick(idx: number): void {
    if (!session) return;
    const q = session.questions[session.index];
    if (!q || session.answered) return;

    const buttons = Array.from(choicesEl!.querySelectorAll<HTMLButtonElement>('.training-choice'));
    const btn = buttons[idx];
    if (!btn || btn.disabled) return;

    if (idx === q.correctIndex) {
      session.answered = true;
      session.completedCount++;
      buttons.forEach((b) => (b.disabled = true));
      btn.classList.add('is-correct');

      if (session.firstAttemptPending) {
        session.correct++;
        weakSlugs.delete(q.term.slug);
        saveWeakSlugs(Array.from(weakSlugs));
        updateWeakUi();
      }

      showFeedback('correct', q);

      if (session.mode === 'normal') {
        nextBtn!.hidden = false;
      } else {
        nextBtn!.hidden = true;
        const modeAtClick = session.mode;
        window.setTimeout(() => {
          if (session && session.mode === modeAtClick) onNextClick();
        }, 650);
      }
    } else {
      btn.disabled = true;
      btn.classList.add('is-wrong');

      if (session.firstAttemptPending) {
        session.wrongThisRun.add(q.term.slug);
        weakSlugs.add(q.term.slug);
        saveWeakSlugs(Array.from(weakSlugs));
        session.firstAttemptPending = false;
        updateWeakUi();
      }

      showFeedback('retry', q);
    }
  }

  function onQuestionTimeout(): void {
    if (!session || session.answered) return;
    const q = session.questions[session.index];
    if (!q) return;

    session.answered = true;
    session.completedCount++;

    if (session.firstAttemptPending) {
      session.wrongThisRun.add(q.term.slug);
      weakSlugs.add(q.term.slug);
      saveWeakSlugs(Array.from(weakSlugs));
      updateWeakUi();
    }

    const buttons = Array.from(choicesEl!.querySelectorAll<HTMLButtonElement>('.training-choice'));
    buttons.forEach((b) => (b.disabled = true));
    buttons[q.correctIndex]?.classList.add('is-correct');

    showFeedback('timeout', q);
    nextBtn!.hidden = true;

    const modeAtClick = session.mode;
    window.setTimeout(() => {
      if (session && session.mode === modeAtClick) onNextClick();
    }, 1400);
  }

  function onNextClick(): void {
    if (!session) return;
    session.index++;

    if (session.mode === 'time-attack-total') {
      // 時間切れ以外では終了しない（出題は継ぎ足され続ける）
      renderQuestion();
      return;
    }

    if (session.index >= session.questions.length) {
      finishSession();
    } else {
      renderQuestion();
    }
  }

  function finishSession(): void {
    if (!session) return;
    clearTimer();
    updateWeakUi();
    showSection('result');

    const elapsedSec = Math.round((Date.now() - session.startedAt) / 1000);
    if (scoreEl) {
      if (session.mode === 'time-attack-total') {
        scoreEl.textContent = `${session.totalTimeLimitSec}秒で ${session.correct}問正解（挑戦 ${session.completedCount}問）`;
      } else if (session.mode === 'time-attack-per-question') {
        scoreEl.textContent = `${session.correct} / ${session.questions.length} 問正解（合計 ${elapsedSec}秒）`;
      } else {
        scoreEl.textContent = `${session.correct} / ${session.questions.length} 問正解`;
      }
    }

    const wrongTerms = allTerms.filter((t) => session!.wrongThisRun.has(t.slug));
    if (missedListEl) missedListEl.innerHTML = '';
    if (missedWrap) missedWrap.hidden = wrongTerms.length === 0;
    if (missedListEl) {
      wrongTerms.forEach((t) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `${termsBaseHref}${t.slug}/`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = t.titleJa;
        li.appendChild(a);
        li.appendChild(document.createTextNode(` — ${t.prompt}`));
        missedListEl.appendChild(li);
      });
    }

    if (retryWeakBtn) retryWeakBtn.hidden = wrongTerms.length === 0;
  }

  startBtn.addEventListener('click', () => runSession(getPool(), getSelectedMode()));
  nextBtn.addEventListener('click', onNextClick);
  retrySameBtn?.addEventListener('click', () => runSession(getPool(), getSelectedMode()));
  retryWeakBtn?.addEventListener('click', () => {
    if (!session) return;
    const wrongTerms = allTerms.filter((t) => session!.wrongThisRun.has(t.slug));
    runSession(wrongTerms, 'normal');
  });
  backBtn?.addEventListener('click', () => {
    clearTimer();
    showSection('setup');
  });

  document.querySelectorAll<HTMLInputElement>('input[name="training-mode"]').forEach((el) => {
    el.addEventListener('change', updateModeVisibility);
  });

  updateWeakUi();
  updateModeVisibility();
}
