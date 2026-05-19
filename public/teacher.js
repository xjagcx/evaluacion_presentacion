const $ = (selector) => document.querySelector(selector);
let pin = localStorage.getItem('peerEvalTeacherPin') || '';
let state = null;
let timer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Teacher-Pin': pin, ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch (_err) { throw new Error(`Respuesta inesperada del servidor en ${path}.`); }
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

async function login() {
  await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ pin }) });
  localStorage.setItem('peerEvalTeacherPin', pin);
  $('#login-card').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
  await loadState();
  if (timer) clearInterval(timer);
  timer = setInterval(loadState, 2500);
}

async function loadState() {
  try {
    state = await api('/api/teacher/state');
    render();
  } catch (err) {
    console.error(err);
  }
}

function fmt(value, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : value;
}

function render() {
  renderCurrent();
  renderKpis();
  renderPresenters();
  renderEvaluators();
}

function renderCurrent() {
  const pill = $('#current-pill');
  if (state.status === 'open' && state.activePresenter) {
    pill.className = 'pill open';
    pill.textContent = 'Evaluación abierta';
    $('#current-title').textContent = state.activePresenter.name;
    $('#current-topic').innerHTML = `<b>Tema:</b> ${escapeHtml(state.activePresenter.topic)} · <b>Participación:</b> ${state.activePresenter.participation}`;
    $('#close-btn').disabled = false;
  } else {
    pill.className = 'pill closed';
    pill.textContent = 'Evaluación cerrada';
    $('#current-title').textContent = 'Sin evaluación activa';
    $('#current-topic').textContent = 'Selecciona un ponente para abrir la evaluación.';
    $('#close-btn').disabled = true;
  }
}

