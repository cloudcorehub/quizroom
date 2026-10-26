const root = document.querySelector('#app');
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const symbols = ['▲', '◆', '●', '■'];
const storage = { get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Your browser could not save this draft. Export a copy to keep it.'); } } };
let quizzes = [], state, session, stream, clockOffset = 0, answerBusy = false, editorIndex = 0, toastTimer, selectedChoice = null;
let draft = storage.get('quizroom-draft') || { title: 'My brilliant quiz', questions: [{ text: '', options: ['', '', '', ''], correct: 0, seconds: 20 }] };
const logo = '<a class="brand" href="/" aria-label="Quizroom home"><span class="brand-icon">q<span>•</span></span>quizroom<span class="brand-dot">.</span></a>';
const header = (right = '<button class="button dark small" data-do="editor">Create a quiz <span>＋</span></button>') => `<header class="site-header">${logo}<div class="header-right">${right}</div></header>`;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
async function request(url, data, token) {
  const response = await fetch(url, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not connect. Please retry.'); return result;
}
function home(pin = '') {
  stream?.close(); state = null; session = null; document.body.className = '';
  root.innerHTML = `${header('<span class="nav-caption">Good company. Great questions.</span><button class="button dark small" data-do="editor">Create a quiz <span>＋</span></button>')}
    <main class="home-main">
      <section class="hero">
        <div class="hero-copy"><span class="eyebrow"><span class="live-dot"></span> MAKE ROOM FOR A LITTLE FUN</span>
          <h1>A little friendly<br><span>competition.</span></h1>
          <p>Bring your people together. Pick a quiz, share a PIN,<br class="desktop-break"> and let the good guesses begin.</p>
          <div class="hero-actions"><button class="button lime" data-do="browse">Host a game <span>↗</span></button><span class="hero-note">No accounts.<br>Just good questions.</span></div>
          <div class="hero-shapes" aria-hidden="true"><span>▲</span><span>◆</span><span>●</span><span>■</span></div>
        </div>
        <div class="join-panel"><div class="join-kicker">GOT AN INVITE?</div><h2>You’re in the <br>right room.</h2><p>Enter the game PIN from your host.</p>
          <form id="join-form"><label class="sr-only" for="pin">Game PIN</label><input id="pin" name="pin" class="pin-input" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" placeholder="Game PIN" value="${escape(pin)}" required>
          <div id="nickname-slot"></div><p id="join-error" class="form-error" role="alert"></p><button class="button dark full" id="join-submit">Let’s go <span>→</span></button></form>
          <div class="join-foot"><span class="tiny-shapes">▲ ◆ ● ■</span><span>One room. Everyone’s invited.</span></div>
        </div>
      </section>
      <section id="quizzes" class="library"><div class="section-heading"><div><span class="eyebrow">READY WHEN YOU ARE</span><h2>Pick a quiz. Make their day.</h2></div><span class="library-caption">A few crowd-pleasers to get you started</span></div>
        <div class="quiz-grid">${quizzes.map((quiz, index) => `<article class="quiz-card"><div class="quiz-art ${quiz.color}"><span class="quiz-category">${quiz.category}</span><span class="art-symbol" aria-hidden="true">${quiz.icon}</span><span class="count-pill">${quiz.questions.length} questions</span></div><div class="quiz-content"><h3>${escape(quiz.title)}</h3><p>${escape(quiz.description)}</p><button class="card-link" data-do="host" data-index="${index}">Host this quiz <span>↗</span></button></div></article>`).join('')}</div>
      </section><section class="create-strip"><div class="strip-symbol" aria-hidden="true">✎</div><div><h3>Your inside jokes deserve a quiz.</h3><p>Write your own questions. Make it unmistakably yours.</p></div><button class="button outline" data-do="editor">Make your own <span>＋</span></button></section>
    </main><footer class="site-footer"><span>A little curiosity goes a long way.</span><span>Made for playing together <span class="green-spark">✳</span></span></footer>`;
  $('#join-form').addEventListener('submit', join);
  $('#pin').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); if ($('#nickname')) { $('#nickname-slot').innerHTML = ''; $('#join-submit').innerHTML = 'Let’s go <span>→</span>'; } });
}
async function join(event) {
  event.preventDefault(); const pin = $('#pin').value.trim(); $('#join-error').textContent = '';
  if (!/^\d{6}$/.test(pin)) { $('#join-error').textContent = 'Enter the six-digit PIN from your host.'; return; }
  if (!$('#nickname')) { $('#nickname-slot').innerHTML = '<label for="nickname">What should we call you?</label><input id="nickname" name="nickname" maxlength="24" placeholder="Your nickname" autocomplete="nickname" required>'; $('#join-submit').innerHTML = 'Join the room <span>→</span>'; $('#nickname').focus(); return; }
  $('#join-submit').disabled = true;
  try { const result = await request(`/api/rooms/${pin}/join`, { name: $('#nickname').value }); enter('play', result); }
  catch (error) { $('#join-error').textContent = error.message; $('#join-submit').disabled = false; }
}
async function host(quiz) {
  const result = await request('/api/rooms', { quiz }); enter('host', result);
}
function enter(role, result) {
  sessionStorage.setItem(`quizroom:${role}:${result.pin}`, result.token);
  history.pushState({}, '', `/${role}/${result.pin}`); connect(role, result.pin, result.token);
}
async function connect(role, pin, token) {
  stream?.close(); session = { role, pin, token }; root.innerHTML = '<div class="loading">Getting the room ready…</div>';
  try { const initial = await request(`/api/rooms/${pin}/state`, undefined, token); update(initial); }
  catch (error) { home(pin); toast(error.message); return; }
  stream = new EventSource(`/api/rooms/${pin}/events?token=${encodeURIComponent(token)}`);
  stream.onmessage = event => { update(JSON.parse(event.data)); const indicator = $('#connection'); if (indicator) indicator.textContent = 'LIVE'; };
  stream.onerror = () => { const indicator = $('#connection'); if (indicator) indicator.textContent = 'RECONNECTING…'; };
}
function update(next) {
  if (state?.index !== next.index || state?.phase !== next.phase) { answerBusy = false; selectedChoice = null; }
  state = next; clockOffset = next.serverTime - Date.now(); renderGame();
}
function gameHeader() {
  return header(`<span class="connection"><i></i><span id="connection">LIVE</span></span><span class="room-tag">PIN <strong>${state.pin}</strong></span><a class="exit-link" href="/">Leave <span>↗</span></a>`);
}
function renderGame() {
  const hostView = state.role === 'host'; document.body.className = `game-body phase-${state.phase}`;
  const renderers = { lobby, countdown, question, reveal, leaderboard, podium };
  root.innerHTML = `${gameHeader()}<main class="game-main">${renderers[state.phase](hostView)}</main><footer class="game-footer"><span>${escape(state.title)}</span><span>${hostView ? 'HOST SCREEN' : escape(state.me.name)}${state.index >= 0 ? ` · ${Math.max(1, state.index + 1)} / ${state.total}` : ''}</span></footer>`;
  tick();
}
function lobby(hostView) {
  if (!hostView) return `<section class="center-stage"><div class="orbit-mark">✳</div><span class="eyebrow">YOU’RE IN, ${escape(state.me.name).toUpperCase()}!</span><h1>Good company.<br>Great guesses ahead.</h1><p>Get comfortable. Your host will start the game soon.</p><div class="waiting-dots" aria-label="Waiting"><i></i><i></i><i></i></div><span class="soft-pill">${state.playerCount} ${state.playerCount === 1 ? 'player' : 'players'} in the room</span></section>`;
  return `<section class="lobby-stage"><div class="lobby-heading"><span class="eyebrow">BRING YOUR PEOPLE TOGETHER</span><h1>The room is open.</h1><p>${['localhost', '127.0.0.1'].includes(location.hostname) ? 'Open a player screen on this computer and enter' : `Open <strong>${escape(location.host)}</strong> on another device and enter`}</p></div><div class="big-pin" aria-label="Game PIN ${state.pin}">${state.pin.slice(0, 3)}<span> </span>${state.pin.slice(3)}</div><div class="lobby-tools"><button class="button ghost small" data-do="copy">Copy join link ↗</button><a class="button ghost small" href="/play/${state.pin}" target="_blank" rel="noopener">Open player screen ↗</a><button class="button ghost small" data-do="lock">${state.locked ? 'Unlock room' : 'Lock room'}</button></div><div class="players-heading"><span><strong>${state.playerCount}</strong> ${state.playerCount === 1 ? 'player' : 'players'} ready</span><span>${state.locked ? 'Room locked' : 'Waiting for the whole crew'}</span></div><div class="player-cloud">${state.players.length ? state.players.map((p, i) => `<div class="player-chip"><span class="avatar a${i % 4}">${symbols[i % 4]}</span>${escape(p.name)}</div>`).join('') : '<div class="empty-room"><span>◎</span><p>Your players will appear here.<br>Share the PIN to get the party started.</p></div>'}</div><button class="button lime start-button" data-do="start" ${!state.playerCount ? 'disabled' : ''}>Everybody in? Let’s play <span>→</span></button><p class="lobby-small">${state.total} ${state.total === 1 ? 'question' : 'questions'} · ${escape(state.title)}</p></section>`;
}
function countdown() { return `<section class="center-stage"><span class="eyebrow">QUESTION ${state.index + 1} OF ${state.total}</span><h1>Heads up. Brains on.</h1><div class="countdown-number" data-countdown>3</div><p>Your next question is coming up.</p></section>`; }
function answers({ interactive = false, showCorrect = false } = {}) {
  return `<div class="answer-grid">${state.question.options.map((answer, i) => `<${interactive ? 'button' : 'div'} class="answer answer-${i}${showCorrect && state.question.correct === i ? ' is-correct' : ''}${showCorrect && state.question.correct !== i ? ' is-dim' : ''}" ${interactive ? `data-do="answer" data-choice="${i}" ${state.me.answered || answerBusy ? 'disabled' : ''}` : ''}><span class="answer-symbol" aria-hidden="true">${symbols[i]}</span><span>${escape(answer)}</span>${showCorrect && state.question.correct === i ? '<span class="correct-mark">✓</span>' : `<span class="answer-key">${i + 1}</span>`}</${interactive ? 'button' : 'div'}>`).join('')}</div>`;
}
function question(hostView) {
  if (!hostView && state.me.answered) return `<section class="center-stage"><div class="orbit-mark lime-mark">✓</div><span class="eyebrow">ANSWER LOCKED IN</span><h1>Trust your gut.</h1><p>Waiting for the rest of the room…</p><span class="soft-pill">${state.answeredCount} of ${state.playerCount} answered</span><div class="mini-timer" data-timer></div></section>`;
  return `<section class="question-stage"><div class="question-top"><span class="eyebrow">QUESTION ${state.index + 1} / ${state.total}</span><span class="soft-pill">${state.answeredCount} / ${state.playerCount} answered</span></div><h1>${escape(state.question.text)}</h1><div class="question-middle"><div class="timer" data-timer aria-label="Seconds remaining"></div><div class="question-art" aria-hidden="true">${symbols[state.index % 4]}<span>?</span></div>${hostView ? '<button class="button ghost small" data-do="reveal">Reveal answer →</button>' : '<span class="answer-prompt">Make your<br>best guess.</span>'}</div><div class="time-track"><div id="time-fill"></div></div>${answers({ interactive: !hostView })}${!hostView ? '<p class="keyboard-tip">Tap an answer, or use keys 1–4.</p>' : ''}</section>`;
}
function reveal(hostView) {
  const result = state.me?.result;
  return `<section class="question-stage"><div class="question-top"><span class="eyebrow">THE ANSWER IS IN</span><span class="soft-pill">QUESTION ${state.index + 1} / ${state.total}</span></div><h1>${hostView ? 'A little wiser already.' : result?.correct ? 'You nailed it!' : result?.choice == null ? 'Time got away.' : 'That’s one to remember.'}</h1>${hostView ? `<div class="distribution">${state.distribution.map((count, i) => `<div class="bar-column"><span>${count}</span><div class="bar answer-${i}" style="height:${24 + count / Math.max(1, state.playerCount) * 120}px">${symbols[i]}${state.question.correct === i ? ' ✓' : ''}</div></div>`).join('')}</div>` : `<div class="result-points ${result?.correct ? 'positive' : ''}">${result?.correct ? '+' + result.points : '+0'}<small>points this round</small></div><p class="personal-score">${state.me.score.toLocaleString()} total points · You’re in position ${state.me.rank}${result?.correct && state.players.find(p => p.id === state.me.id)?.streak > 1 ? ' · On a streak!' : ''}</p>`}<p class="reveal-question">${escape(state.question.text)}</p>${answers({ showCorrect: true })}<div class="stage-action">${hostView ? '<button class="button lime" data-do="next">See the leaderboard <span>→</span></button>' : '<p>Your host will move to the leaderboard shortly.</p>'}</div></section>`;
}
function scoreRows(limit = 10) { return `<ol class="score-list">${state.players.slice(0, limit).map((p, i) => `<li class="${p.id === state.me?.id ? 'is-you' : ''}"><span class="rank-number">${String(i + 1).padStart(2, '0')}</span><span class="avatar a${i % 4}">${symbols[i % 4]}</span><strong>${escape(p.name)}${p.id === state.me?.id ? ' <small>(you)</small>' : ''}</strong><span class="streak">${p.streak >= 2 ? p.streak + ' in a row' : ''}</span><b>${p.score.toLocaleString()}</b></li>`).join('')}</ol>`; }
function leaderboard(hostView) { return `<section class="leaderboard-stage"><span class="eyebrow">A LITTLE FRIENDLY COMPETITION</span><h1>Look who’s on a roll.</h1><p>Every question is a chance to climb.</p>${scoreRows()}<div class="stage-action">${hostView ? `<button class="button lime" data-do="next">${state.index + 1 === state.total ? 'The final podium' : 'Next question'} <span>→</span></button>` : `<span class="soft-pill">Your score: ${state.me.score.toLocaleString()} · Rank ${state.me.rank}</span>`}</div></section>`; }
function podium(hostView) { const winners = state.players.slice(0, 3); return `<section class="podium-stage"><span class="eyebrow">THAT’S A WRAP</span><h1>A round of applause.</h1><p>Great guesses. Better company. Thanks for playing.</p><div class="podium">${[1, 0, 2].filter(i => winners[i]).map(i => `<div class="podium-person place-${i + 1}"><span class="podium-crown">${i === 0 ? '✳' : symbols[i]}</span><h2>${escape(winners[i].name)}</h2><span>${winners[i].score.toLocaleString()} points</span><div class="podium-block">${i + 1}</div></div>`).join('')}</div>${!hostView ? `<p class="personal-score">${escape(state.me.name)}, you finished #${state.me.rank} with ${state.me.score.toLocaleString()} points.</p>` : ''}<div class="stage-action">${hostView ? '<button class="button lime" data-do="restart">One more round? ↻</button><button class="button ghost" data-do="results">Download results ↓</button>' : '<a class="button lime" href="/">Back to the good stuff →</a>'}</div><details class="all-scores"><summary>See everyone’s score</summary>${scoreRows(100)}</details></section>`; }
function tick() {
  if (!state?.deadline) return;
  const remaining = Math.max(0, state.deadline - (Date.now() + clockOffset));
  document.querySelectorAll('[data-timer], [data-countdown]').forEach(el => el.textContent = Math.ceil(remaining / 1000));
  if ($('#time-fill')) $('#time-fill').style.width = `${Math.max(0, remaining / (state.question.seconds * 1000) * 100)}%`;
  if (state.phase === 'question' && remaining === 0) document.querySelectorAll('[data-do="answer"]').forEach(el => el.disabled = true);
}
setInterval(tick, 100);
async function action(name) { return request(`/api/rooms/${session.pin}/action`, { action: name }, session.token); }
async function answer(choice) {
  if (state?.phase !== 'question' || !state.me || state.me.answered || answerBusy) return;
  answerBusy = true; selectedChoice = choice; document.querySelectorAll('[data-do="answer"]').forEach(el => el.disabled = true);
  try { await request(`/api/rooms/${session.pin}/answer`, { choice, index: state.index }, session.token); }
  catch (error) { answerBusy = false; selectedChoice = null; renderGame(); toast(error.message); }
}
function editor() {
  stream?.close(); state = null; document.body.className = 'editor-body';
  const q = draft.questions[editorIndex];
  root.innerHTML = `${header('<a class="exit-link" href="/">← Back to quizzes</a><span class="draft-saved">Saved on this device</span><button class="button lime small" data-do="host-draft">Host your quiz ↗</button>')}<main class="editor-layout"><aside class="editor-sidebar"><span class="eyebrow">YOUR QUESTIONS</span><div class="question-tabs">${draft.questions.map((item, i) => `<button class="question-tab ${i === editorIndex ? 'selected' : ''}" data-do="edit-question" data-index="${i}"><span>${i + 1}</span>${escape(item.text || 'A new question')}</button>`).join('')}</div><button class="button outline full small" data-do="add-question" ${draft.questions.length >= 50 ? 'disabled' : ''}>＋ Add question</button><button class="text-button" data-do="export-quiz">Export quiz JSON ↓</button></aside><section class="editor-content"><div class="editor-title"><div><label for="quiz-title" class="eyebrow">QUIZ TITLE</label><input id="quiz-title" value="${escape(draft.title)}" maxlength="90" placeholder="Give it a great title"></div><span class="soft-pill">${draft.questions.length} ${draft.questions.length === 1 ? 'question' : 'questions'}</span></div><div class="editor-card"><div class="question-top"><span class="eyebrow">QUESTION ${editorIndex + 1}</span><label class="timer-select">Time limit <select id="question-seconds">${[5, 10, 15, 20, 30, 60, 90, 120].map(s => `<option value="${s}" ${q.seconds === s ? 'selected' : ''}>${s} seconds</option>`).join('')}</select></label></div><label class="sr-only" for="question-text">Question</label><textarea id="question-text" maxlength="240" placeholder="What would you like to ask?">${escape(q.text)}</textarea><p class="editor-hint">Write four answers. Select the circle beside the correct one.</p><div class="editor-answers">${q.options.map((text, i) => `<div class="editor-answer answer-${i}"><span aria-hidden="true">${symbols[i]}</span><label class="sr-only" for="option-${i}">Answer ${i + 1}</label><input id="option-${i}" data-option="${i}" value="${escape(text)}" maxlength="120" placeholder="Answer ${i + 1}"><input type="radio" name="correct" value="${i}" aria-label="Answer ${i + 1} is correct" ${q.correct === i ? 'checked' : ''}></div>`).join('')}</div><div class="editor-bottom"><span>✓ One correct answer · Up to 1,000 points</span><button class="text-button danger" data-do="remove-question" ${draft.questions.length < 2 ? 'disabled' : ''}>Remove question</button></div></div><p class="editor-note">Your draft stays in this browser. Export a copy to keep or share it.</p></section></main>`;
  $('.editor-layout').addEventListener('input', event => {
    const e = event.target;
    if (e.id === 'quiz-title') draft.title = e.value;
    if (e.id === 'question-text') { q.text = e.value; const tab = $(`.question-tab[data-index="${editorIndex}"]`); tab.innerHTML = `<span>${editorIndex + 1}</span>${escape(e.value || 'A new question')}`; }
    if (e.id === 'question-seconds') q.seconds = Number(e.value);
    if (e.dataset.option !== undefined) q.options[Number(e.dataset.option)] = e.value;
    if (e.name === 'correct') q.correct = Number(e.value);
    storage.set('quizroom-draft', draft);
  });
}
function download(name, contents, type) { const url = URL.createObjectURL(new Blob([contents], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-do]'); if (!button || button.disabled) return;
  const name = button.dataset.do;
  try {
    if (name === 'editor') { history.pushState({}, '', '/'); editor(); }
    else if (name === 'browse') $('#quizzes').scrollIntoView({ behavior: 'smooth' });
    else if (name === 'host') { button.disabled = true; await host(quizzes[Number(button.dataset.index)]); }
    else if (name === 'host-draft') { button.disabled = true; await host(draft); }
    else if (name === 'copy') { const link = `${location.origin}/play/${state.pin}`; try { await navigator.clipboard.writeText(link); toast('Join link copied. Send it to your people.'); } catch { toast(`Join link: ${link}`); } }
    else if (name === 'answer') await answer(Number(button.dataset.choice));
    else if (['start', 'reveal', 'next', 'lock', 'restart'].includes(name)) { button.disabled = true; await action(name); }
    else if (name === 'add-question') { draft.questions.push({ text: '', options: ['', '', '', ''], correct: 0, seconds: 20 }); editorIndex = draft.questions.length - 1; storage.set('quizroom-draft', draft); editor(); }
    else if (name === 'edit-question') { editorIndex = Number(button.dataset.index); editor(); }
    else if (name === 'remove-question' && draft.questions.length > 1) { draft.questions.splice(editorIndex, 1); editorIndex = Math.min(editorIndex, draft.questions.length - 1); storage.set('quizroom-draft', draft); editor(); }
    else if (name === 'export-quiz') download('quizroom-quiz.json', JSON.stringify(draft, null, 2), 'application/json');
    else if (name === 'results') { const cell = v => `"${String(v).replace(/^[=+@\-\t\r]/, c => "'" + c).replace(/"/g, '""')}"`; download('quizroom-results.csv', 'Rank,Nickname,Score\r\n' + state.players.map((p, i) => [i + 1, p.name, p.score].map(cell).join(',')).join('\r\n'), 'text/csv'); }
  } catch (error) { toast(error.message); button.disabled = false; }
});
document.addEventListener('keydown', event => { if (/^[1-4]$/.test(event.key) && !event.repeat && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) answer(Number(event.key) - 1); });
window.addEventListener('popstate', route);
function route() { const match = location.pathname.match(/^\/(host|play)\/(\d{6})$/); if (match) { const token = sessionStorage.getItem(`quizroom:${match[1]}:${match[2]}`); if (token) connect(match[1], match[2], token); else home(match[2]); } else home(); }
try { quizzes = await request('/quizzes.json'); route(); } catch { root.innerHTML = '<div class="loading">Could not load the quizzes. Refresh to try again.</div>'; }
