const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const TEACHER_PIN = String(process.env.TEACHER_PIN || '1234');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const ROSTER_PATH = path.join(DATA_DIR, 'roster.json');
const DB_PATH = path.join(DATA_DIR, 'eval-db.json');

const CRITERIA = [
  {
    key: 'dominio',
    label: 'Dominio del tema',
    description: 'Claridad conceptual, seguridad al explicar, manejo de preguntas y precisión técnica.'
  },
  {
    key: 'ponente',
    label: 'Desempeño como ponente',
    description: 'Comunicación oral, organización, ritmo, contacto visual y capacidad de mantener la atención.'
  },
  {
    key: 'material',
    label: 'Diagramas de flujo, código y conceptos básicos',
    description: 'Incluye y explica diagramas, código, definiciones, supuestos y conceptos mínimos del tema.'
  },
  {
    key: 'tiempo',
    label: 'Cumplimiento de tiempo',
    description: 'La exposición se mantiene dentro del rango solicitado: 20 a 25 minutos.'
  }
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      status: 'closed',
      activePresenterId: null,
      activatedAt: null,
      closedAt: null,
      registeredStudents: {},
      evaluations: []
    }, null, 2));
  }
}

function readRoster() {
  return JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
}

function readDb() {
  ensureFiles();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  ensureFiles();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function send(res, statusCode, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('El cuerpo de la solicitud es demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_err) {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function getPin(req, url) {
  return req.headers['x-teacher-pin'] || url.searchParams.get('pin') || '';
}

function requireTeacher(req, url, res) {
  const pin = String(getPin(req, url));
  if (pin !== TEACHER_PIN) {
    sendJson(res, 401, { error: 'PIN de profesor incorrecto.' });
    return false;
  }
  return true;
}

function rosterById(roster) {
  return Object.fromEntries(roster.map(student => [student.id, student]));
}

function getActivePresenter(db, roster) {
  if (!db.activePresenterId) return null;
  return roster.find(s => s.id === db.activePresenterId) || null;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function summarizePresenter(presenter, evaluations) {
  const own = evaluations.filter(ev => ev.presenterId === presenter.id);
  const criterionAverages = {};
  for (const c of CRITERIA) {
    criterionAverages[c.key] = round(average(own.map(ev => Number(ev.scores[c.key])).filter(Number.isFinite)), 2);
  }
  const totals5 = own.map(ev => average(CRITERIA.map(c => Number(ev.scores[c.key])))).filter(Number.isFinite);
  const average5 = round(average(totals5), 2);
  return {
    ...presenter,
    evaluationCount: own.length,
    criterionAverages,
    average5,
    average10: average5 === null ? null : round(average5 * 2, 2)
  };
}

function summarizeEvaluator(evaluator, evaluations) {
  const own = evaluations.filter(ev => ev.evaluatorId === evaluator.id);
  const totals5 = own.map(ev => average(CRITERIA.map(c => Number(ev.scores[c.key])))).filter(Number.isFinite);
  return {
    ...evaluator,
    evaluationsGiven: own.length,
    averageGiven5: round(average(totals5), 2),
    averageGiven10: round(average(totals5) === null ? null : average(totals5) * 2, 2)
  };
}

function buildTeacherState() {
  const roster = readRoster();
  const db = readDb();
  const byId = rosterById(roster);
  const evaluations = db.evaluations.map(ev => ({
    ...ev,
    evaluator: byId[ev.evaluatorId] || null,
    presenter: byId[ev.presenterId] || null,
    total5: round(average(CRITERIA.map(c => Number(ev.scores[c.key]))), 2),
    total10: round(average(CRITERIA.map(c => Number(ev.scores[c.key]))) * 2, 2)
  }));
  return {
    status: db.status,
    activePresenterId: db.activePresenterId,
    activePresenter: getActivePresenter(db, roster),
    activatedAt: db.activatedAt,
    closedAt: db.closedAt,
    criteria: CRITERIA,
    roster,
    presenterStats: roster.map(student => summarizePresenter(student, db.evaluations)).sort((a, b) => a.participation - b.participation),
    evaluatorStats: roster.map(student => summarizeEvaluator(student, db.evaluations)).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    evaluations,
    registeredStudents: db.registeredStudents || {},
    totals: {
      rosterCount: roster.length,
      registeredCount: Object.keys(db.registeredStudents || {}).length,
      evaluationCount: db.evaluations.length,
      possibleEvaluationsPerPresenter: Math.max(roster.length - 1, 0)
    }
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[,"\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function evaluationsCsv() {
  const state = buildTeacherState();
  const header = [
    'timestamp', 'ponente_numero', 'ponente', 'tema', 'evaluador',
    ...CRITERIA.map(c => c.label), 'promedio_1_5', 'calificacion_0_10', 'comentario'
  ];
  const rows = [header];
  for (const ev of state.evaluations) {
    rows.push([
      ev.createdAt,
      ev.presenter?.participation || '',
      ev.presenter?.name || ev.presenterId,
      ev.presenter?.topic || '',
      ev.evaluator?.name || ev.evaluatorId,
      ...CRITERIA.map(c => ev.scores[c.key]),
      ev.total5,
      ev.total10,
      ev.comment || ''
    ]);
  }
  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

function statsCsv() {
  const state = buildTeacherState();
  const header = [
    'numero_participacion', 'ponente', 'tema', 'evaluaciones_recibidas',
    ...CRITERIA.map(c => `promedio_${c.key}_1_5`),
    'promedio_general_1_5', 'calificacion_0_10'
  ];
  const rows = [header];
  for (const p of state.presenterStats) {
    rows.push([
      p.participation,
      p.name,
      p.topic,
      p.evaluationCount,
      ...CRITERIA.map(c => p.criterionAverages[c.key] ?? ''),
      p.average5 ?? '',
      p.average10 ?? ''
    ]);
  }
  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/teacher') pathname = '/teacher.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, 'Acceso denegado.', 'text/plain; charset=utf-8');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, 'Archivo no encontrado.', 'text/plain; charset=utf-8');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
  });
  fs.createReadStream(filePath).pipe(res);
}

function validateScores(scores) {
  if (!scores || typeof scores !== 'object') return 'Faltan las puntuaciones.';
  for (const c of CRITERIA) {
    const value = Number(scores[c.key]);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return `La puntuación de "${c.label}" debe ser un entero entre 1 y 5.`;
    }
  }
  return null;
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/config') {
    const roster = readRoster().sort((a, b) => a.name.localeCompare(b.name, 'es'));
    sendJson(res, 200, { roster, criteria: CRITERIA, scale: { min: 1, max: 5 } });
    return;
  }

  if (method === 'POST' && pathname === '/api/register') {
    const body = await parseBody(req);
    const studentId = String(body.studentId || '');
    const roster = readRoster();
    const student = roster.find(s => s.id === studentId);
    if (!student) {
      sendJson(res, 400, { error: 'Selecciona un estudiante válido.' });
      return;
    }
    const db = readDb();
    db.registeredStudents = db.registeredStudents || {};
    const previous = db.registeredStudents[studentId];
    db.registeredStudents[studentId] = {
      studentId,
      name: student.name,
      firstSeenAt: previous?.firstSeenAt || nowIso(),
      lastSeenAt: nowIso()
    };
    writeDb(db);
    sendJson(res, 200, { student });
    return;
  }

  if (method === 'GET' && pathname === '/api/state') {
    const studentId = String(url.searchParams.get('studentId') || '');
    const roster = readRoster();
    const student = roster.find(s => s.id === studentId) || null;
    const db = readDb();
    const activePresenter = getActivePresenter(db, roster);
    const ownEvaluations = db.evaluations.filter(ev => ev.evaluatorId === studentId);
    const activeEvaluation = activePresenter ? db.evaluations.find(ev => ev.evaluatorId === studentId && ev.presenterId === activePresenter.id) : null;
    sendJson(res, 200, {
      student,
      status: db.status,
      activePresenter,
      activatedAt: db.activatedAt,
      canEvaluate: Boolean(student && activePresenter && db.status === 'open' && student.id !== activePresenter.id && !activeEvaluation),
      isSelfPresenter: Boolean(student && activePresenter && student.id === activePresenter.id),
      alreadyEvaluatedActive: Boolean(activeEvaluation),
      criteria: CRITERIA,
      ownEvaluations: ownEvaluations.map(ev => ({
        presenterId: ev.presenterId,
        presenter: roster.find(s => s.id === ev.presenterId) || null,
        createdAt: ev.createdAt,
        total5: round(average(CRITERIA.map(c => Number(ev.scores[c.key]))), 2),
        total10: round(average(CRITERIA.map(c => Number(ev.scores[c.key]))) * 2, 2)
      })),
      progress: {
        given: ownEvaluations.length,
        possibleTotal: Math.max(roster.length - 1, 0)
      }
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/evaluate') {
    const body = await parseBody(req);
    const evaluatorId = String(body.studentId || '');
    const presenterId = String(body.presenterId || '');
    const scores = body.scores;
    const comment = String(body.comment || '').slice(0, 500);

    const roster = readRoster();
    const evaluator = roster.find(s => s.id === evaluatorId);
    const presenter = roster.find(s => s.id === presenterId);
    const db = readDb();

    if (!evaluator) return sendJson(res, 400, { error: 'Evaluador no válido.' });
    if (!presenter) return sendJson(res, 400, { error: 'Ponente no válido.' });
    if (evaluatorId === presenterId) return sendJson(res, 400, { error: 'No puedes evaluarte a ti mismo.' });
    if (db.status !== 'open' || db.activePresenterId !== presenterId) {
      return sendJson(res, 409, { error: 'La evaluación de este ponente no está activa.' });
    }
    const existing = db.evaluations.find(ev => ev.evaluatorId === evaluatorId && ev.presenterId === presenterId);
    if (existing) return sendJson(res, 409, { error: 'Ya enviaste tu evaluación para este ponente.' });
    const validationError = validateScores(scores);
    if (validationError) return sendJson(res, 400, { error: validationError });

    const normalizedScores = {};
    for (const c of CRITERIA) normalizedScores[c.key] = Number(scores[c.key]);

    db.evaluations.push({
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      evaluatorId,
      presenterId,
      scores: normalizedScores,
      comment,
      createdAt: nowIso()
    });
    db.registeredStudents = db.registeredStudents || {};
    const previous = db.registeredStudents[evaluatorId];
    db.registeredStudents[evaluatorId] = {
      studentId: evaluatorId,
      name: evaluator.name,
      firstSeenAt: previous?.firstSeenAt || nowIso(),
      lastSeenAt: nowIso()
    };
    writeDb(db);
    sendJson(res, 200, { ok: true, message: 'Evaluación registrada.', state: { presenter: summarizePresenter(presenter, db.evaluations) } });
    return;
  }

  if (method === 'POST' && pathname === '/api/teacher/login') {
    const body = await parseBody(req);
    if (String(body.pin || '') !== TEACHER_PIN) {
      sendJson(res, 401, { error: 'PIN incorrecto.' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && pathname === '/api/teacher/state') {
    if (!requireTeacher(req, url, res)) return;
    sendJson(res, 200, buildTeacherState());
    return;
  }

  if (method === 'POST' && pathname === '/api/teacher/activate') {
    if (!requireTeacher(req, url, res)) return;
    const body = await parseBody(req);
    const presenterId = String(body.presenterId || '');
    const roster = readRoster();
    if (!roster.some(s => s.id === presenterId)) {
      sendJson(res, 400, { error: 'Ponente no válido.' });
      return;
    }
    const db = readDb();
    db.status = 'open';
    db.activePresenterId = presenterId;
    db.activatedAt = nowIso();
    db.closedAt = null;
    writeDb(db);
    sendJson(res, 200, buildTeacherState());
    return;
  }

  if (method === 'POST' && pathname === '/api/teacher/close') {
    if (!requireTeacher(req, url, res)) return;
    const db = readDb();
    db.status = 'closed';
    db.closedAt = nowIso();
    writeDb(db);
    sendJson(res, 200, buildTeacherState());
    return;
  }

  if (method === 'POST' && pathname === '/api/teacher/reset-presenter') {
    if (!requireTeacher(req, url, res)) return;
    const body = await parseBody(req);
    const presenterId = String(body.presenterId || '');
    const roster = readRoster();
    if (!roster.some(s => s.id === presenterId)) {
      sendJson(res, 400, { error: 'Ponente no válido.' });
      return;
    }
    const db = readDb();
    db.evaluations = db.evaluations.filter(ev => ev.presenterId !== presenterId);
    if (db.activePresenterId === presenterId) {
      db.status = 'closed';
      db.activePresenterId = null;
      db.activatedAt = null;
      db.closedAt = nowIso();
    }
    writeDb(db);
    sendJson(res, 200, buildTeacherState());
    return;
  }

  if (method === 'POST' && pathname === '/api/teacher/reset-all') {
    if (!requireTeacher(req, url, res)) return;
    writeDb({
      status: 'closed',
      activePresenterId: null,
      activatedAt: null,
      closedAt: null,
      registeredStudents: {},
      evaluations: []
    });
    sendJson(res, 200, buildTeacherState());
    return;
  }

  if (method === 'GET' && pathname === '/api/teacher/export/evaluations.csv') {
    if (!requireTeacher(req, url, res)) return;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="evaluaciones_exposiciones.csv"',
      'Cache-Control': 'no-store'
    });
    res.end(evaluationsCsv());
    return;
  }

  if (method === 'GET' && pathname === '/api/teacher/export/stats.csv') {
    if (!requireTeacher(req, url, res)) return;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="estadisticas_exposiciones.csv"',
      'Cache-Control': 'no-store'
    });
    res.end(statsCsv());
    return;
  }

  sendJson(res, 404, { error: 'Ruta API no encontrada.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Error interno del servidor.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
  console.log(`Panel del profesor: http://localhost:${PORT}/teacher`);
});
