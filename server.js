import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initialLiveState, liveReducer } from './src/liveState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const indexFile = path.join(distDir, 'index.html');

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

function syncConnectionCount() {
  liveState = liveReducer(liveState, {
    type: 'SET_CONNECTED_CLIENTS',
    count: io.of('/').sockets.size,
  });
  io.emit('state', liveState);
}

function ensureLiveTicker() {
  if (liveTicker) return;
  liveTicker = setInterval(() => {
    if (!liveState.timer.running) return;
    liveState = liveReducer(liveState, { type: 'TICK_TIMER' });
    io.emit('state', liveState);
  }, 1000);
}

app.use(express.json());

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
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