function renderKpis() {
  const completed = state.presenterStats.filter(p => p.evaluationCount > 0).length;
  const avgAll = average(state.presenterStats.map(p => p.average10).filter(Number.isFinite));
  $('#kpi-container').innerHTML = `
    <div class="kpi"><strong>${state.totals.evaluationCount}</strong><span>evaluaciones registradas</span></div>
    <div class="kpi"><strong>${state.totals.registeredCount}</strong><span>estudiantes que ingresaron</span></div>
    <div class="kpi"><strong>${completed}</strong><span>ponentes con evaluaciones</span></div>
    <div class="kpi"><strong>${avgAll === null ? '—' : avgAll.toFixed(2)}</strong><span>promedio grupal /10</span></div>
  `;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function renderPresenters() {
  $('#presenters-body').innerHTML = state.presenterStats.map(p => `
    <tr class="${state.activePresenterId === p.id && state.status === 'open' ? 'active-row' : ''}">
      <td>${p.participation}</td>
      <td><span class="clickable" data-detail-presenter="${escapeHtml(p.id)}">${escapeHtml(p.name)}</span></td>
      <td>${escapeHtml(p.topic)}</td>
      <td>${p.evaluationCount}/${state.totals.possibleEvaluationsPerPresenter}</td>
      <td>${fmt(p.criterionAverages.dominio)}</td>
      <td>${fmt(p.criterionAverages.ponente)}</td>
      <td>${fmt(p.criterionAverages.material)}</td>
      <td>${fmt(p.criterionAverages.tiempo)}</td>
      <td><b>${fmt(p.average10)}</b></td>
      <td>
        <div class="actions">
          <button data-activate="${escapeHtml(p.id)}" class="ok">Activar</button>
          <button data-reset-presenter="${escapeHtml(p.id)}" class="danger">Reiniciar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderEvaluators() {
  $('#evaluators-body').innerHTML = state.evaluatorStats.map(e => `
    <tr>
      <td><span class="clickable" data-detail-evaluator="${escapeHtml(e.id)}">${escapeHtml(e.name)}</span></td>
      <td>${e.evaluationsGiven}</td>
      <td>${fmt(e.averageGiven10)}</td>
    </tr>
  `).join('');
}

async function activatePresenter(id) {
  if (!confirm('¿Abrir evaluación para este ponente?')) return;
  state = await api('/api/teacher/activate', { method: 'POST', body: JSON.stringify({ presenterId: id }) });
  render();
}

async function resetPresenter(id) {
  const presenter = state.roster.find(s => s.id === id);
  if (!confirm(`¿Borrar las evaluaciones recibidas por ${presenter?.name || 'este ponente'}?`)) return;
  state = await api('/api/teacher/reset-presenter', { method: 'POST', body: JSON.stringify({ presenterId: id }) });
  render();
}

async function closeEvaluation() {
  state = await api('/api/teacher/close', { method: 'POST', body: JSON.stringify({}) });
  render();
}

function showPresenterDetail(id) {
  const presenter = state.presenterStats.find(p => p.id === id);
  const evaluations = state.evaluations.filter(ev => ev.presenterId === id);
  $('#detail-title').textContent = presenter.name;
  $('#detail-subtitle').textContent = `${presenter.topic} · Participación ${presenter.participation}`;
  $('#detail-body').innerHTML = `
    <div class="kpis" style="grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom:18px">
      <div class="kpi"><strong>${presenter.evaluationCount}</strong><span>evaluaciones recibidas</span></div>
      <div class="kpi"><strong>${fmt(presenter.average10)}</strong><span>calificación promedio /10</span></div>
    </div>
    <div class="card" style="box-shadow:none;margin-bottom:18px">
      <h3>Promedios por criterio</h3>
      ${state.criteria.map(c => `<p><b>${escapeHtml(c.label)}:</b> ${fmt(presenter.criterionAverages[c.key])}/5</p>`).join('')}
    </div>
    <h3>Evaluaciones recibidas</h3>
    ${evaluations.length ? evaluations.map(ev => `
      <div class="notice" style="margin-bottom:10px">
        <b>${escapeHtml(ev.evaluator?.name || 'Evaluador')}</b> otorgó <b>${ev.total10}/10</b><br>
        <span class="small">${new Date(ev.createdAt).toLocaleString()}</span>
        <div style="margin-top:8px">
          ${state.criteria.map(c => `${escapeHtml(c.label)}: <b>${ev.scores[c.key]}</b>`).join(' · ')}
        </div>
        ${ev.comment ? `<p>${escapeHtml(ev.comment)}</p>` : ''}
      </div>
    `).join('') : '<div class="notice">Aún no tiene evaluaciones.</div>'}
  `;
  $('#detail-panel').classList.remove('hidden');
}

function showEvaluatorDetail(id) {
  const evaluator = state.evaluatorStats.find(e => e.id === id);
  const evaluations = state.evaluations.filter(ev => ev.evaluatorId === id);
  $('#detail-title').textContent = evaluator.name;
  $('#detail-subtitle').textContent = `Evaluaciones enviadas: ${evaluator.evaluationsGiven}`;
  $('#detail-body').innerHTML = evaluations.length ? evaluations.map(ev => `
    <div class="notice" style="margin-bottom:10px">
      <b>Evaluó a ${escapeHtml(ev.presenter?.name || 'Ponente')}</b><br>
      <span class="small">${escapeHtml(ev.presenter?.topic || '')}</span><br>
      Calificación otorgada: <b>${ev.total10}/10</b><br>
      <span class="small">${new Date(ev.createdAt).toLocaleString()}</span>
      <div style="margin-top:8px">
        ${state.criteria.map(c => `${escapeHtml(c.label)}: <b>${ev.scores[c.key]}</b>`).join(' · ')}
      </div>
      ${ev.comment ? `<p>${escapeHtml(ev.comment)}</p>` : ''}
    </div>
  `).join('') : '<div class="notice">Este estudiante aún no ha enviado evaluaciones.</div>';
  $('#detail-panel').classList.remove('hidden');
}

$('#teacher-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  pin = $('#pin-input').value.trim();
  try { await login(); }
  catch (err) { alert(err.message); }
});

$('#close-btn').addEventListener('click', async () => {
  if (!confirm('¿Cerrar la evaluación activa?')) return;
  try { await closeEvaluation(); }
  catch (err) { alert(err.message); }
});

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem('peerEvalTeacherPin');
  window.location.reload();
});

$('#reset-all-btn').addEventListener('click', async () => {
  if (!confirm('Esto borrará todas las evaluaciones y registros. ¿Continuar?')) return;
  try {
    state = await api('/api/teacher/reset-all', { method: 'POST', body: JSON.stringify({}) });
    render();
  } catch (err) { alert(err.message); }
});

$('#export-stats-btn').addEventListener('click', () => {
  window.location.href = `/api/teacher/export/stats.csv?pin=${encodeURIComponent(pin)}`;
});

$('#export-evaluations-btn').addEventListener('click', () => {
  window.location.href = `/api/teacher/export/evaluations.csv?pin=${encodeURIComponent(pin)}`;
});

document.addEventListener('click', async (event) => {
  const activate = event.target.closest('[data-activate]');
  const reset = event.target.closest('[data-reset-presenter]');
  const presenter = event.target.closest('[data-detail-presenter]');
  const evaluator = event.target.closest('[data-detail-evaluator]');
  try {
    if (activate) await activatePresenter(activate.dataset.activate);
    if (reset) await resetPresenter(reset.dataset.resetPresenter);
    if (presenter) showPresenterDetail(presenter.dataset.detailPresenter);
    if (evaluator) showEvaluatorDetail(evaluator.dataset.detailEvaluator);
  } catch (err) {
    alert(err.message);
  }
});

$('#close-detail-btn').addEventListener('click', () => $('#detail-panel').classList.add('hidden'));
$('#detail-panel').addEventListener('click', (event) => {
  if (event.target.id === 'detail-panel') $('#detail-panel').classList.add('hidden');
});

(async function init() {
  if (pin) {
    $('#pin-input').value = pin;
    try { await login(); }
    catch (_err) { localStorage.removeItem('peerEvalTeacherPin'); }
  }
})();
