const $ = (selector) => document.querySelector(selector);

let config = null;
let student = null;
let state = null;
let refreshTimer = null;

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
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_err) {
    throw new Error(`Respuesta inesperada del servidor en ${path}.`);
  }
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

function showMessage(message, type = '') {
  const notice = $('#state-notice');
  notice.className = `notice ${type}`.trim();
  notice.textContent = message;
  notice.classList.remove('hidden');
}

async function loadConfig() {
  config = await api('/api/config');
  const select = $('#student-select');
  select.innerHTML = '<option value="">Selecciona tu nombre</option>' +
    config.roster.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
}

async function register(studentId) {
  const data = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ studentId })
  });
  student = data.student;
  localStorage.setItem('peerEvalStudentId', student.id);
  $('#login-card').classList.add('hidden');
  $('#app-card').classList.remove('hidden');
  $('#student-badge').textContent = `Participante #${student.participation}`;
  $('#welcome-title').textContent = `Hola, ${student.name}`;
  await loadState();
  startRefresh();
}

function startRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadState, 2500);
}

async function loadState() {
  if (!student) return;
  try {
    state = await api(`/api/state?studentId=${encodeURIComponent(student.id)}`);
    renderState();
  } catch (err) {
    showMessage(err.message, 'bad');
  }
}

function renderState() {
  $('#progress-text').textContent = `Has enviado ${state.progress.given} de ${state.progress.possibleTotal} evaluaciones posibles.`;
  renderOwnEvaluations();

  if (!state.activePresenter || state.status !== 'open') {
    $('#presentation-card').classList.add('hidden');
    showMessage('No hay una evaluación activa en este momento. Espera a que el profesor active al ponente.', 'warn');
    return;
  }

  $('#presentation-card').classList.remove('hidden');
  $('#status-pill').className = 'pill open';
  $('#status-pill').textContent = 'Evaluación abierta';
  $('#presenter-title').textContent = `${state.activePresenter.name}`;
  $('#presenter-topic').innerHTML = `<b>Tema:</b> ${escapeHtml(state.activePresenter.topic)} · <b>Participación:</b> ${state.activePresenter.participation}`;

  if (state.isSelfPresenter) {
    $('#evaluation-form').classList.add('hidden');
    showMessage('Esta es tu exposición. No puedes evaluarte a ti mismo.', 'warn');
    return;
  }

  if (state.alreadyEvaluatedActive) {
    $('#evaluation-form').classList.add('hidden');
    showMessage('Tu evaluación para este ponente ya fue registrada. Espera a la siguiente exposición.', 'ok');
    return;
  }

  showMessage('Evaluación activa. Completa los cuatro criterios y envía tu evaluación.', 'ok');
  $('#evaluation-form').classList.remove('hidden');
  renderCriteria();
}

function renderCriteria() {
  const container = $('#criteria-container');
  container.innerHTML = state.criteria.map(c => `
    <section class="criterion">
      <label>${escapeHtml(c.label)}</label>
      <p>${escapeHtml(c.description)}</p>
      <div class="score-options" role="radiogroup" aria-label="${escapeHtml(c.label)}">
        ${[1, 2, 3, 4, 5].map(value => `
          <label>
            <input type="radio" name="score-${escapeHtml(c.key)}" value="${value}" required />
            <span class="score-box"><b>${value}</b><span>${scoreLabel(value)}</span></span>
          </label>
        `).join('')}
      </div>
    </section>
  `).join('');
}

function scoreLabel(value) {
  return {
    1: 'bajo',
    2: 'regular',
    3: 'bien',
    4: 'muy bien',
    5: 'excelente'
  }[value];
}

function renderOwnEvaluations() {
  const container = $('#own-evaluations');
  if (!state.ownEvaluations.length) {
    container.innerHTML = '<div class="notice">Aún no has enviado evaluaciones.</div>';
    return;
  }
  container.innerHTML = state.ownEvaluations
    .slice()
    .reverse()
    .map(ev => `
      <div class="notice ok">
        <b>${escapeHtml(ev.presenter?.name || 'Ponente')}</b><br>
        <span class="small">${escapeHtml(ev.presenter?.topic || '')}</span><br>
        Promedio otorgado: <b>${ev.total10}/10</b>
      </div>
    `).join('');
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const studentId = $('#student-select').value;
  if (!studentId) return;
  try {
    await register(studentId);
  } catch (err) {
    alert(err.message);
  }
});

$('#evaluation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state?.canEvaluate) return;

  const scores = {};
  for (const c of state.criteria) {
    const checked = document.querySelector(`input[name="score-${CSS.escape(c.key)}"]:checked`);
    if (!checked) {
      alert(`Falta calificar: ${c.label}`);
      return;
    }
    scores[c.key] = Number(checked.value);
  }

  const submitBtn = $('#submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  try {
    await api('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        studentId: student.id,
        presenterId: state.activePresenter.id,
        scores,
        comment: $('#comment').value
      })
    });
    $('#evaluation-form').reset();
    await loadState();
  } catch (err) {
    alert(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar evaluación';
  }
});

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem('peerEvalStudentId');
  window.location.reload();
});

(async function init() {
  try {
    await loadConfig();
    const saved = localStorage.getItem('peerEvalStudentId');
    if (saved && config.roster.some(s => s.id === saved)) {
      $('#student-select').value = saved;
      await register(saved);
    }
  } catch (err) {
    alert(err.message);
  }
})();
