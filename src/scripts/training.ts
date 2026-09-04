export interface QuizTerm {
  slug: string;
  titleJa: string;
  titleEn: string;
  tags: string[];
  prompt: string;
}

type Direction = 'term-to-meaning' | 'meaning-to-term';

interface Question {
  term: QuizTerm;
  direction: Direction;
  choices: QuizTerm[];
  correctIndex: number;
}

interface Session {
  questions: Question[];
  index: number;
  correct: number;
  wrongThisRun: Set<string>;
  answered: boolean;
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

  const progressText = document.getElementById('training-progress-text');
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

  function showSection(target: 'setup' | 'quiz' | 'result'): void {
    setupSection!.hidden = target !== 'setup';
    quizSection!.hidden = target !== 'quiz';
    resultSection!.hidden = target !== 'result';
    if (target === 'setup') updateWeakUi();
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

  function runSession(askedPool: QuizTerm[]): void {
    if (askedPool.length === 0) {
      if (setupError) {
        setupError.textContent = '対象の用語が0件です。タグの選択や「苦手な用語だけ」の設定を見直してください。';
        setupError.hidden = false;
      }
      return;
    }
    if (setupError) setupError.hidden = true;

    const desiredCount = Number(countSelect?.value ?? 10) || 10;
    const count = Math.min(desiredCount, askedPool.length);
    const questions = buildQuestions(askedPool, allTerms, count);
    session = { questions, index: 0, correct: 0, wrongThisRun: new Set(), answered: false };
    showSection('quiz');
    renderQuestion();
  }

  function choiceLabel(term: QuizTerm, direction: Direction): string {
    return direction === 'term-to-meaning' ? term.prompt : term.titleJa;
  }

  function renderQuestion(): void {
    if (!session) return;
    const q = session.questions[session.index];
    if (!q) return;

    if (progressText) {
      progressText.textContent = `${session.index + 1} / ${session.questions.length}`;
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
    }
    nextBtn!.hidden = true;
  }

  function onChoiceClick(idx: number): void {
    if (!session || session.answered) return;
    const q = session.questions[session.index];
    if (!q) return;
    session.answered = true;

    const buttons = Array.from(choicesEl!.querySelectorAll<HTMLButtonElement>('.training-choice'));
    buttons.forEach((b) => (b.disabled = true));

    const isCorrect = idx === q.correctIndex;
    if (isCorrect) {
      session.correct++;
      weakSlugs.delete(q.term.slug);
    } else {
      session.wrongThisRun.add(q.term.slug);
      weakSlugs.add(q.term.slug);
      buttons[idx]?.classList.add('is-wrong');
    }
    buttons[q.correctIndex]?.classList.add('is-correct');
    saveWeakSlugs(Array.from(weakSlugs));

    if (feedbackEl) {
      const correctLabel = choiceLabel(q.term, q.direction);
      const detailHref = `${termsBaseHref}${q.term.slug}/`;
      feedbackEl.innerHTML = isCorrect
        ? `正解！ 「${escapeHtml(correctLabel)}」`
        : `不正解。正解は「${escapeHtml(correctLabel)}」でした。`;
      const link = document.createElement('a');
      link.href = detailHref;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'training-feedback-link';
      link.textContent = 'この用語の詳細を見る →';
      feedbackEl.appendChild(document.createElement('br'));
      feedbackEl.appendChild(link);
      feedbackEl.hidden = false;
      feedbackEl.classList.toggle('is-correct', isCorrect);
      feedbackEl.classList.toggle('is-wrong', !isCorrect);
    }
    nextBtn!.hidden = false;
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

  function onNextClick(): void {
    if (!session) return;
    session.index++;
    if (session.index >= session.questions.length) {
      finishSession();
    } else {
      session.answered = false;
      renderQuestion();
    }
  }

  function finishSession(): void {
    if (!session) return;
    updateWeakUi();
    showSection('result');

    if (scoreEl) {
      scoreEl.textContent = `${session.correct} / ${session.questions.length} 問正解`;
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

  startBtn.addEventListener('click', () => runSession(getPool()));
  nextBtn.addEventListener('click', onNextClick);
  retrySameBtn?.addEventListener('click', () => runSession(getPool()));
  retryWeakBtn?.addEventListener('click', () => {
    if (!session) return;
    const wrongTerms = allTerms.filter((t) => session!.wrongThisRun.has(t.slug));
    runSession(wrongTerms);
  });
  backBtn?.addEventListener('click', () => showSection('setup'));

  updateWeakUi();
}
