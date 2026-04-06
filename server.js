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

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/share-url', (_req, res) => {
  res.json({ url: buildShareUrl(port) });
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
