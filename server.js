import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildShareUrl } from './share-url.js';
import { buildLiveStateFromSnapshot, initialLiveState, liveReducer } from './src/liveState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const indexFile = path.join(distDir, 'index.html');
const liveStateFile = path.join(__dirname, 'live-state.json');
const questionsDir = path.join(__dirname, 'data');
const privateQuestionsFile = path.join(questionsDir, 'private-questions.json');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
});

let liveState = initialLiveState;
let liveTicker = null;
let privateQuestions = [];

function normalizeQuestionRecord(question, index = 0) {
  const fallbackId = `private-q-${index + 1}`;
  return {
    id: typeof question?.id === 'string' && question.id.trim() ? question.id : fallbackId,
    prompt: typeof question?.prompt === 'string' ? question.prompt.trim() : '',
    answer: typeof question?.answer === 'string' ? question.answer.trim() : '',
    theme: typeof question?.theme === 'string' && question.theme.trim() ? question.theme.trim() : 'Historia',
    difficulty: ['Facil', 'Media', 'Dificil'].includes(question?.difficulty) ? question.difficulty : 'Facil',
    used: Boolean(question?.used),
    approved: question?.approved !== false,
  };
}

function ensureQuestionsDirectory() {
  if (!fs.existsSync(questionsDir)) {
    fs.mkdirSync(questionsDir, { recursive: true });
  }
}

function readPrivateQuestions() {
  if (!fs.existsSync(privateQuestionsFile)) return [];

  try {
    const raw = fs.readFileSync(privateQuestionsFile, 'utf8');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((question, index) => normalizeQuestionRecord(question, index));
  } catch {
    return [];
  }
}

function persistPrivateQuestions() {
  try {
    ensureQuestionsDirectory();
    fs.writeFileSync(privateQuestionsFile, JSON.stringify(privateQuestions, null, 2));
  } catch {
    // El show sigue corriendo aunque falle la persistencia local del banco privado.
  }
}

function isLoopbackAddress(address = '') {
  const normalized = String(address).replace('::ffff:', '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

function requireLocalHost(req, res, next) {
  const remoteAddress = req.ip ?? req.socket?.remoteAddress ?? '';
  if (isLoopbackAddress(remoteAddress)) {
    next();
    return;
  }

  res.status(403).json({ error: 'El banco privado solo se administra desde la PC host.' });
}

function readPersistedLiveState() {
  if (!fs.existsSync(liveStateFile)) return null;

  try {
    const raw = fs.readFileSync(liveStateFile, 'utf8');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function persistLiveState() {
  try {
    fs.writeFileSync(liveStateFile, JSON.stringify(liveState, null, 2));
  } catch {
    // Keep the live show running even if disk persistence fails.
  }
}

function syncConnectionCount() {
  liveState = liveReducer(liveState, {
    type: 'SET_CONNECTED_CLIENTS',
    count: io.of('/').sockets.size,
  });
  persistLiveState();
  io.emit('state', liveState);
}

function ensureLiveTicker() {
  if (liveTicker) return;
  liveTicker = setInterval(() => {
    if (!liveState.timer.running) return;
    liveState = liveReducer(liveState, { type: 'TICK_TIMER' });
    persistLiveState();
    io.emit('state', liveState);
  }, 1000);
}

app.use(express.json());

const persistedLiveState = readPersistedLiveState();
if (persistedLiveState) {
  liveState = buildLiveStateFromSnapshot(persistedLiveState);
}
privateQuestions = readPrivateQuestions();

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/share-url', (_req, res) => {
  res.json({ url: buildShareUrl(port) });
});

app.get('/api/host/questions', requireLocalHost, (_req, res) => {
  res.json({ questions: privateQuestions });
});

app.put('/api/host/questions', requireLocalHost, (req, res) => {
  const nextQuestions = Array.isArray(req.body?.questions) ? req.body.questions : null;

  if (!nextQuestions) {
    res.status(400).json({ error: 'Se esperaba un arreglo de preguntas.' });
    return;
  }

  privateQuestions = nextQuestions
    .map((question, index) => normalizeQuestionRecord(question, index))
    .filter((question) => question.prompt && question.answer);

  persistPrivateQuestions();
  res.json({ questions: privateQuestions });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io')) {
    next();
    return;
  }

  if (req.method !== 'GET') {
    next();
    return;
  }

  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
    return;
  }

  res.status(404).send('Build not found. Run `npm run build` first.');
});

io.on('connection', (socket) => {
  socket.emit('state', liveState);
  syncConnectionCount();
  ensureLiveTicker();

  socket.on('action', (action) => {
    liveState = liveReducer(liveState, action);
    ensureLiveTicker();
    syncConnectionCount();
  });

  socket.on('disconnect', () => {
    syncConnectionCount();
  });
});

const port = Number(process.env.PORT ?? 3001);
server.listen(port, '0.0.0.0', () => {
  console.log(`L'Imbatiblú live server listening on http://0.0.0.0:${port}`);
});
