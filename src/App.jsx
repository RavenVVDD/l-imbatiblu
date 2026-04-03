import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { LIVE_PHASES, buildInitialShowState, initialLiveState, liveReducer } from './liveState';

const gamePhases = [
  { id: 'lobby', title: 'Lobby', description: 'La partida esta lista para arrancar.' },
  { id: 'theme_selection', title: 'Seleccion de tema', description: 'La ruleta define el tema unico del duelo.' },
  { id: 'question_turn', title: 'Turno de pregunta', description: 'Un jugador responde con 5 segundos en reloj.' },
  { id: 'steal_turn', title: 'Turno de robo', description: 'El rival tiene 3 segundos para robar la pregunta.' },
  { id: 'resolution', title: 'Resolucion', description: 'La app registra punto, robo o anulacion.' },
  { id: 'duel_end', title: 'Fin de duelo', description: 'Se detecta ganador al llegar a 5 puntos.' },
  { id: 'player_swap', title: 'Cambio de jugador', description: 'El perdedor sale y entra el siguiente.' },
  { id: 'final', title: 'Final', description: 'Los mejores por puntaje pasan a la final.' },
];

const initialWheelThemes = [
  { label: 'Historia', emoji: '🏛️' },
  { label: 'Deportes', emoji: '⚽' },
  { label: 'Cine', emoji: '🎬' },
  { label: 'Musica', emoji: '🎵' },
  { label: 'Geografia', emoji: '🗺️' },
  { label: 'Cultura pop', emoji: '✨' },
  { label: 'Gaming', emoji: '🎮' },
  { label: 'Argentina', emoji: '🇦🇷' },
];

const IMBATIBLE_BONUS_POINTS = 4;
const DUEL_DRAW_SPIN_MS = 8000;
const DUEL_DRAW_ITEM_HEIGHT = 44;
const DUEL_DRAW_VIEWPORT_HEIGHT = 244;
const SHOW_READY_COUNTDOWN_SECONDS = 10;
const WHEEL_SPIN_DURATION_MS = 5200;
const APP_STORAGE_KEY = 'l-imbatiblu:persistent-state:v1';
const HOST_SCREENS = new Set(['playOptions', 'themeWheel', 'players', 'questions', 'broadcast', 'final', 'showMvp']);
const SHOW_FLOW_STEPS = ['intro', 'standby', 'draw', 'rollers', 'versus', 'ready'];

const initialPlayers = [
  { id: 'p1', playerNumber: 1, name: 'Agus', points: 0, roundsWon: 0, stealsWon: 0, winStreak: 0, active: true, imbatible: false },
  { id: 'p2', playerNumber: 2, name: 'Lola', points: 0, roundsWon: 0, stealsWon: 0, winStreak: 0, active: true, imbatible: false },
  { id: 'p3', playerNumber: 3, name: 'Nico', points: 0, roundsWon: 0, stealsWon: 0, winStreak: 0, active: true, imbatible: false },
];

const PLAYER_THEME_PALETTE = [
  { id: 'j1', label: 'Brasa', accent: '#ff6a55', soft: 'rgba(255, 106, 85, 0.18)', ring: '#cf3f31', ink: '#fff8ef' },
  { id: 'j2', label: 'Menta', accent: '#08b5aa', soft: 'rgba(8, 181, 170, 0.18)', ring: '#067f76', ink: '#fff8ef' },
  { id: 'j3', label: 'Sol', accent: '#f5c84c', soft: 'rgba(245, 200, 76, 0.22)', ring: '#b58f12', ink: '#1f1a17' },
  { id: 'j4', label: 'Uva', accent: '#8d68ff', soft: 'rgba(141, 104, 255, 0.18)', ring: '#5d44bf', ink: '#fff8ef' },
  { id: 'j5', label: 'Cobre', accent: '#d98443', soft: 'rgba(217, 132, 67, 0.18)', ring: '#a95c28', ink: '#fff8ef' },
  { id: 'j6', label: 'Rosa', accent: '#ff7fb2', soft: 'rgba(255, 127, 178, 0.18)', ring: '#c85384', ink: '#1f1a17' },
  { id: 'j7', label: 'Lima', accent: '#8bd646', soft: 'rgba(139, 214, 70, 0.18)', ring: '#5f9f24', ink: '#1f1a17' },
  { id: 'j8', label: 'Noche', accent: '#4d71ff', soft: 'rgba(77, 113, 255, 0.18)', ring: '#314fc2', ink: '#fff8ef' },
  { id: 'j9', label: 'Coral', accent: '#ff8a6b', soft: 'rgba(255, 138, 107, 0.18)', ring: '#d15e45', ink: '#1f1a17' },
  { id: 'j10', label: 'Aqua', accent: '#36c9c1', soft: 'rgba(54, 201, 193, 0.18)', ring: '#1b8f89', ink: '#1f1a17' },
  { id: 'j11', label: 'Lavanda', accent: '#b79cff', soft: 'rgba(183, 156, 255, 0.18)', ring: '#8c6dde', ink: '#1f1a17' },
  { id: 'j12', label: 'Tierra', accent: '#b96f52', soft: 'rgba(185, 111, 82, 0.18)', ring: '#8a4c34', ink: '#fff8ef' },
  { id: 'j13', label: 'Verde', accent: '#5fca7b', soft: 'rgba(95, 202, 123, 0.18)', ring: '#368f51', ink: '#1f1a17' },
  { id: 'j14', label: 'Aurora', accent: '#f7a23b', soft: 'rgba(247, 162, 59, 0.18)', ring: '#c77715', ink: '#1f1a17' },
];

function getPlayerThemeByNumber(playerNumber = 1) {
  const index = Math.max(1, playerNumber) - 1;
  return PLAYER_THEME_PALETTE[index % PLAYER_THEME_PALETTE.length];
}

function getPlayerThemeById(themeId, playerNumber = 1) {
  return PLAYER_THEME_PALETTE.find((theme) => theme.id === themeId) ?? getPlayerThemeByNumber(playerNumber);
}

function getPlayerThemeStyle(player) {
  const theme = getPlayerThemeById(player?.themeId, player?.playerNumber);
  return {
    '--player-theme-accent': theme.accent,
    '--player-theme-soft': theme.soft,
    '--player-theme-ring': theme.ring,
    '--player-theme-ink': theme.ink,
  };
}

function normalizeAccessCode(value) {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function hashAccessCodeSeed(seed) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).toUpperCase();
}

function buildPlayerAccessCode(player) {
  const hash = hashAccessCodeSeed(`${player.id}:${player.name}:${player.playerNumber ?? 0}`);
  const numeric = String((Number.parseInt(hash, 36) % 9000) + 1000).padStart(4, '0');
  return numeric;
}

function createRandomAccessCode(existingCodes = []) {
  const takenCodes = new Set(existingCodes.map((code) => normalizeAccessCode(String(code))));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!takenCodes.has(candidate)) return candidate;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

function normalizePlayerAccessCode(player) {
  if (!player || typeof player !== 'object') return player;
  const existingCode = typeof player.accessCode === 'string' ? player.accessCode.trim() : '';
  const theme = getPlayerThemeById(player.themeId, player.playerNumber);
  return {
    ...player,
    accessCode: existingCode ? existingCode.toUpperCase() : buildPlayerAccessCode(player),
    themeId: theme.id,
    themeLabel: theme.label,
  };
}

function normalizePlayersCollection(players) {
  return players.map((player) => normalizePlayerAccessCode(player));
}

const initialQuestions = [
  { id: 'q1', prompt: '¿En que ano se inauguro el Obelisco?', answer: '1936', theme: 'Historia', difficulty: 'Facil', used: false, approved: true },
  { id: 'q2', prompt: '¿Que deporte se juega con una pelota y once jugadores por lado?', answer: 'Futbol', theme: 'Deportes', difficulty: 'Facil', used: true, approved: true },
  { id: 'q3', prompt: '¿Quien dirigio "El Padrino"?', answer: 'Francis Ford Coppola', theme: 'Cine', difficulty: 'Media', used: false, approved: false },
];

const playFlowSteps = [
  {
    id: 'players',
    kicker: '00',
    title: 'Jugadores',
    description: 'Armá la rueda, revisá puntos, rachas e Imbatibles antes de salir al aire.',
    buttonLabel: 'Abrir jugadores',
  },
  {
    id: 'questions',
    kicker: '01',
    title: 'Preguntas',
    description: 'Cargá el banco de preguntas, temas y estados de uso para el duelo.',
    buttonLabel: 'Abrir preguntas',
  },
  {
    id: 'themeWheel',
    kicker: '02',
    title: 'Ruleta de temas',
    description: 'Elegí el tema del duelo con el giro animado que define la ronda.',
    buttonLabel: 'Abrir ruleta',
  },
  {
    id: 'broadcast',
    kicker: '03',
    title: 'Pantallas en vivo',
    description: 'Separá conductor, show y standby con la misma verdad de la partida.',
    buttonLabel: 'Abrir pantallas',
  },
  {
    id: 'final',
    kicker: '04',
    title: 'Final',
    description: 'Revisá el ranking final con desempates y contendientes al cierre.',
    buttonLabel: 'Abrir final',
  },
];

const initialGameMachine = { phaseIndex: 0, currentDuel: 1, activeState: 'idle' };

function readPersistedAppState() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedAppState(nextState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // Ignoramos fallas de almacenamiento local para no bloquear el vivo.
  }
}

function readPersistedSessionState() {
  const persisted = readPersistedAppState();
  const session = persisted?.session;
  if (!session || typeof session !== 'object') return null;
  if (session.role !== 'host' && session.role !== 'participant') return null;
  return {
    role: session.role,
    screen: typeof session.screen === 'string' ? session.screen : 'menu',
    broadcastView: typeof session.broadcastView === 'string' ? session.broadcastView : 'show',
    hostUnlocked: Boolean(session.hostUnlocked),
    participantPlayerId: typeof session.participantPlayerId === 'string' ? session.participantPlayerId : null,
  };
}

function buildInitialPlayers() {
  const persisted = readPersistedAppState();
  if (Array.isArray(persisted?.players) && persisted.players.length) {
    return normalizePlayersCollection(persisted.players);
  }
  return normalizePlayersCollection(initialPlayers);
}

function getInitialRole() {
  return readPersistedSessionState()?.role ?? null;
}

function getInitialScreen() {
  const session = readPersistedSessionState();
  if (session?.role === 'participant') return 'participantLobby';
  if (session?.role === 'host') return typeof session.screen === 'string' ? session.screen : 'menu';
  return 'menu';
}

function getInitialBroadcastView() {
  return readPersistedSessionState()?.broadcastView ?? 'show';
}

function getInitialHostUnlocked() {
  const session = readPersistedSessionState();
  if (session?.role === 'host') return session.hostUnlocked;
  return !readPersistedAppState()?.hostPassword;
}

function getInitialParticipantIdentity() {
  const session = readPersistedSessionState();
  return session?.role === 'participant' && session.participantPlayerId
    ? { id: session.participantPlayerId }
    : null;
}

function buildInitialQuestions() {
  const persisted = readPersistedAppState();
  if (Array.isArray(persisted?.questions) && persisted.questions.length) {
    return persisted.questions;
  }
  return initialQuestions;
}

function buildInitialWheelThemes() {
  const persisted = readPersistedAppState();
  if (Array.isArray(persisted?.wheelThemes) && persisted.wheelThemes.length) {
    return persisted.wheelThemes.map((theme, index) => ({
      label: typeof theme?.label === 'string' && theme.label.trim() ? theme.label : initialWheelThemes[index]?.label ?? `Tema ${index + 1}`,
      emoji: typeof theme?.emoji === 'string' && theme.emoji.trim() ? theme.emoji : initialWheelThemes[index]?.emoji ?? '🎯',
    }));
  }
  return initialWheelThemes;
}

function buildInitialPlayerNumber() {
  const persisted = readPersistedAppState();
  if (typeof persisted?.nextPlayerNumber === 'number' && persisted.nextPlayerNumber > 0) {
    return persisted.nextPlayerNumber;
  }
  return initialPlayers.length + 1;
}

function buildInitialPlayerSortKey() {
  const persisted = readPersistedAppState();
  return ['playerNumber', 'name', 'points'].includes(persisted?.playerSortKey) ? persisted.playerSortKey : 'playerNumber';
}

function buildInitialPlayerSortDirection() {
  const persisted = readPersistedAppState();
  return persisted?.playerSortDirection === 'desc' ? 'desc' : 'asc';
}

function buildSharedAppState({
  players,
  questions,
  nextPlayerNumber,
  playerSortKey,
  playerSortDirection,
  rotationQueue,
  duelSeats,
  wheelThemes,
}) {
  return {
    players,
    questions,
    nextPlayerNumber,
    playerSortKey,
    playerSortDirection,
    rotationQueue,
    duelSeats,
    wheelThemes,
  };
}

function gameReducer(state, action) {
  switch (action.type) {
    case 'NEXT_PHASE': {
      const nextIndex = Math.min(state.phaseIndex + 1, gamePhases.length - 1);
      return { ...state, phaseIndex: nextIndex, activeState: nextIndex === gamePhases.length - 1 ? 'final' : 'running' };
    }
    case 'PREV_PHASE': {
      const prevIndex = Math.max(state.phaseIndex - 1, 0);
      return { ...state, phaseIndex: prevIndex, activeState: prevIndex === 0 ? 'idle' : 'running' };
    }
    case 'GOTO_PHASE':
      return { ...state, phaseIndex: action.index, activeState: action.index === 0 ? 'idle' : 'running' };
    case 'RESET_FLOW':
      return initialGameMachine;
    default:
      return state;
  }
}

function buildWheelGradient(items) {
  const step = 100 / items.length;
  const colors = ['#ff6a55', '#08b5aa', '#ffcb00', '#7bd84a', '#7a5cff', '#ff9b36', '#2dc7ff', '#ff5f8a'];
  return `conic-gradient(${items.map((item, index) => `${colors[index % colors.length]} ${index * step}% ${(index + 1) * step}%`).join(', ')})`;
}

function App() {
  const [screen, setScreen] = useState(getInitialScreen);
  const [appRole, setAppRole] = useState(getInitialRole);
  const [entryStep, setEntryStep] = useState('chooser');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hostAuthOpen, setHostAuthOpen] = useState(false);
  const [hostAccessTarget, setHostAccessTarget] = useState('playOptions');
  const [hostAuthAttempt, setHostAuthAttempt] = useState('');
  const [hostAuthError, setHostAuthError] = useState('');
  const [entryHostPassword, setEntryHostPassword] = useState('');
  const [entryParticipantPlayerId, setEntryParticipantPlayerId] = useState(() => initialPlayers[0]?.id ?? '');
  const [entryParticipantCode, setEntryParticipantCode] = useState('');
  const [entryParticipantError, setEntryParticipantError] = useState('');
  const [participantIdentity, setParticipantIdentity] = useState(getInitialParticipantIdentity);
  const [hostPassword, setHostPassword] = useState(() => readPersistedAppState()?.hostPassword ?? '');
  const [hostUnlocked, setHostUnlocked] = useState(getInitialHostUnlocked);
  const [hostPasswordCurrent, setHostPasswordCurrent] = useState('');
  const [hostPasswordDraft, setHostPasswordDraft] = useState(() => readPersistedAppState()?.hostPassword ?? '');
  const [hostPasswordConfirm, setHostPasswordConfirm] = useState(() => readPersistedAppState()?.hostPassword ?? '');
  const [hostSettingsMessage, setHostSettingsMessage] = useState('');
  const [broadcastView, setBroadcastView] = useState(getInitialBroadcastView);
  const [playFlowStep, setPlayFlowStep] = useState(0);
  const lastOutcomeSoundRef = useRef(0);
  const showLeftViewportRef = useRef(null);
  const showLeftTrackRef = useRef(null);
  const showRightViewportRef = useRef(null);
  const showRightTrackRef = useRef(null);
  const showDrawSettleTimeoutRef = useRef(null);
  const showDrawNeedsSettleRef = useRef(false);

  const [players, setPlayers] = useState(buildInitialPlayers);
  const [playerName, setPlayerName] = useState('');
  const [playerSortKey, setPlayerSortKey] = useState(buildInitialPlayerSortKey);
  const [playerSortDirection, setPlayerSortDirection] = useState(buildInitialPlayerSortDirection);
  const [nextPlayerNumber, setNextPlayerNumber] = useState(buildInitialPlayerNumber);
  const [celebratingPlayerId, setCelebratingPlayerId] = useState(null);
  const [rotationQueue, setRotationQueue] = useState(() => initialPlayers.map((player) => player.id));
  const [duelSeats, setDuelSeats] = useState(() => ({ playerA: initialPlayers[0]?.id ?? null, playerB: initialPlayers[1]?.id ?? null }));

  const [questions, setQuestions] = useState(buildInitialQuestions);
  const [wheelThemes, setWheelThemes] = useState(buildInitialWheelThemes);
  const [questionPrompt, setQuestionPrompt] = useState('');
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [questionTheme, setQuestionTheme] = useState('Historia');
  const [questionDifficulty, setQuestionDifficulty] = useState('Facil');
  const [questionFilterTheme, setQuestionFilterTheme] = useState('all');
  const [questionFilterStatus, setQuestionFilterStatus] = useState('all');
  const [questionFilterText, setQuestionFilterText] = useState('');
  const [questionSortKey, setQuestionSortKey] = useState('theme');
  const [questionSortDirection, setQuestionSortDirection] = useState('asc');
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportFeedback, setBulkImportFeedback] = useState('');
  const [editQuestionOpen, setEditQuestionOpen] = useState(false);
  const [editQuestionId, setEditQuestionId] = useState(null);
  const [wheelEditOpen, setWheelEditOpen] = useState(false);
  const [wheelEditDraft, setWheelEditDraft] = useState([]);
  const [editQuestionDraft, setEditQuestionDraft] = useState({
    prompt: '',
    answer: '',
    theme: 'Historia',
    difficulty: 'Facil',
    approved: true,
    used: false,
  });

  const [machine, dispatch] = useReducer(gameReducer, initialGameMachine);

  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [wheelResult, setWheelResult] = useState(null);
  const [pendingThemeIndex, setPendingThemeIndex] = useState(null);
  const wheelSpinFrameRef = useRef(null);
  const wheelResolveTimeoutRef = useRef(null);

  const [duelDrawState, setDuelDrawState] = useState({
    spinning: false,
    status: 'Listo para sortear',
    selection: null,
    leftOffset: 0,
    rightOffset: 0,
  });
  const duelDrawTimeoutRef = useRef(null);
  const showFlowTimeoutRef = useRef(null);
  const showReadyIntervalRef = useRef(null);
  const showWheelResolveTimeoutRef = useRef(null);

  const [duelTimer, setDuelTimer] = useState({ label: 'Listo', seconds: 0, running: false, mode: 'idle' });
  const duelTimerRef = useRef(null);

  const [liveState, setLiveState] = useState(initialLiveState);
  const [liveConnection, setLiveConnection] = useState('offline');
  const [liveQuestionDraft, setLiveQuestionDraft] = useState('¿En que ano se inauguro el Obelisco?');
  const [liveAnswerDraft, setLiveAnswerDraft] = useState('1936');
  const [liveThemeDraft, setLiveThemeDraft] = useState('Historia');
  const liveSocketRef = useRef(null);
  const liveStateRef = useRef(liveState);
  const hasLoadedInitialRotationRef = useRef(false);
  const hasHydratedSharedStateRef = useRef(false);
  const lastSharedStateHashRef = useRef('');

  const currentPhase = gamePhases[machine.phaseIndex];
  const liveCurrentPhase = LIVE_PHASES[liveState.phaseIndex];
  const rawShowState = liveState.show ?? {};
  const initialShowState = buildInitialShowState();
  const showState = {
    ...initialShowState,
    ...rawShowState,
    spinnerOffsets: {
      ...initialShowState.spinnerOffsets,
      ...(rawShowState.spinnerOffsets ?? {}),
    },
    duelNames: {
      ...initialShowState.duelNames,
      ...(rawShowState.duelNames ?? {}),
    },
    duelSelection: {
      ...initialShowState.duelSelection,
      ...(rawShowState.duelSelection ?? {}),
    },
    drawPool: Array.isArray(rawShowState.drawPool) ? rawShowState.drawPool : initialShowState.drawPool,
  };
  const showFlowStep = showState.flowStep;
  const showSpinnerActive = showState.spinnerActive;
  const showSpinnerSelection = showState.spinnerSelection;
  const showSpinnerOffsets = showState.spinnerOffsets;
  const showDuelNames = showState.duelNames;
  const showDuelSelection = showState.duelSelection;
  const showDrawPool = showState.drawPool;
  const showReadyCountdown = showState.readyCountdown;
  const showIntroExiting = showState.introExiting;
  const showDuelLaunched = Boolean(showState.duelLaunched);
  const showWheelRotation = typeof showState.wheelRotation === 'number' ? showState.wheelRotation : 0;
  const showWheelResult = typeof showState.wheelResult === 'string' && showState.wheelResult.trim() ? showState.wheelResult : null;
  const showWheelSpinning = Boolean(showState.wheelSpinning);
  const patchShowState = (patch) => {
    dispatchLiveAction({ type: 'SHOW_PATCH', patch });
  };
  const resolveNextValue = (current, next) => (typeof next === 'function' ? next(current) : next);
  const getCurrentShowState = () => ({ ...buildInitialShowState(), ...(liveStateRef.current.show ?? {}) });
  const setShowFlowStep = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ flowStep: resolveNextValue(currentShowState.flowStep, next) });
  };
  const setShowSpinnerActive = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ spinnerActive: resolveNextValue(currentShowState.spinnerActive, next) });
  };
  const setShowSpinnerSelection = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ spinnerSelection: resolveNextValue(currentShowState.spinnerSelection, next) });
  };
  const setShowSpinnerOffsets = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ spinnerOffsets: resolveNextValue(currentShowState.spinnerOffsets, next) });
  };
  const setShowDuelNames = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ duelNames: resolveNextValue(currentShowState.duelNames, next) });
  };
  const setShowDuelSelection = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ duelSelection: resolveNextValue(currentShowState.duelSelection, next) });
  };
  const setShowDrawPool = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ drawPool: resolveNextValue(currentShowState.drawPool, next) });
  };
  const setShowReadyCountdown = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ readyCountdown: resolveNextValue(currentShowState.readyCountdown, next) });
  };
  const setShowIntroExiting = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ introExiting: resolveNextValue(currentShowState.introExiting, next) });
  };
  const setShowWheelRotation = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ wheelRotation: resolveNextValue(currentShowState.wheelRotation, next) });
  };
  const setShowWheelResult = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ wheelResult: resolveNextValue(currentShowState.wheelResult, next) });
  };
  const setShowWheelSpinning = (next) => {
    const currentShowState = getCurrentShowState();
    patchShowState({ wheelSpinning: resolveNextValue(currentShowState.wheelSpinning, next) });
  };
  const resetShowPresentation = () => {
    patchShowState({
      ...buildInitialShowState(),
      readyCountdown: SHOW_READY_COUNTDOWN_SECONDS,
    });
  };
  const returnShowToStandby = () => {
    patchShowState({
      ...buildInitialShowState(),
      flowStep: 'standby',
      readyCountdown: SHOW_READY_COUNTDOWN_SECONDS,
    });
  };
  const wheelStep = 360 / wheelThemes.length;
  const buildNextWheelSpin = (currentRotation) => {
    const targetIndex = Math.floor(Math.random() * wheelThemes.length);
    const currentNormalized = ((currentRotation % 360) + 360) % 360;
    const targetNormalized = 360 - targetIndex * wheelStep - wheelStep / 2;
    const extraTurns = 5 + Math.floor(Math.random() * 3);
    return {
      targetIndex,
      nextRotation: currentRotation + (targetNormalized - currentNormalized + extraTurns * 360),
    };
  };
  const wheelBackground = useMemo(() => buildWheelGradient(wheelThemes), [wheelThemes]);
  const liveTurnSide = liveState.turnSide ?? 'playerA';
  const liveStealSide = liveTurnSide === 'playerA' ? 'playerB' : 'playerA';
  const liveTurnName = liveState.teamNames[liveTurnSide];
  const liveStealName = liveState.teamNames[liveStealSide];
  const liveDuelWinnerName = liveState.duelWinnerSide ? liveState.teamNames[liveState.duelWinnerSide] : null;
  const liveResponderName = liveState.responderSide ? liveState.teamNames[liveState.responderSide] : null;
  const liveOutcomeName = liveState.responseOutcome?.side ? liveState.teamNames[liveState.responseOutcome.side] : null;
  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  const duelSeatPlayerA = players.find((player) => player.id === duelSeats.playerA) ?? null;
  const duelSeatPlayerB = players.find((player) => player.id === duelSeats.playerB) ?? null;
  const duelSeatThemeA = getPlayerThemeById(duelSeatPlayerA?.themeId, duelSeatPlayerA?.playerNumber);
  const duelSeatThemeB = getPlayerThemeById(duelSeatPlayerB?.themeId, duelSeatPlayerB?.playerNumber);
  const duelDrawBlockedPlayerId = duelSeatPlayerA?.winStreak > 0 ? duelSeatPlayerA.id : duelSeatPlayerB?.winStreak > 0 ? duelSeatPlayerB.id : null;
  const duelDrawEligiblePlayers = useMemo(() => {
    return players.filter((player) => player.active && !player.imbatible && player.id !== duelDrawBlockedPlayerId);
  }, [players, duelDrawBlockedPlayerId]);
  const duelDrawTrack = useMemo(() => {
    if (!duelDrawEligiblePlayers.length) return [];
    return Array.from({ length: 5 }, () => duelDrawEligiblePlayers).flat();
  }, [duelDrawEligiblePlayers]);
  const duelDrawResultPlayerA = duelDrawState.selection ? players.find((player) => player.id === duelDrawState.selection.playerAId) ?? null : null;
  const duelDrawResultPlayerB = duelDrawState.selection ? players.find((player) => player.id === duelDrawState.selection.playerBId) ?? null : null;

  const activePlayers = players.filter((player) => player.active).length;
  const imbatibles = players.filter((player) => player.imbatible).length;
  const currentParticipant = participantIdentity ? players.find((player) => player.id === participantIdentity.id) ?? participantIdentity : null;

  useEffect(() => {
    if (!players.length) return;
    if (!players.some((player) => player.id === entryParticipantPlayerId)) {
      setEntryParticipantPlayerId(players[0].id);
    }
  }, [entryParticipantPlayerId, players]);

  useEffect(() => {
    if (appRole !== 'participant') return;
    if (!currentParticipant) {
      setParticipantIdentity(null);
      setAppRole(null);
      setEntryStep('chooser');
      setEntryParticipantCode('');
      setEntryParticipantError('Ese participante ya no está disponible.');
      window.history.replaceState({ screen: 'menu' }, '', '#menu');
      setScreen('menu');
    }
  }, [appRole, currentParticipant]);

  const sortedPlayers = useMemo(() => {
    const direction = playerSortDirection === 'asc' ? 1 : -1;
    return [...players].sort((a, b) => {
      let comparison = 0;
      if (playerSortKey === 'name') comparison = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      else if (playerSortKey === 'points') comparison = a.points - b.points;
      else comparison = a.playerNumber - b.playerNumber;
      return comparison * direction;
    });
  }, [players, playerSortDirection, playerSortKey]);

  const finalRanking = useMemo(() => {
    return [...players].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.roundsWon !== a.roundsWon) return b.roundsWon - a.roundsWon;
      if (b.stealsWon !== a.stealsWon) return b.stealsWon - a.stealsWon;
      if (a.imbatible !== b.imbatible) return Number(b.imbatible) - Number(a.imbatible);
      return a.playerNumber - b.playerNumber;
    });
  }, [players]);

  const finalContenders = finalRanking.slice(0, Math.min(4, finalRanking.length));
  const finalWinner = finalRanking[0] ?? null;
  const finalCutoffPoints = finalContenders.length ? finalContenders[finalContenders.length - 1].points : 0;
  const finalTiePlayers = finalRanking.filter((player) => player.points === finalCutoffPoints);
  const showEligiblePlayers = useMemo(() => players.filter((player) => player.active && !player.imbatible), [players]);
  const showDrawEligiblePool = showDrawPool.length ? showDrawPool : showEligiblePlayers;
  const showDrawTrack = useMemo(() => {
    if (!showDrawEligiblePool.length) return [];
    return Array.from({ length: 5 }, () => showDrawEligiblePool).flat();
  }, [showDrawEligiblePool]);
  const showSelectedPlayerLeft = showDuelSelection.leftId ? showDrawEligiblePool.find((player) => player.id === showDuelSelection.leftId) ?? players.find((player) => player.id === showDuelSelection.leftId) ?? null : null;
  const showSelectedPlayerRight = showDuelSelection.rightId ? showDrawEligiblePool.find((player) => player.id === showDuelSelection.rightId) ?? players.find((player) => player.id === showDuelSelection.rightId) ?? null : null;
  const showSelectedThemeLeft = getPlayerThemeById(showSelectedPlayerLeft?.themeId, showSelectedPlayerLeft?.playerNumber);
  const showSelectedThemeRight = getPlayerThemeById(showSelectedPlayerRight?.themeId, showSelectedPlayerRight?.playerNumber);
  const showDrawRevealReady = Boolean(!showSpinnerActive && showDuelSelection.leftId && showDuelSelection.rightId);
  const formatPlayerNumber = (value) => `#${String(value ?? '?').padStart(2, '0')}`;

  const navigateToScreen = (nextScreen) => {
    if (!isScreenAllowedForRole(nextScreen)) return;
    if (nextScreen === screen) return;
    window.history.pushState({ screen: nextScreen }, '', `#${nextScreen}`);
    setScreen(nextScreen);
  };

  const goBackScreen = () => {
    window.history.back();
  };

  const isScreenAllowedForRole = (nextScreen) => {
    if (appRole === 'host') return true;
    if (appRole === 'participant') return nextScreen === 'participantLobby';
    return false;
  };

  const openRoleStep = (nextStep) => {
    setEntryStep(nextStep);
    setEntryParticipantError('');
    setEntryHostPassword('');
    setEntryParticipantCode('');
    setHostAuthError('');
  };

  const logoutAccess = () => {
    setAppRole(null);
    setParticipantIdentity(null);
    setEntryStep('chooser');
    setEntryHostPassword('');
    setEntryParticipantCode('');
    setEntryParticipantError('');
    setHostAuthAttempt('');
    setHostAuthError('');
    setHostAuthOpen(false);
    setSettingsOpen(false);
    window.history.replaceState({ screen: 'menu' }, '', '#menu');
    setScreen('menu');
  };

  const grantHostAccess = () => {
    setAppRole('host');
    setHostUnlocked(true);
    setHostAuthOpen(false);
    setHostAuthError('');
    setEntryStep('chooser');
    setEntryHostPassword('');
    setEntryParticipantCode('');
    setEntryParticipantError('');
    window.history.replaceState({ screen: 'menu' }, '', '#menu');
    setScreen('menu');
  };

  const submitEntryHostPassword = () => {
    const attempt = entryHostPassword.trim();
    const requiredPassword = hostPassword.trim();

    if (!requiredPassword || attempt === requiredPassword) {
      grantHostAccess();
      return;
    }

    setHostAuthError('Contraseña incorrecta');
  };

  const submitParticipantAccess = () => {
    const selectedPlayer = players.find((player) => player.id === entryParticipantPlayerId) ?? null;
    const attemptCode = normalizeAccessCode(entryParticipantCode);
    const expectedCode = normalizeAccessCode(selectedPlayer?.accessCode ?? '');

    if (!selectedPlayer) {
      setEntryParticipantError('Elegí un participante.');
      return;
    }

    if (!attemptCode) {
      setEntryParticipantError('Ingresá tu código.');
      return;
    }

    if (attemptCode !== expectedCode) {
      setEntryParticipantError('Código incorrecto.');
      return;
    }

    setParticipantIdentity(selectedPlayer);
    setAppRole('participant');
    setEntryStep('chooser');
    setEntryParticipantError('');
    setEntryParticipantCode('');
    setEntryHostPassword('');
    window.history.replaceState({ screen: 'participantLobby' }, '', '#participantLobby');
    setScreen('participantLobby');
  };

  const requestHostAccess = (target) => {
    const trimmedPassword = hostPassword.trim();
    setHostAccessTarget(target);
    setHostAuthError('');
    setHostAuthAttempt('');

    if (!trimmedPassword) {
      setHostUnlocked(true);
      if (target === 'settings') {
        setSettingsOpen(true);
      } else if (target === 'showMvp') {
        resetShowPresentation();
        navigateToScreen('showMvp');
      } else {
        setPlayFlowStep(0);
        navigateToScreen('playOptions');
      }
      return;
    }

    if (hostUnlocked) {
      if (target === 'settings') {
        setSettingsOpen(true);
      } else if (target === 'showMvp') {
        resetShowPresentation();
        navigateToScreen('showMvp');
      } else {
        setPlayFlowStep(0);
        navigateToScreen('playOptions');
      }
      return;
    }

    setHostAuthOpen(true);
  };

  const submitHostPassword = () => {
    const attempt = hostAuthAttempt.trim();
    const trimmedPassword = hostPassword.trim();

    if (!trimmedPassword) {
      setHostUnlocked(true);
      setHostAuthOpen(false);
      setHostAuthError('');
      return;
    }

    if (attempt === trimmedPassword) {
      setHostUnlocked(true);
      setHostAuthOpen(false);
      setHostAuthError('');
      const target = hostAccessTarget;
      setHostAccessTarget('playOptions');
      if (target === 'settings') {
        setSettingsOpen(true);
      } else if (target === 'showMvp') {
        resetShowPresentation();
        navigateToScreen('showMvp');
      } else {
        setPlayFlowStep(0);
        navigateToScreen('playOptions');
      }
      return;
    }

    setHostAuthError('Contraseña incorrecta');
  };

  const saveSettings = () => {
    const nextPassword = hostPasswordDraft.trim();
    const currentPassword = hostPassword.trim();
    const currentAttempt = hostPasswordCurrent.trim();
    const confirmAttempt = hostPasswordConfirm.trim();

    if (currentPassword && currentAttempt !== currentPassword) {
      setHostSettingsMessage('La contraseña actual no coincide.');
      return;
    }

    if (nextPassword !== confirmAttempt) {
      setHostSettingsMessage('La nueva contraseña y la confirmacion no coinciden.');
      return;
    }

    setHostPassword(nextPassword);
    setHostUnlocked(true);
    setHostPasswordCurrent('');
    setHostSettingsMessage(nextPassword ? 'Contraseña de host guardada.' : 'Host sin contraseña.');
    setSettingsOpen(false);
  };

  const saveWheelThemes = () => {
    const nextThemes = wheelEditDraft.map((theme, index) => ({
      label: theme.label.trim() || initialWheelThemes[index]?.label || `Tema ${index + 1}`,
      emoji: theme.emoji.trim() || initialWheelThemes[index]?.emoji || '🎯',
    }));

    setWheelThemes(nextThemes);
    setWheelEditOpen(false);
  };

  const filteredQuestions = useMemo(() => {
    const direction = questionSortDirection === 'asc' ? 1 : -1;
    const searchTerm = questionFilterText.trim().toLowerCase();
    return [...questions]
      .filter((question) => {
        const themeMatches = questionFilterTheme === 'all' || question.theme === questionFilterTheme;
        const statusMatches =
          questionFilterStatus === 'all' ||
          (questionFilterStatus === 'used' && question.used) ||
          (questionFilterStatus === 'unused' && !question.used) ||
          (questionFilterStatus === 'approved' && question.approved) ||
          (questionFilterStatus === 'pending' && !question.approved);
        const textMatches = !searchTerm || question.prompt.toLowerCase().includes(searchTerm) || question.answer.toLowerCase().includes(searchTerm);
        return themeMatches && statusMatches && textMatches;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (questionSortKey === 'status') {
          const aStatus = Number(a.approved) + Number(a.used);
          const bStatus = Number(b.approved) + Number(b.used);
          comparison = aStatus - bStatus;
        } else if (questionSortKey === 'difficulty') {
          const difficultyOrder = { Facil: 1, Media: 2, Dificil: 3 };
          comparison = difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
        } else if (questionSortKey === 'used') {
          comparison = Number(a.used) - Number(b.used);
        } else {
          comparison = a.theme.localeCompare(b.theme, 'es', { sensitivity: 'base' });
        }
        return comparison * direction;
      });
  }, [questions, questionFilterStatus, questionFilterText, questionFilterTheme, questionSortDirection, questionSortKey]);

  const questionCategories = useMemo(() => {
    const categories = new Set([...wheelThemes.map((theme) => theme.label), ...questions.map((question) => question.theme), questionTheme].filter(Boolean));
    return [...categories];
  }, [questions, questionTheme]);

  useEffect(() => {
    setWheelEditDraft(wheelThemes.map((theme) => ({ ...theme })));
  }, [wheelThemes]);
  useEffect(() => {
    const initialHash = window.location.hash.replace('#', '');
    const initialScreen = ['menu', 'playOptions', 'themeWheel', 'players', 'questions', 'broadcast', 'final', 'showMvp', 'competitors', 'participantLobby'].includes(initialHash)
      ? initialHash
      : 'menu';
    if (initialScreen !== screen) {
      setScreen(initialScreen);
    }
    window.history.replaceState({ screen: initialScreen }, '', `#${initialScreen}`);

    const handlePopState = (event) => {
      const nextScreen = event.state?.screen ?? (window.location.hash.replace('#', '') || 'menu');
      if (['menu', 'playOptions', 'themeWheel', 'players', 'questions', 'broadcast', 'final', 'showMvp', 'competitors', 'participantLobby'].includes(nextScreen)) {
        setScreen(nextScreen);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    setHostPasswordDraft(hostPassword);
    setHostPasswordConfirm(hostPassword);
    setHostPasswordCurrent('');
    setHostSettingsMessage('');
  }, [settingsOpen, hostPassword]);

  useEffect(() => {
    if (!HOST_SCREENS.has(screen)) return;
    if (!hostPassword.trim()) return;
    if (hostUnlocked) return;
    setHostAccessTarget(screen);
    setHostAuthAttempt('');
    setHostAuthError('');
    setHostAuthOpen(true);
    if (screen !== 'menu') {
      window.history.replaceState({ screen: 'menu' }, '', '#menu');
      setScreen('menu');
    }
  }, [screen, hostPassword, hostUnlocked]);

  useEffect(() => {
    const persisted = readPersistedAppState();
    if (!persisted || hasLoadedInitialRotationRef.current) return;

    if (Array.isArray(persisted.rotationQueue)) {
      setRotationQueue(persisted.rotationQueue);
    }

    if (persisted.duelSeats && typeof persisted.duelSeats === 'object') {
      setDuelSeats({
        playerA: persisted.duelSeats.playerA ?? initialPlayers[0]?.id ?? null,
        playerB: persisted.duelSeats.playerB ?? initialPlayers[1]?.id ?? null,
      });
    }

    hasLoadedInitialRotationRef.current = true;
  }, []);

  useEffect(() => {
    writePersistedAppState({
      players,
      questions,
      nextPlayerNumber,
      playerSortKey,
      playerSortDirection,
      rotationQueue,
      duelSeats,
      hostPassword,
      wheelThemes,
      session: appRole ? {
        role: appRole,
        screen,
        broadcastView,
        hostUnlocked,
        participantPlayerId: participantIdentity?.id ?? null,
      } : null,
    });
  }, [appRole, broadcastView, duelSeats, hostPassword, hostUnlocked, nextPlayerNumber, participantIdentity, players, playerSortDirection, playerSortKey, questions, rotationQueue, screen, wheelThemes]);

  useEffect(() => {
    if (!hasHydratedSharedStateRef.current || !liveSocketRef.current) return;

    const sharedAppState = buildSharedAppState({
      players,
      questions,
      nextPlayerNumber,
      playerSortKey,
      playerSortDirection,
      rotationQueue,
      duelSeats,
      wheelThemes,
    });
    const nextHash = JSON.stringify(sharedAppState);
    if (nextHash === lastSharedStateHashRef.current) return;

    lastSharedStateHashRef.current = nextHash;
    liveSocketRef.current.emit('action', {
      type: 'SYNC_APP_STATE',
      payload: sharedAppState,
    });
  }, [players, questions, nextPlayerNumber, playerSortKey, playerSortDirection, rotationQueue, duelSeats, wheelThemes]);

  useEffect(() => {
    const serverUrl =
      import.meta.env.VITE_LIVE_SERVER_URL ??
      (window.location.port === '5173'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : window.location.origin);
    const socket = io(serverUrl, { transports: ['websocket'], reconnection: true });

    if (!socket) return undefined;

    liveSocketRef.current = socket;
    setLiveConnection('connecting');
    socket.on('connect', () => setLiveConnection('connected'));
    socket.on('disconnect', () => setLiveConnection('offline'));
    socket.on('connect_error', () => setLiveConnection('offline'));
    socket.on('state', (state) => {
      setLiveState(state);

      const sharedAppState = state.sharedAppState;
      if (sharedAppState) {
        const nextHash = JSON.stringify(sharedAppState);
        if (nextHash !== lastSharedStateHashRef.current) {
          lastSharedStateHashRef.current = nextHash;
          if (Array.isArray(sharedAppState.players)) setPlayers(normalizePlayersCollection(sharedAppState.players));
          if (Array.isArray(sharedAppState.questions)) setQuestions(sharedAppState.questions);
          if (typeof sharedAppState.nextPlayerNumber === 'number' && sharedAppState.nextPlayerNumber > 0) setNextPlayerNumber(sharedAppState.nextPlayerNumber);
          if (['playerNumber', 'name', 'points'].includes(sharedAppState.playerSortKey)) setPlayerSortKey(sharedAppState.playerSortKey);
          if (sharedAppState.playerSortDirection === 'desc' || sharedAppState.playerSortDirection === 'asc') setPlayerSortDirection(sharedAppState.playerSortDirection);
          if (Array.isArray(sharedAppState.rotationQueue)) setRotationQueue(sharedAppState.rotationQueue);
          if (sharedAppState.duelSeats && typeof sharedAppState.duelSeats === 'object') setDuelSeats(sharedAppState.duelSeats);
          if (Array.isArray(sharedAppState.wheelThemes)) setWheelThemes(sharedAppState.wheelThemes);
        }
      }

      hasHydratedSharedStateRef.current = true;
    });

    return () => {
      socket.disconnect();
      liveSocketRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    if (wheelSpinFrameRef.current) window.cancelAnimationFrame(wheelSpinFrameRef.current);
    if (wheelResolveTimeoutRef.current) window.clearTimeout(wheelResolveTimeoutRef.current);
    if (duelTimerRef.current) window.clearInterval(duelTimerRef.current);
    if (duelDrawTimeoutRef.current) window.clearTimeout(duelDrawTimeoutRef.current);
    if (showFlowTimeoutRef.current) window.clearTimeout(showFlowTimeoutRef.current);
    if (showReadyIntervalRef.current) window.clearInterval(showReadyIntervalRef.current);
    if (showDrawSettleTimeoutRef.current) window.clearTimeout(showDrawSettleTimeoutRef.current);
    if (showWheelResolveTimeoutRef.current) window.clearTimeout(showWheelResolveTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (showFlowTimeoutRef.current) {
      window.clearTimeout(showFlowTimeoutRef.current);
      showFlowTimeoutRef.current = null;
    }
    if (showReadyIntervalRef.current) {
      window.clearInterval(showReadyIntervalRef.current);
      showReadyIntervalRef.current = null;
    }

    if (screen !== 'showMvp') return undefined;

    if (showFlowStep === 'intro') {
      setShowIntroExiting(false);
      showFlowTimeoutRef.current = window.setTimeout(() => setShowIntroExiting(true), 13800);
    }

    if (showFlowStep === 'versus') {
      showFlowTimeoutRef.current = window.setTimeout(() => setShowFlowStep('ready'), 2200);
    }

    if (showFlowStep === 'ready') {
      setShowReadyCountdown(SHOW_READY_COUNTDOWN_SECONDS);
      showReadyIntervalRef.current = window.setInterval(() => {
        setShowReadyCountdown((current) => {
          if (current <= 1) {
            if (showReadyIntervalRef.current) {
              window.clearInterval(showReadyIntervalRef.current);
              showReadyIntervalRef.current = null;
            }
            return 0;
          }
          return current - 1;
        });
      }, 1000);
    }

    return () => {
      if (showFlowTimeoutRef.current) {
        window.clearTimeout(showFlowTimeoutRef.current);
        showFlowTimeoutRef.current = null;
      }
      if (showReadyIntervalRef.current) {
        window.clearInterval(showReadyIntervalRef.current);
        showReadyIntervalRef.current = null;
      }
    };
  }, [screen, showFlowStep]);

  useEffect(() => {
    if (screen !== 'showMvp' || showFlowStep !== 'intro' || !showIntroExiting) return undefined;
    showFlowTimeoutRef.current = window.setTimeout(() => {
      setShowFlowStep('standby');
      setShowIntroExiting(false);
    }, 1200);

    return () => {
      if (showFlowTimeoutRef.current) {
        window.clearTimeout(showFlowTimeoutRef.current);
        showFlowTimeoutRef.current = null;
      }
    };
  }, [screen, showFlowStep, showIntroExiting]);

  useEffect(() => {
    if (screen !== 'showMvp' || showFlowStep !== 'ready' || showReadyCountdown !== 0) return undefined;
    showFlowTimeoutRef.current = window.setTimeout(() => {
      startShowDuel();
    }, 180);

    return () => {
      if (showFlowTimeoutRef.current) {
        window.clearTimeout(showFlowTimeoutRef.current);
        showFlowTimeoutRef.current = null;
      }
    };
  }, [screen, showFlowStep, showReadyCountdown]);

  useEffect(() => {
    if (screen !== 'showMvp' || showFlowStep !== 'draw' || showSpinnerActive) return undefined;
    if (!showDrawNeedsSettleRef.current) return undefined;
    if (!showDuelSelection.leftId || !showDuelSelection.rightId) return undefined;

    showDrawNeedsSettleRef.current = false;

    if (showDrawSettleTimeoutRef.current) {
      window.clearTimeout(showDrawSettleTimeoutRef.current);
      showDrawSettleTimeoutRef.current = null;
    }

    window.requestAnimationFrame(() => {
      const leftAdjustment = snapShowRollerToSelection(showLeftViewportRef.current, showLeftTrackRef.current, showDuelSelection.leftId, showDrawEligiblePool);
      const rightAdjustment = snapShowRollerToSelection(showRightViewportRef.current, showRightTrackRef.current, showDuelSelection.rightId, showDrawEligiblePool);

      setShowSpinnerOffsets((current) => ({
        left: current.left + (leftAdjustment ?? 0),
        right: current.right + (rightAdjustment ?? 0),
      }));
    });

    return () => {
      if (showDrawSettleTimeoutRef.current) {
        window.clearTimeout(showDrawSettleTimeoutRef.current);
        showDrawSettleTimeoutRef.current = null;
      }
    };
  }, [screen, showFlowStep, showSpinnerActive, showDuelSelection.leftId, showDuelSelection.rightId, showDrawEligiblePool]);

  useEffect(() => {
    if (duelSeatPlayerA && duelSeatPlayerB) {
      dispatchLiveAction({
        type: 'SET_TEAM_NAMES',
        playerA: duelSeatPlayerA.name,
        playerB: duelSeatPlayerB.name,
      });
    }
  }, [duelSeatPlayerA?.id, duelSeatPlayerB?.id]);

  useEffect(() => {
    const outcomeToken = liveState.responseOutcome?.token;
    if (!outcomeToken || outcomeToken === lastOutcomeSoundRef.current) return;
    lastOutcomeSoundRef.current = outcomeToken;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    const tonePlan = liveState.responseOutcome.status === 'success'
      ? [
          { freq: 660, duration: 0.12, delay: 0 },
          { freq: 880, duration: 0.16, delay: 0.13 },
        ]
      : [
          { freq: 240, duration: 0.18, delay: 0 },
          { freq: 180, duration: 0.22, delay: 0.2 },
        ];

    tonePlan.forEach((tone) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = liveState.responseOutcome.status === 'success' ? 'triangle' : 'sawtooth';
      oscillator.frequency.value = tone.freq;
      gain.gain.setValueAtTime(0.0001, context.currentTime + tone.delay);
      gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + tone.delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + tone.delay + tone.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + tone.delay);
      oscillator.stop(context.currentTime + tone.delay + tone.duration + 0.02);
    });

    window.setTimeout(() => {
      context.close().catch(() => {});
    }, 900);
  }, [liveState.responseOutcome]);

  const addPlayer = () => {
    const trimmed = playerName.trim();
    if (!trimmed) return;
    const newPlayerId = `p-${Date.now()}`;
    const theme = getPlayerThemeByNumber(nextPlayerNumber);
    setPlayers((current) => [...current, {
      id: newPlayerId,
      playerNumber: nextPlayerNumber,
      name: trimmed,
      accessCode: createRandomAccessCode(current.map((player) => player.accessCode)),
      themeId: theme.id,
      themeLabel: theme.label,
      points: 0,
      roundsWon: 0,
      stealsWon: 0,
      winStreak: 0,
      active: true,
      imbatible: false,
    }]);
    setRotationQueue((current) => [...current, newPlayerId]);
    if (!duelSeats.playerA) {
      setDuelSeats((current) => ({ ...current, playerA: newPlayerId }));
    } else if (!duelSeats.playerB) {
      setDuelSeats((current) => ({ ...current, playerB: newPlayerId }));
    }
    setNextPlayerNumber((current) => current + 1);
    setPlayerName('');
  };

  const updatePlayer = (playerId, updater) => {
    setPlayers((current) => current.map((player) => (player.id === playerId ? updater(player) : player)));
  };

  const updatePlayerById = (playerId, updater) => {
    setPlayers((current) => current.map((player) => (player.id === playerId ? updater(player) : player)));
  };

  const buildDuelDrawOffset = (playerId, poolSize) => {
    const index = duelDrawEligiblePlayers.findIndex((player) => player.id === playerId);
    if (index === -1) return 0;
    const centerOffset = DUEL_DRAW_VIEWPORT_HEIGHT / 2 - DUEL_DRAW_ITEM_HEIGHT / 2;
    const targetSlot = poolSize * 2 + index;
    return centerOffset - targetSlot * DUEL_DRAW_ITEM_HEIGHT;
  };

  const snapShowRollerToSelection = (viewportElement, trackElement, playerId, pool = showDrawEligiblePool) => {
    if (!viewportElement || !trackElement) return null;
    const selectedIndex = pool.findIndex((player) => player.id === playerId);
    if (selectedIndex === -1) return null;

    const targetSlot = pool.length * 2 + selectedIndex;
    const targetItem = trackElement.children[targetSlot];
    if (!targetItem) return null;

    const viewportRect = viewportElement.getBoundingClientRect();
    const targetRect = targetItem.getBoundingClientRect();
    return (viewportRect.top + viewportRect.height / 2) - (targetRect.top + targetRect.height / 2);
  };

  const rebuildRotationQueue = (nextPlayers, previousQueue = rotationQueue) => {
    const eligibleIds = nextPlayers.filter((player) => player.active && !player.imbatible).map((player) => player.id);
    const queue = previousQueue.filter((id) => eligibleIds.includes(id));
    eligibleIds.forEach((id) => {
      if (!queue.includes(id)) queue.push(id);
    });
    return queue;
  };

  const syncDuelSeats = (nextQueue) => {
    setDuelSeats({
      playerA: nextQueue[0] ?? null,
      playerB: nextQueue[1] ?? null,
    });
  };

  const toggleImbatible = (playerId) => {
    const nextPlayers = players.map((player) => {
      if (player.id !== playerId) return player;
      const nextImbatible = !player.imbatible;
      const nextPoints = nextImbatible ? player.points + IMBATIBLE_BONUS_POINTS : Math.max(0, player.points - IMBATIBLE_BONUS_POINTS);
      return { ...player, imbatible: nextImbatible, points: nextPoints, winStreak: nextImbatible ? Math.max(player.winStreak, 3) : 0 };
    });
    const nextQueue = rebuildRotationQueue(nextPlayers, rotationQueue);
    setPlayers(nextPlayers);
    setRotationQueue(nextQueue.filter(Boolean));
    syncDuelSeats(nextQueue.filter(Boolean));
    setCelebratingPlayerId(playerId);
    window.setTimeout(() => setCelebratingPlayerId(null), 900);
  };

  const setPlayerActive = (playerId, active) => {
    const nextPlayers = players.map((player) => (player.id === playerId ? { ...player, active } : player));
    const nextQueue = rebuildRotationQueue(nextPlayers, rotationQueue);
    setPlayers(nextPlayers);
    setRotationQueue(nextQueue);
    syncDuelSeats(nextQueue);
  };

  const removePlayer = (playerId) => {
    const nextPlayers = players.filter((player) => player.id !== playerId);
    const nextQueue = rebuildRotationQueue(nextPlayers, rotationQueue.filter((id) => id !== playerId));
    setPlayers(nextPlayers);
    setRotationQueue(nextQueue);
    syncDuelSeats(nextQueue);
    setNextPlayerNumber(nextPlayers.length ? Math.max(...nextPlayers.map((player) => player.playerNumber)) + 1 : 1);
  };

  const addQuestion = () => {
    const trimmedPrompt = questionPrompt.trim();
    const trimmedAnswer = questionAnswer.trim();
    if (!trimmedPrompt || !trimmedAnswer) return;
    setQuestions((current) => [...current, { id: `q-${Date.now()}`, prompt: trimmedPrompt, answer: trimmedAnswer, theme: questionTheme, difficulty: questionDifficulty, used: false, approved: true }]);
    setQuestionPrompt('');
    setQuestionAnswer('');
    setQuestionTheme('Historia');
    setQuestionDifficulty('Facil');
  };

  const updateQuestion = (questionId, updater) => {
    setQuestions((current) => current.map((question) => (question.id === questionId ? updater(question) : question)));
  };

  const openEditQuestion = (question) => {
    setEditQuestionId(question.id);
    setEditQuestionDraft({
      prompt: question.prompt,
      answer: question.answer,
      theme: question.theme,
      difficulty: question.difficulty,
      approved: question.approved,
      used: question.used,
    });
    setEditQuestionOpen(true);
  };

  const saveEditQuestion = () => {
    if (!editQuestionId) return;
    const trimmedPrompt = editQuestionDraft.prompt.trim();
    const trimmedAnswer = editQuestionDraft.answer.trim();
    if (!trimmedPrompt || !trimmedAnswer) return;
    updateQuestion(editQuestionId, (current) => ({
      ...current,
      prompt: trimmedPrompt,
      answer: trimmedAnswer,
      theme: editQuestionDraft.theme,
      difficulty: editQuestionDraft.difficulty,
      approved: Boolean(editQuestionDraft.approved),
      used: Boolean(editQuestionDraft.used),
    }));
    setEditQuestionOpen(false);
    setEditQuestionId(null);
  };

  const parseBulkQuestions = (inputText) => {
    const normalized = inputText.trim();
    if (!normalized) return [];

    const blocks = normalized
      .split(/\n\s*\n|^\s*---+\s*$/gm)
      .map((block) => block.trim())
      .filter(Boolean);

    const parseBool = (value) => {
      const normalizedValue = value.trim().toLowerCase();
      return ['si', 'sí', 's', 'true', '1', 'si.', 'on', 'yes', 'y'].includes(normalizedValue);
    };

    const parseDifficulty = (value) => {
      const normalizedValue = value.trim().toLowerCase();
      if (normalizedValue.startsWith('dif')) return 'Dificil';
      if (normalizedValue.startsWith('med')) return 'Media';
      return 'Facil';
    };

    const parseBlock = (block) => {
      const normalizedBlock = block.replace(/\r/g, '\n');
      const fieldPattern = /\b(tema|theme|pregunta|question|respuesta|answer|dificultad|difficulty|aprobada|approved|usada|used)\s*:/gi;
      const matches = [...normalizedBlock.matchAll(fieldPattern)];
      const fields = {};

      matches.forEach((match, index) => {
        const rawKey = match[1].toLowerCase();
        const nextMatch = matches[index + 1];
        const rawValue = normalizedBlock
          .slice(match.index + match[0].length, nextMatch ? nextMatch.index : normalizedBlock.length)
          .trim()
          .replace(/\s*\n\s*/g, '\n')
          .replace(/\s{2,}/g, ' ');
        fields[rawKey] = rawValue;
      });

      const prompt = fields.pregunta ?? fields.question ?? '';
      const answer = fields.respuesta ?? fields.answer ?? '';
      const theme = fields.tema ?? fields.theme ?? questionTheme ?? 'Historia';
      const difficulty = parseDifficulty(fields.dificultad ?? fields.difficulty ?? questionDifficulty);
      const approvedRaw = fields.aprobada ?? fields.approved;
      const usedRaw = fields.usada ?? fields.used;
      const approved = approvedRaw ? parseBool(approvedRaw) : true;
      const used = usedRaw ? parseBool(usedRaw) : false;

      if (!prompt.trim() || !answer.trim()) return null;

      return {
        id: `q-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        prompt: prompt.trim(),
        answer: answer.trim(),
        theme: theme.trim() || 'Historia',
        difficulty,
        used,
        approved,
      };
    };

    return blocks.map(parseBlock).filter(Boolean);
  };

  const runBulkImport = () => {
    const parsedQuestions = parseBulkQuestions(bulkImportText);
    if (!parsedQuestions.length) {
      setBulkImportFeedback('No pude leer preguntas validas en ese texto.');
      return;
    }
    setQuestions((current) => [...current, ...parsedQuestions]);
    setBulkImportFeedback(`Cargadas ${parsedQuestions.length} preguntas.`);
    setBulkImportText('');
  };

  const clearDuelTimer = () => {
    if (duelTimerRef.current) {
      window.clearInterval(duelTimerRef.current);
      duelTimerRef.current = null;
    }
  };

  const startDuelTimer = (mode, seconds, label) => {
    clearDuelTimer();
    setDuelTimer({ label, seconds, running: true, mode });
    duelTimerRef.current = window.setInterval(() => {
      setDuelTimer((current) => {
        if (current.seconds <= 1) {
          clearDuelTimer();
          return { label: `${label} finalizado`, seconds: 0, running: false, mode: 'idle' };
        }
        return { ...current, seconds: current.seconds - 1 };
      });
    }, 1000);
  };

  const startShowDuelDraw = () => {
    if (showSpinnerActive) return;
    if (showEligiblePlayers.length < 2) return;

    const drawPool = showEligiblePlayers.map((player) => ({ ...player }));
    const firstPick = drawPool[Math.floor(Math.random() * drawPool.length)];
    const remainingPlayers = drawPool.filter((player) => player.id !== firstPick.id);
    const secondPick = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];

    setShowFlowStep('draw');
    setShowSpinnerActive(true);
    showDrawNeedsSettleRef.current = false;
    setShowDrawPool(drawPool);
    setShowSpinnerSelection({
      leftId: firstPick.id,
      rightId: secondPick.id,
    });
    setShowDuelSelection({
      leftId: null,
      rightId: null,
    });
    setShowDuelNames({
      left: '',
      right: '',
    });
    patchShowState({ duelLaunched: false });
    setShowWheelResult(null);
    setShowWheelSpinning(false);
    setShowSpinnerOffsets({ left: 0, right: 0 });

    if (duelDrawTimeoutRef.current) window.clearTimeout(duelDrawTimeoutRef.current);
    if (showDrawSettleTimeoutRef.current) window.clearTimeout(showDrawSettleTimeoutRef.current);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const leftOffset = snapShowRollerToSelection(showLeftViewportRef.current, showLeftTrackRef.current, firstPick.id, drawPool);
        const rightOffset = snapShowRollerToSelection(showRightViewportRef.current, showRightTrackRef.current, secondPick.id, drawPool);
        setShowSpinnerOffsets({
          left: leftOffset ?? 0,
          right: rightOffset ?? 0,
        });
      });
    });
    duelDrawTimeoutRef.current = window.setTimeout(() => {
      setDuelSeats({
        playerA: firstPick.id,
        playerB: secondPick.id,
      });
      setShowDuelSelection({
        leftId: firstPick.id,
        rightId: secondPick.id,
      });
      setShowDuelNames({ left: firstPick.name, right: secondPick.name });
      setShowSpinnerActive(false);
      showDrawNeedsSettleRef.current = true;
    }, DUEL_DRAW_SPIN_MS);
  };

  const startShowMirrorDraw = () => {
    if (showFlowStep === 'intro' || showFlowStep === 'standby' || showFlowStep === 'draw') {
      startShowDuelDraw();
      return;
    }
    setShowFlowStep('standby');
  };

  const continueFromShowVersus = () => {
    patchShowState({ duelLaunched: false });
    setShowFlowStep('ready');
  };

  const advanceShowToThemeWheel = () => {
    if (showSpinnerActive || !showDuelSelection.leftId || !showDuelSelection.rightId) return;
    patchShowState({
      duelLaunched: false,
      flowStep: 'theme',
      wheelResult: null,
      wheelSpinning: false,
    });
  };

  const startBroadcastThemeSpin = () => {
    if (showWheelSpinning || !wheelThemes.length) return;
    const { targetIndex, nextRotation } = buildNextWheelSpin(showWheelRotation);
    const selectedTheme = wheelThemes[targetIndex]?.label ?? 'Historia';

    if (showWheelResolveTimeoutRef.current) {
      window.clearTimeout(showWheelResolveTimeoutRef.current);
      showWheelResolveTimeoutRef.current = null;
    }

    setShowWheelResult(null);
    setShowWheelSpinning(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setShowWheelRotation(nextRotation);
      });
    });

    showWheelResolveTimeoutRef.current = window.setTimeout(() => {
      setShowWheelSpinning(false);
      setShowWheelResult(selectedTheme);
      dispatchLiveAction({ type: 'SET_THEME', theme: selectedTheme });
      showWheelResolveTimeoutRef.current = null;
    }, WHEEL_SPIN_DURATION_MS + 80);
  };

  const startShowDuel = () => {
    if (showDuelSelection.leftId && showDuelSelection.rightId) {
      setDuelSeats({
        playerA: showDuelSelection.leftId,
        playerB: showDuelSelection.rightId,
      });
    }
    patchShowState({ duelLaunched: true });
    setBroadcastView('show');
    navigateToScreen('broadcast');
  };

  const dispatchLiveAction = (action) => {
    if (action.type === 'MARK_RESPONSE_CORRECT') {
      const scoringSide = action.side ?? liveState.responderSide ?? liveTurnSide;
      const targetPlayerId = scoringSide === 'playerB' ? duelSeats.playerB : duelSeats.playerA;
      if (targetPlayerId) {
        updatePlayerById(targetPlayerId, (player) => ({
          ...player,
          points: player.points + 1,
        }));
      }
    }

    if (action.type === 'MARK_STEAL_CORRECT') {
      const scoringSide = action.side ?? liveState.responderSide ?? liveStealSide;
      const targetPlayerId = scoringSide === 'playerA' ? duelSeats.playerA : duelSeats.playerB;
      if (targetPlayerId) {
        updatePlayerById(targetPlayerId, (player) => ({
          ...player,
          points: player.points + 1,
          stealsWon: player.stealsWon + 1,
        }));
      }
    }

    setLiveState((current) => liveReducer(current, action));

    const socket = liveSocketRef.current;
    if (socket?.connected) {
      socket.emit('action', action);
    }
  };

  const applyDuelResultAndRotate = () => {
    if (!liveState.duelFinished || !liveState.duelWinnerSide) return;

    const winnerSide = liveState.duelWinnerSide;
    const loserSide = winnerSide === 'playerA' ? 'playerB' : 'playerA';
    const winnerId = duelSeats[winnerSide];
    const loserId = duelSeats[loserSide];

    if (!winnerId || !loserId) {
      dispatchLiveAction({ type: 'NEXT_DUEL' });
      return;
    }

    const winnerPlayer = players.find((player) => player.id === winnerId);
    const loserPlayer = players.find((player) => player.id === loserId);

    if (!winnerPlayer || !loserPlayer) {
      dispatchLiveAction({ type: 'NEXT_DUEL' });
      return;
    }

    const winnerStreak = winnerPlayer.winStreak + 1;
    const winnerBecomesImbatible = winnerStreak >= 3 && !winnerPlayer.imbatible;

    const nextPlayers = players.map((player) => {
      if (player.id === winnerId) {
        return {
          ...player,
          points: player.points + 3 + (winnerBecomesImbatible ? IMBATIBLE_BONUS_POINTS : 0),
          roundsWon: player.roundsWon + 1,
          winStreak: winnerStreak,
          imbatible: player.imbatible || winnerBecomesImbatible,
          active: true,
        };
      }
      if (player.id === loserId) {
        return {
          ...player,
          winStreak: 0,
        };
      }
      return player;
    });

    const eligibleIds = nextPlayers.filter((player) => player.active && !player.imbatible).map((player) => player.id);
    const baseQueue = rotationQueue.filter((id) => eligibleIds.includes(id) && id !== winnerId && id !== loserId);
    const nextQueue = winnerBecomesImbatible ? [...baseQueue] : [winnerId, ...baseQueue];
    if (loserPlayer.active && !loserPlayer.imbatible) {
      nextQueue.push(loserId);
    }

    const normalizedQueue = nextQueue.filter(Boolean).filter((id, index, array) => array.indexOf(id) === index);

    setPlayers(nextPlayers);
    setRotationQueue(normalizedQueue);
    syncDuelSeats(normalizedQueue);
    returnShowToStandby();
    dispatchLiveAction({ type: 'NEXT_DUEL' });
    if (normalizedQueue[0] && normalizedQueue[1]) {
      dispatchLiveAction({
        type: 'SET_TEAM_NAMES',
        playerA: nextPlayers.find((player) => player.id === normalizedQueue[0])?.name ?? 'Jugador A',
        playerB: nextPlayers.find((player) => player.id === normalizedQueue[1])?.name ?? 'Jugador B',
      });
    }
  };

  const startWheelSpin = () => {
    if (wheelSpinning || !wheelThemes.length) return;
    const { targetIndex, nextRotation } = buildNextWheelSpin(wheelRotation);
    const selectedTheme = wheelThemes[targetIndex]?.label ?? 'Historia';
    setWheelResult(null);
    setPendingThemeIndex(targetIndex);
    setWheelSpinning(true);
    if (wheelSpinFrameRef.current) window.cancelAnimationFrame(wheelSpinFrameRef.current);
    if (wheelResolveTimeoutRef.current) window.clearTimeout(wheelResolveTimeoutRef.current);
    wheelSpinFrameRef.current = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setWheelRotation(nextRotation);
      });
    });
    wheelResolveTimeoutRef.current = window.setTimeout(() => {
      setWheelResult(selectedTheme);
      setWheelSpinning(false);
      setPendingThemeIndex(null);
      dispatchLiveAction({ type: 'SET_THEME', theme: selectedTheme });
      wheelResolveTimeoutRef.current = null;
    }, WHEEL_SPIN_DURATION_MS + 80);
  };

  const canCompetitorBuzz = (side) => {
    if (!liveState.questionVisible) return false;
    if (!liveState.timer.running) return false;
    if (liveState.revealAnswer || liveState.responseOutcome || liveState.responderSide || liveState.duelFinished) return false;
    if (liveState.stealAvailable) return side === liveTurnSide;
    return true;
  };

  const renderAccessGate = () => (
    <main className="app-shell access-shell">
      <div className="grid-overlay" />
      <div className="blob blob-one" />
      <div className="blob blob-two" />
      <div className="blob blob-three" />
      <section className="hero-frame auth-frame">
        <div className="auth-hero">
          <p className="sponsor-line">ACCESO PRIVADO</p>
          <h1 className="play-title">¿Qué sos?</h1>
          <p className="auth-lead">Elegí tu perfil para abrir la sala correcta. El host entra con contraseña y cada participante entra con su propio código.</p>
        </div>

        {entryStep === 'chooser' ? (
          <div className="auth-choice-grid">
            <button className="auth-choice-card" type="button" onClick={() => openRoleStep('host')}>
              <span className="show-badge">HOST</span>
              <strong>Control total</strong>
              <p>Accedé al tablero, los jugadores y las pantallas en vivo.</p>
            </button>
            <button className="auth-choice-card" type="button" onClick={() => openRoleStep('participant')}>
              <span className="show-badge is-playerB">PARTICIPANTE</span>
              <strong>Ingreso personal</strong>
              <p>Elegí tu jugador, validá tu código y entrá a tu lobby.</p>
            </button>
          </div>
        ) : null}

        {entryStep === 'host' ? (
          <div className="auth-form-shell">
            <button className="back-button auth-back-button" type="button" onClick={() => openRoleStep('chooser')}>← Volver</button>
            <div className="host-password-box">
              <strong>Acceso de host</strong>
              <p>Ingresá la contraseña para desbloquear la app completa.</p>
              <input
                className="players-input"
                type="password"
                value={entryHostPassword}
                onChange={(event) => setEntryHostPassword(event.target.value)}
                placeholder="Contraseña del host"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitEntryHostPassword();
                }}
              />
              {hostAuthError ? <p className="bulk-import-feedback">{hostAuthError}</p> : null}
            </div>
            <button className="modal-cta" type="button" onClick={submitEntryHostPassword}>Entrar como host</button>
          </div>
        ) : null}

        {entryStep === 'participant' ? (
          <div className="auth-form-shell">
            <button className="back-button auth-back-button" type="button" onClick={() => openRoleStep('chooser')}>← Volver</button>
            <div className="host-password-box">
              <strong>Acceso participante</strong>
              <p>Elegí tu jugador y escribí el código que te dieron para entrar a tu vida dentro del juego.</p>
              <label className="auth-field">
                <span>¿Quién sos?</span>
                <select
                  className="players-input"
                  value={entryParticipantPlayerId}
                  onChange={(event) => {
                    setEntryParticipantPlayerId(event.target.value);
                    setEntryParticipantError('');
                  }}
                >
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      #{String(player.playerNumber).padStart(2, '0')} {player.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-field">
                <span>Código</span>
                <textarea
                  className="players-input auth-code-input"
                  rows={3}
                  value={entryParticipantCode}
                  onChange={(event) => {
                    setEntryParticipantCode(event.target.value);
                    setEntryParticipantError('');
                  }}
                  placeholder="Pegá tu código acá"
                />
              </label>
              {entryParticipantError ? <p className="bulk-import-feedback">{entryParticipantError}</p> : null}
            </div>
            <button className="modal-cta" type="button" onClick={submitParticipantAccess}>Entrar como participante</button>
          </div>
        ) : null}

        <div className="auth-footer">
          <span>{players.length} participantes cargados</span>
          <span>Servidor {liveConnection}</span>
        </div>
      </section>
    </main>
  );

  const renderParticipantLobby = () => (
    <section className="hero-frame participant-frame">
      <div className="play-header">
        <button className="back-button" type="button" onClick={logoutAccess}>Salir</button>
        <div className="play-header-copy">
          <p className="sponsor-line">LOBBY PARTICIPANTE</p>
          <h1 className="play-title">Tu sala personal</h1>
        </div>
      </div>

      <div className="players-summary">
        <div className="summary-card" style={currentParticipant ? getPlayerThemeStyle(currentParticipant) : undefined}><span>Tu jugador</span><strong>{currentParticipant ? `#${String(currentParticipant.playerNumber).padStart(2, '0')}` : 'Sin validar'}</strong></div>
        <div className="summary-card"><span>Código</span><strong>{currentParticipant?.accessCode ?? '---'}</strong></div>
        <div className="summary-card"><span>Conexión</span><strong>{liveConnection}</strong></div>
      </div>

      <div className="participant-panel">
        <section className="broadcast-card participant-status-card player-theme-surface" style={currentParticipant ? getPlayerThemeStyle(currentParticipant) : undefined}>
          <h2>{currentParticipant?.name ?? 'Participante'}</h2>
          <p>Tu teléfono quedó asociado a este jugador. Cuando el host dispare eventos, esta vista puede usarse para seguir tu estado sin tocar el tablero general.</p>
          <div className="participant-code-box">
            <span>Tu código</span>
            <strong>{currentParticipant?.accessCode ?? '---'}</strong>
          </div>
          <div className="broadcast-note">
            <strong>Sala:</strong>
            <span> {liveState.message}</span>
          </div>
        </section>

        <aside className="broadcast-card participant-roster-card">
          <h2>Participantes</h2>
          <p>Lista completa de la sala, con tu jugador resaltado.</p>
          <div className="participant-roster">
            {players.map((player) => (
              <div className={`participant-roster-item player-theme-surface ${player.id === currentParticipant?.id ? 'is-self' : ''}`} key={player.id} style={getPlayerThemeStyle(player)}>
                <div>
                  <strong>#{String(player.playerNumber).padStart(2, '0')} {player.name}</strong>
                </div>
                <div className="participant-roster-meta">
                  <span className={`player-badge ${player.active ? '' : 'muted'}`}>{player.active ? 'En juego' : 'Descalificado'}</span>
                </div>
                <span className="player-badge muted participant-roster-points">Puntos {player.points}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );


  const renderMenu = () => (
    <section className="hero-frame"><div className="top-ribbon"><span className="ribbon-pill" /><span className="ribbon-pill ribbon-pill-mid" /><span className="ribbon-pill ribbon-pill-lime" /></div><p className="sponsor-line">AUSPICIADO POR SDJ</p><div className="title-card"><div className="title-card-back" /><h1 className="brand-title">L'IMBATIBLU</h1><p className="brand-subtitle">Gestor de trivia live</p><div className="status-row"><span className="status-dot" /><span>Sala preparada para arrancar</span></div></div><div className="cta-panel"><button className="primary-action" type="button" onClick={() => requestHostAccess('playOptions')}>HOSTEAR</button><button className="secondary-action" type="button" onClick={() => requestHostAccess('showMvp')}>COMENZAR SHOW</button></div><div className="corner-deco corner-star">✳</div><div className="corner-deco corner-note">★</div><div className="corner-deco corner-arrow">➜</div></section>
  );

  const renderPlayOptions = () => (
    <section className="hero-frame play-frame">
      <div className="play-header">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
        <div className="play-header-copy">
          <p className="sponsor-line">JUGAR HOST</p>
          <h1 className="play-title">Preparación en pasos</h1>
        </div>
        <button className="secondary-action host-settings-launch" type="button" onClick={() => setSettingsOpen(true)}>Configuracion del host</button>
      </div>
      <div className="play-flow-shell">
        <div className="play-flow-progress">
          {playFlowSteps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              className={`play-flow-dot ${index === playFlowStep ? 'is-active' : ''} ${index < playFlowStep ? 'is-done' : ''}`}
              onClick={() => setPlayFlowStep(index)}
            >
              <span>{step.kicker}</span>
              <strong>{step.title}</strong>
            </button>
          ))}
        </div>
        <div className="play-flow-layout">
          <section className="play-flow-card">
            <div className="play-flow-card-head">
              <span className="option-kicker">{playFlowSteps[playFlowStep].kicker}</span>
              <div className="play-flow-badges">
                <span className="player-badge highlight">Paso {playFlowStep + 1} de {playFlowSteps.length}</span>
                <span className="player-badge muted">Flujo continuo</span>
              </div>
            </div>
            <h2>{playFlowSteps[playFlowStep].title}</h2>
            <p>{playFlowSteps[playFlowStep].description}</p>
            <div className="play-flow-actions">
              <button className="primary-action" type="button" onClick={() => navigateToScreen(playFlowSteps[playFlowStep].id)}>{playFlowSteps[playFlowStep].buttonLabel}</button>
              <button className="secondary-action" type="button" onClick={() => setPlayFlowStep((current) => Math.max(0, current - 1))} disabled={playFlowStep === 0}>Paso anterior</button>
              <button className="secondary-action" type="button" onClick={() => setPlayFlowStep((current) => Math.min(playFlowSteps.length - 1, current + 1))} disabled={playFlowStep === playFlowSteps.length - 1}>Paso siguiente</button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );

  const renderShowMvp = () => (
    <section className="hero-frame show-mvp-frame">
      {showFlowStep === 'intro' ? (
        <section className={`broadcast-card show-intro-stage ${showIntroExiting ? 'is-exiting' : ''}`}>
          <div className="show-intro-orb show-intro-orb-left" />
          <div className="show-intro-orb show-intro-orb-right" />
          <div className="show-intro-spark show-intro-spark-top">✦</div>
          <div className="show-intro-spark show-intro-spark-bottom">⚡</div>
          <div className="show-badge">BIENVENIDA</div>
          <div className="show-intro-kicker">🎤 Trivia live • luces arriba • público listo</div>
          <h2>L&apos;Imbatiblú ya está al aire</h2>
          <p>Brillo encendido, sala cargada y tablero en ebullición. En segundos aparece la tabla general para anunciar el próximo cruce.</p>
          <div className="show-intro-hero">
            <div className="show-intro-card">
              <span>Jugadores</span>
              <strong>{players.length} en sala</strong>
            </div>
            <div className="show-intro-card">
              <span>Activos</span>
              <strong>{showEligiblePlayers.length} en carrera</strong>
            </div>
            <div className="show-intro-card">
              <span>Duelo</span>
              <strong>Se viene el #{liveState.currentDuel}</strong>
            </div>
          </div>
          <div className="broadcast-actions">
            <button className="primary-action" type="button" onClick={() => setShowFlowStep('standby')}>Ir al ranking</button>
          </div>
        </section>
      ) : null}

      {showFlowStep === 'standby' ? (
        <>
          <div className="show-standing-hero">
            <section className="broadcast-card show-standing-stage player-theme-surface" style={finalWinner ? getPlayerThemeStyle(finalWinner) : undefined}>
              <div className="show-standing-head">
                <h2>Tabla general</h2>
                <button className="primary-action" type="button" onClick={startShowDuelDraw} disabled={showEligiblePlayers.length < 2}>SORTEAR DUELO</button>
              </div>
              <p>Mientras se arma el próximo duelo, así queda la clasificación en vivo.</p>
              <div className="standby-summary">
                <div className="summary-card"><span>Jugadores</span><strong>{players.length}</strong></div>
                <div className="summary-card"><span>Activos</span><strong>{showEligiblePlayers.length}</strong></div>
                <div className="summary-card"><span>Duelo</span><strong>#{liveState.currentDuel}</strong></div>
              </div>
              <div className="show-standby-list">
                {finalRanking.map((player, index) => (
                  <article className={`show-standby-row player-theme-surface ${index === 0 ? 'is-top' : ''}`} key={player.id} style={getPlayerThemeStyle(player)}>
                    <div className="show-standby-rank">
                      <span>#{String(index + 1).padStart(2, '0')}</span>
                      <strong>{player.name}</strong>
                    </div>
                    <div className="show-standby-metrics">
                      <div><span>Rondas</span><strong>{player.roundsWon}</strong></div>
                      <div><span>Robos</span><strong>{player.stealsWon}</strong></div>
                      <div><span>Puntos</span><strong>{player.points}</strong></div>
                      <div><span>Jugador</span><strong>#{player.playerNumber}</strong></div>
                    </div>
                    <div className="show-standby-badges">
                      {player.imbatible ? <span className="player-badge highlight">Imbatible</span> : <span className="player-badge muted">Normal</span>}
                      <span className={`player-badge ${player.active ? '' : 'muted'}`}>{player.active ? 'En juego' : 'Descalificado'}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : null}

      {showFlowStep === 'draw' ? (
        <section className="broadcast-card show-draw-stage">
          <div className="show-draw-split">
            <div className={`show-draw-side show-draw-side-left ${showDrawRevealReady && showSelectedPlayerLeft ? 'player-theme-surface' : ''}`} style={showDrawRevealReady && showSelectedPlayerLeft ? getPlayerThemeStyle(showSelectedPlayerLeft) : undefined}>
              <h2>{showSpinnerActive ? 'Girando...' : showSelectedPlayerLeft?.name ?? 'Listo para salir'}</h2>
              <p>{showSpinnerActive ? 'Buscando la dupla...' : `Jugador #${String(showSelectedPlayerLeft?.playerNumber ?? '?').padStart(2, '0')}`}</p>
              <div className="show-roller-shell">
                <span className="show-roller-arrow" aria-hidden="true">➜</span>
                <div className={`show-roller-viewport ${showSpinnerActive ? 'is-spinning' : ''}`} ref={showLeftViewportRef}>
                  <div className="show-roller-focus" aria-hidden="true" />
                  <div className="show-roller-track" ref={showLeftTrackRef} style={{ transform: `translateY(${showSpinnerOffsets.left}px)` }}>
                    {showDrawTrack.map((player, index) => (
                      <div className={`show-roller-item ${showDrawRevealReady ? 'player-theme-surface' : ''} ${showSpinnerSelection?.leftId === player.id && !showSpinnerActive ? 'is-selected' : ''}`} key={`show-left-${player.id}-${index}`} style={showDrawRevealReady ? getPlayerThemeStyle(player) : undefined}>
                        <span>#{String(player.playerNumber).padStart(2, '0')}</span>
                        <strong>{player.name}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className={`show-draw-side show-draw-side-right ${showDrawRevealReady && showSelectedPlayerRight ? 'player-theme-surface' : ''}`} style={showDrawRevealReady && showSelectedPlayerRight ? getPlayerThemeStyle(showSelectedPlayerRight) : undefined}>
              <h2>{showSpinnerActive ? 'Girando...' : showSelectedPlayerRight?.name ?? 'Listo para salir'}</h2>
              <p>{showSpinnerActive ? 'Buscando la dupla...' : `Jugador #${String(showSelectedPlayerRight?.playerNumber ?? '?').padStart(2, '0')}`}</p>
              <div className="show-roller-shell">
                <span className="show-roller-arrow is-right" aria-hidden="true">➜</span>
                <div className={`show-roller-viewport ${showSpinnerActive ? 'is-spinning' : ''}`} ref={showRightViewportRef}>
                  <div className="show-roller-focus" aria-hidden="true" />
                  <div className="show-roller-track" ref={showRightTrackRef} style={{ transform: `translateY(${showSpinnerOffsets.right}px)` }}>
                    {showDrawTrack.map((player, index) => (
                      <div className={`show-roller-item ${showDrawRevealReady ? 'player-theme-surface' : ''} ${showSpinnerSelection?.rightId === player.id && !showSpinnerActive ? 'is-selected' : ''}`} key={`show-right-${player.id}-${index}`} style={showDrawRevealReady ? getPlayerThemeStyle(player) : undefined}>
                        <span>#{String(player.playerNumber).padStart(2, '0')}</span>
                        <strong>{player.name}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="show-draw-footer">
            <span className="machine-chip">SORTEO EN PANTALLA</span>
            <strong>{showSpinnerActive ? 'Buscando la dupla...' : `${showDuelNames.left} vs ${showDuelNames.right}`}</strong>
            <p>{showSpinnerActive ? 'Los dos tambores giran juntos hasta clavar una pareja distinta.' : 'La pareja quedó definida y espera la decisión del host para volver al ranking o pasar a la ruleta.'}</p>
          </div>
          <div className="broadcast-actions">
            <button className="primary-action" type="button" onClick={startShowDuelDraw} disabled={showSpinnerActive || showEligiblePlayers.length < 2}>
              {showSpinnerActive ? 'Girando...' : 'Comenzar sorteo'}
            </button>
            <button className="secondary-action" type="button" onClick={returnShowToStandby} disabled={showSpinnerActive}>Volver al ranking</button>
            <button className="secondary-action" type="button" onClick={advanceShowToThemeWheel} disabled={showSpinnerActive || !showDuelSelection.leftId || !showDuelSelection.rightId}>Avanzar hacia la ruleta</button>
          </div>
        </section>
      ) : null}

      {showFlowStep === 'theme' ? (
        <section className="broadcast-card show-theme-stage">
          <div className="show-badge">RULETA</div>
          <h2>Categoria del duelo</h2>
          <p>La ruleta en vivo define qué tema se usará para las preguntas de este cruce.</p>
          <div className="wheel-layout broadcast-wheel-layout">
            <div className={`wheel-stage ${showWheelSpinning ? 'is-spinning' : ''}`}>
              <div className="wheel-pointer" />
              <div className="wheel-shadow" />
              <div
                className={`wheel-disk ${showWheelSpinning ? 'is-spinning' : ''}`}
                style={{ transform: `rotate(${showWheelRotation}deg)` }}
              >
                <div className="wheel-core" style={{ background: wheelBackground }} />
                {wheelThemes.map((theme, index) => {
                  const angle = index * wheelStep + wheelStep / 2;
                  return (
                    <div
                      key={`show-theme-${theme.label}-${index}`}
                      className="wheel-label"
                      style={{ transform: `rotate(${angle}deg) translateY(-106px) rotate(${-angle}deg)` }}
                      aria-label={theme.label}
                    >
                      <span className="wheel-emoji" aria-hidden="true">{theme.emoji}</span>
                    </div>
                  );
                })}
                <button className="wheel-center" type="button" onClick={startBroadcastThemeSpin} disabled={showWheelSpinning}>GO</button>
              </div>
            </div>
            <div className="wheel-panel">
              <div className="wheel-result-card">
                <span className="wheel-result-label">Resultado</span>
                <strong>{showWheelSpinning ? 'Girando...' : showWheelResult ?? liveState.currentTheme ?? 'Aun no giraste'}</strong>
                <p>{showWheelSpinning ? 'La ruleta sigue girando. Esperá el cierre del disco.' : 'Tema activo para el duelo.'}</p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {showFlowStep === 'versus' ? (
        <section className="broadcast-card show-versus-stage">
          <div className="show-versus-hero">
            <div className="show-versus-card show-versus-left player-theme-surface" style={showSelectedPlayerLeft ? getPlayerThemeStyle(showSelectedPlayerLeft) : undefined}>
              <strong>{showDuelNames.left}</strong>
            </div>
            <div className="show-versus-vs">VS</div>
            <div className="show-versus-card show-versus-right player-theme-surface" style={showSelectedPlayerRight ? getPlayerThemeStyle(showSelectedPlayerRight) : undefined}>
              <strong>{showDuelNames.right}</strong>
            </div>
          </div>
          <h2>{showDuelNames.left} vs {showDuelNames.right}</h2>
          <p>Duelo #{liveState.currentDuel}. La sala ya tiene cruce confirmado.</p>
          <div className="broadcast-actions">
            <button className="primary-action" type="button" onClick={continueFromShowVersus}>Pasar a salida</button>
          </div>
        </section>
      ) : null}

      {showFlowStep === 'ready' ? (
        <section className="broadcast-card show-ready-stage">
          <div className="show-badge">SALIDA</div>
          <h2>En sus puestos</h2>
          <p>El duelo arranca en segundos.</p>
          <div className="show-ready-hero">
            <div className="show-ready-card player-theme-surface" style={showSelectedPlayerLeft ? getPlayerThemeStyle(showSelectedPlayerLeft) : undefined}>
              <strong>{showDuelNames.left} vs {showDuelNames.right}</strong>
            </div>
            <div className="show-ready-card player-theme-surface" style={showSelectedPlayerRight ? getPlayerThemeStyle(showSelectedPlayerRight) : undefined}>
              <strong>{showReadyCountdown > 0 ? `${showReadyCountdown}s` : 'Al aire'}</strong>
            </div>
            <div className="show-ready-card">
              <span>Estado</span>
              <strong>{liveConnection === 'connected' ? 'Sincronizado' : 'Conectando'}</strong>
            </div>
          </div>
          <div className="broadcast-actions">
            <button className="primary-action" type="button" onClick={startShowDuel}>Lanzar ahora</button>
            <button className="secondary-action" type="button" onClick={() => setShowFlowStep('standby')}>Volver al ranking</button>
          </div>
        </section>
      ) : null}
    </section>
  );

  const renderThemeWheel = () => (
    <section className="hero-frame wheel-frame">
      <div className="play-header">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
        <div className="play-header-copy">
          <p className="sponsor-line">RULETA DE TEMAS</p>
          <h1 className="play-title">Tema del duelo</h1>
        </div>
      </div>
      <div className="wheel-layout">
        <div className={`wheel-stage ${wheelSpinning ? 'is-spinning' : ''}`}>
          <div className="wheel-pointer" />
          <div className="wheel-shadow" />
          <div
            className={`wheel-disk ${wheelSpinning ? 'is-spinning' : ''}`}
            style={{ transform: `rotate(${wheelRotation}deg)` }}
          >
            <div className="wheel-core" style={{ background: wheelBackground }} />
            {wheelThemes.map((theme, index) => {
              const angle = index * wheelStep + wheelStep / 2;
              return (
                <div
                  key={`${theme.label}-${index}`}
                  className="wheel-label"
                  style={{ transform: `rotate(${angle}deg) translateY(-106px) rotate(${-angle}deg)` }}
                  aria-label={theme.label}
                >
                  <span className="wheel-emoji" aria-hidden="true">{theme.emoji}</span>
                </div>
              );
            })}
            <button className="wheel-center" type="button" onClick={startWheelSpin} disabled={wheelSpinning}>GO</button>
          </div>
        </div>
        <div className="wheel-panel">
          <div className="wheel-result-card">
            <span className="wheel-result-label">Resultado</span>
            <strong>{wheelSpinning ? 'Girando...' : wheelResult ?? 'Aun no giraste'}</strong>
            <p>{wheelSpinning ? 'La ruleta sigue girando. Esperá el cierre del disco.' : 'Resultado del giro.'}</p>
          </div>
          <div className="wheel-actions">
            <button className="primary-action" type="button" onClick={startWheelSpin} disabled={wheelSpinning}>{wheelSpinning ? 'Girando...' : 'Girar ruleta'}</button>
            <button className="secondary-action" type="button" onClick={() => setWheelResult(null)}>Limpiar resultado</button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setWheelRotation(0);
                setWheelResult(null);
                setWheelSpinning(false);
                setPendingThemeIndex(null);
              }}
            >
              Resetear ruleta
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setWheelEditDraft(wheelThemes.map((theme) => ({ ...theme })));
                setWheelEditOpen(true);
              }}
            >
              Editar temas
            </button>
          </div>
        </div>
      </div>
    </section>
  );
  const renderPlayers = () => (
    <section className="hero-frame players-frame">
      <div className="play-header">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
        <div className="play-header-copy">
          <p className="sponsor-line">JUGADORES</p>
          <h1 className="play-title">Rueda de entrada</h1>
        </div>
      </div>
      <div className="players-summary">
        <div className="summary-card"><span>Total</span><strong>{players.length}</strong></div>
        <div className="summary-card"><span>Activos</span><strong>{activePlayers}</strong></div>
        <div className="summary-card"><span>Imbatibles</span><strong>{imbatibles}</strong></div>
      </div>
      <div className="players-rule"><strong>Regla fija:</strong><span>Imbatible suma +{IMBATIBLE_BONUS_POINTS} puntos.</span></div>
      <div className="players-sortbar">
        <div className="sort-group">
          <span>Ordenar por</span>
          <div className="sort-pills">
            <button className={`sort-pill ${playerSortKey === 'playerNumber' ? 'is-active' : ''}`} type="button" onClick={() => setPlayerSortKey('playerNumber')}>Numero</button>
            <button className={`sort-pill ${playerSortKey === 'name' ? 'is-active' : ''}`} type="button" onClick={() => setPlayerSortKey('name')}>Nombre</button>
            <button className={`sort-pill ${playerSortKey === 'points' ? 'is-active' : ''}`} type="button" onClick={() => setPlayerSortKey('points')}>Puntos</button>
          </div>
        </div>
        <button className="sort-direction" type="button" onClick={() => setPlayerSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}>{playerSortDirection === 'asc' ? 'De menor a mayor' : 'De mayor a menor'}</button>
      </div>
      <div className="players-layout players-layout-single">
        <section className="players-panel">
          <div className="players-form">
            <input className="players-input" type="text" value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Agregar jugador" />
            <button className="primary-action" type="button" onClick={addPlayer}>Agregar</button>
          </div>
          <div className="players-table-head">
            <span>#</span>
            <span>Jugador</span>
            <span>Código</span>
            <span>Estado</span>
            <span>Puntos</span>
            <span>Acciones</span>
          </div>
          <div className="players-list">
            {sortedPlayers.map((player) => (
              <article
                className={`player-row player-theme-surface ${player.active ? '' : 'is-muted'} ${celebratingPlayerId === player.id ? 'is-celebrating' : ''}`}
                key={player.id}
                style={getPlayerThemeStyle(player)}
              >
                <div className="player-row-cell player-row-index">
                  <span className="player-index">#{String(player.playerNumber).padStart(2, '0')}</span>
                </div>
                <div className="player-row-cell player-row-name">
                  <strong>{player.name}</strong>
                  <div className="player-badges compact">
                    <span className="player-badge theme">{player.themeLabel ?? getPlayerThemeById(player.themeId, player.playerNumber).label}</span>
                    {player.winStreak > 0 ? <span className="player-badge">Racha {player.winStreak}</span> : null}
                    {player.imbatible ? <span className="player-badge highlight">Imbatible</span> : null}
                    <span className="player-badge muted player-code-pill">{player.accessCode ?? buildPlayerAccessCode(player)}</span>
                  </div>
                </div>
                <div className="player-row-cell player-row-code">
                  <code>{player.accessCode ?? buildPlayerAccessCode(player)}</code>
                </div>
                <div className="player-row-cell">
                  <span className={`player-badge ${player.active ? '' : 'muted'}`}>{player.active ? 'En juego' : 'Descalificado'}</span>
                </div>
                <div className="player-row-cell player-row-points">
                  <strong>{player.points}</strong>
                  {celebratingPlayerId === player.id ? <div className="player-bonus-pop">+{IMBATIBLE_BONUS_POINTS}</div> : null}
                </div>
                <div className="player-row-cell player-row-actions">
                  <button className="secondary-action compact" type="button" onClick={() => setPlayerActive(player.id, !player.active)}>{player.active ? 'Descalificar' : 'Rehabilitar'}</button>
                  <button className="secondary-action compact" type="button" onClick={() => toggleImbatible(player.id)}>{player.imbatible ? 'Quitar Imbatible' : 'Marcar Imbatible'}</button>
                  <button className="secondary-action danger compact" type="button" onClick={() => removePlayer(player.id)} aria-label={`Eliminar ${player.name}`}>✕</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );

  const renderQuestions = () => (
    <section className="hero-frame questions-frame">
      <div className="play-header">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
        <div className="play-header-copy">
          <p className="sponsor-line">PREGUNTAS</p>
          <h1 className="play-title">Biblioteca del duelo</h1>
        </div>
      </div>

      <div className="questions-summary">
        <div className="summary-card"><span>Total</span><strong>{questions.length}</strong></div>
        <div className="summary-card"><span>Aprobadas</span><strong>{questions.filter((question) => question.approved).length}</strong></div>
        <div className="summary-card"><span>Usadas</span><strong>{questions.filter((question) => question.used).length}</strong></div>
      </div>

      <div className="questions-layout">
        <section className="questions-panel">
          <div className="questions-form">
            <input className="players-input" type="text" value={questionPrompt} onChange={(event) => setQuestionPrompt(event.target.value)} placeholder="Escribi la pregunta" />
            <input className="players-input" type="text" value={questionAnswer} onChange={(event) => setQuestionAnswer(event.target.value)} placeholder="Respuesta correcta" />
            <select className="players-input" value={questionTheme} onChange={(event) => setQuestionTheme(event.target.value)}>
              {questionCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <select className="players-input" value={questionDifficulty} onChange={(event) => setQuestionDifficulty(event.target.value)}>
              <option value="Facil">Facil</option>
              <option value="Media">Media</option>
              <option value="Dificil">Dificil</option>
            </select>
            <button className="primary-action questions-add" type="button" onClick={addQuestion}>Agregar pregunta</button>
            <button className="secondary-action questions-bulk" type="button" onClick={() => setBulkImportOpen(true)}>Carga masiva</button>
          </div>

          <div className="questions-filters">
            <input className="players-input" type="text" value={questionFilterText} onChange={(event) => setQuestionFilterText(event.target.value)} placeholder="Buscar pregunta o respuesta" />
            <div className="questions-filter-row">
              <select className="players-input" value={questionFilterTheme} onChange={(event) => setQuestionFilterTheme(event.target.value)}>
                <option value="all">Todos los temas</option>
                {questionCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <select className="players-input" value={questionFilterStatus} onChange={(event) => setQuestionFilterStatus(event.target.value)}>
                <option value="all">Todos los estados</option>
                <option value="approved">Aprobadas</option>
                <option value="pending">Pendientes</option>
                <option value="used">Usadas</option>
                <option value="unused">Sin usar</option>
              </select>
            </div>
            <div className="players-sortbar">
              <div className="sort-group">
                <span>Ordenar por</span>
                <div className="sort-pills">
                  <button className={`sort-pill ${questionSortKey === 'theme' ? 'is-active' : ''}`} type="button" onClick={() => setQuestionSortKey('theme')}>Tema</button>
                  <button className={`sort-pill ${questionSortKey === 'difficulty' ? 'is-active' : ''}`} type="button" onClick={() => setQuestionSortKey('difficulty')}>Dificultad</button>
                  <button className={`sort-pill ${questionSortKey === 'used' ? 'is-active' : ''}`} type="button" onClick={() => setQuestionSortKey('used')}>Uso</button>
                  <button className={`sort-pill ${questionSortKey === 'status' ? 'is-active' : ''}`} type="button" onClick={() => setQuestionSortKey('status')}>Estado</button>
                </div>
              </div>
              <button className="sort-direction" type="button" onClick={() => setQuestionSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}>{questionSortDirection === 'asc' ? 'De menor a mayor' : 'De mayor a menor'}</button>
            </div>
          </div>

          <div className="questions-list">
            {filteredQuestions.map((question) => (
              <article className="question-card" key={question.id}>
                <div className="question-top">
                  <div>
                    <span className="player-index">{question.theme}</span>
                    <h2>{question.prompt}</h2>
                  </div>
                  <div className="question-tags">
                    <span className="player-badge">{question.difficulty}</span>
                    {question.approved ? <span className="player-badge highlight">Aprobada</span> : <span className="player-badge muted">Pendiente</span>}
                    {question.used ? <span className="player-badge muted">Usada</span> : null}
                  </div>
                </div>
                <div className="question-answer-box">
                  <span>Respuesta</span>
                  <strong>{question.answer}</strong>
                </div>
                <div className="player-controls">
                  <button className="secondary-action" type="button" onClick={() => openEditQuestion(question)}>Editar</button>
                  <button className="secondary-action" type="button" onClick={() => updateQuestion(question.id, (current) => ({ ...current, approved: !current.approved }))}>{question.approved ? 'Marcar pendiente' : 'Aprobar'}</button>
                  <button className="secondary-action" type="button" onClick={() => updateQuestion(question.id, (current) => ({ ...current, used: !current.used }))}>{question.used ? 'Marcar sin usar' : 'Marcar usada'}</button>
                  <button className="secondary-action danger" type="button" onClick={() => setQuestions((current) => current.filter((item) => item.id !== question.id))}>Eliminar</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );

  const renderBroadcastShowStage = (badgeLabel = 'SHOW EN VIVO') => (
    <section className="broadcast-card broadcast-show-stage">
        <div className="broadcast-card-head">
          <span className="machine-chip">{badgeLabel}</span>
          <span className="machine-chip secondary">{showFlowStep.toUpperCase()}</span>
        </div>

        {showFlowStep === 'intro' ? (
          <>
            <h2>L&apos;Imbatiblú ya está al aire</h2>
            <p>Esta vista espeja el show, pero en formato de control: legible, vertical y sin comprimir la pantalla.</p>
            <div className="broadcast-metrics">
              <div><span>Jugadores</span><strong>{players.length}</strong></div>
              <div><span>Activos</span><strong>{showEligiblePlayers.length}</strong></div>
              <div><span>Duelo</span><strong>#{liveState.currentDuel}</strong></div>
            </div>
          </>
        ) : null}

        {showFlowStep === 'standby' ? (
          <>
            <div className="show-standing-head">
              <h2>Tabla general</h2>
            </div>
            <div className="standby-summary">
              <div className="summary-card"><span>Jugadores</span><strong>{players.length}</strong></div>
              <div className="summary-card"><span>Activos</span><strong>{showEligiblePlayers.length}</strong></div>
              <div className="summary-card"><span>Duelo</span><strong>#{liveState.currentDuel}</strong></div>
            </div>
            <div className="broadcast-show-list">
              {finalRanking.map((player, index) => (
                <article className={`show-standby-row player-theme-surface ${index === 0 ? 'is-top' : ''}`} key={`broadcast-show-${player.id}`} style={getPlayerThemeStyle(player)}>
                  <div className="show-standby-rank">
                    <span>#{String(index + 1).padStart(2, '0')}</span>
                    <strong>{player.name}</strong>
                  </div>
                  <div className="show-standby-metrics">
                    <div><span>Rondas</span><strong>{player.roundsWon}</strong></div>
                    <div><span>Robos</span><strong>{player.stealsWon}</strong></div>
                    <div><span>Puntos</span><strong>{player.points}</strong></div>
                    <div><span>Jugador</span><strong>#{player.playerNumber}</strong></div>
                  </div>
                  <div className="show-standby-badges">
                    {player.imbatible ? <span className="player-badge highlight">Imbatible</span> : <span className="player-badge muted">Normal</span>}
                    <span className={`player-badge ${player.active ? '' : 'muted'}`}>{player.active ? 'En juego' : 'Descalificado'}</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {showFlowStep === 'draw' ? (
          <>
            <div className="broadcast-show-draw">
              <article className={`broadcast-show-draw-side ${showDrawRevealReady && showSelectedPlayerLeft ? 'player-theme-surface' : ''}`} style={showDrawRevealReady && showSelectedPlayerLeft ? getPlayerThemeStyle(showSelectedPlayerLeft) : undefined}>
                <span>Jugador A</span>
                <strong>{showSpinnerActive ? 'Girando...' : showSelectedPlayerLeft?.name ?? 'Esperando'}</strong>
                <p>{showSpinnerActive ? 'Buscando la dupla...' : formatPlayerNumber(showSelectedPlayerLeft?.playerNumber)}</p>
              </article>
              <article className={`broadcast-show-draw-side ${showDrawRevealReady && showSelectedPlayerRight ? 'player-theme-surface' : ''}`} style={showDrawRevealReady && showSelectedPlayerRight ? getPlayerThemeStyle(showSelectedPlayerRight) : undefined}>
                <span>Jugador B</span>
                <strong>{showSpinnerActive ? 'Girando...' : showSelectedPlayerRight?.name ?? 'Esperando'}</strong>
                <p>{showSpinnerActive ? 'Buscando la dupla...' : formatPlayerNumber(showSelectedPlayerRight?.playerNumber)}</p>
              </article>
            </div>
            <div className="broadcast-show-roller">
              <div className="show-roller-shell">
                <div className={`show-roller-viewport ${showSpinnerActive ? 'is-spinning' : ''}`} ref={showLeftViewportRef}>
                  <div className="show-roller-focus" aria-hidden="true" />
                  <div className="show-roller-track" ref={showLeftTrackRef} style={{ transform: `translateY(${showSpinnerOffsets.left}px)` }}>
                    {showDrawTrack.map((player, index) => (
                      <div className={`show-roller-item ${showDrawRevealReady ? 'player-theme-surface' : ''} ${showSpinnerSelection?.leftId === player.id && !showSpinnerActive ? 'is-selected' : ''}`} key={`broadcast-show-left-${player.id}-${index}`} style={showDrawRevealReady ? getPlayerThemeStyle(player) : undefined}>
                        <span>#{String(player.playerNumber).padStart(2, '0')}</span>
                        <strong>{player.name}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="show-roller-shell">
                <div className={`show-roller-viewport ${showSpinnerActive ? 'is-spinning' : ''}`} ref={showRightViewportRef}>
                  <div className="show-roller-focus" aria-hidden="true" />
                  <div className="show-roller-track" ref={showRightTrackRef} style={{ transform: `translateY(${showSpinnerOffsets.right}px)` }}>
                    {showDrawTrack.map((player, index) => (
                      <div className={`show-roller-item ${showDrawRevealReady ? 'player-theme-surface' : ''} ${showSpinnerSelection?.rightId === player.id && !showSpinnerActive ? 'is-selected' : ''}`} key={`broadcast-show-right-${player.id}-${index}`} style={showDrawRevealReady ? getPlayerThemeStyle(player) : undefined}>
                        <span>#{String(player.playerNumber).padStart(2, '0')}</span>
                        <strong>{player.name}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="broadcast-note">
              <strong>{showSpinnerActive ? 'Buscando la dupla...' : `${showDuelNames.left} vs ${showDuelNames.right}`}</strong>
            </div>
          </>
        ) : null}

        {showFlowStep === 'theme' ? (
          <>
            <h2>Ruleta del duelo</h2>
            <p>SHOW quedó en la ruleta y espera que el host fije el tema del cruce.</p>
            <div className="wheel-layout broadcast-wheel-layout">
              <div className={`wheel-stage ${showWheelSpinning ? 'is-spinning' : ''}`}>
                <div className="wheel-pointer" />
                <div className="wheel-shadow" />
                <div
                  className={`wheel-disk ${showWheelSpinning ? 'is-spinning' : ''}`}
                  style={{ transform: `rotate(${showWheelRotation}deg)` }}
                >
                  <div className="wheel-core" style={{ background: wheelBackground }} />
                  {wheelThemes.map((theme, index) => {
                    const angle = index * wheelStep + wheelStep / 2;
                    return (
                      <div
                        key={`broadcast-theme-${theme.label}-${index}`}
                        className="wheel-label"
                        style={{ transform: `rotate(${angle}deg) translateY(-106px) rotate(${-angle}deg)` }}
                        aria-label={theme.label}
                      >
                        <span className="wheel-emoji" aria-hidden="true">{theme.emoji}</span>
                      </div>
                    );
                  })}
                  <button className="wheel-center" type="button" onClick={startBroadcastThemeSpin} disabled={showWheelSpinning}>GO</button>
                </div>
              </div>
              <div className="wheel-panel">
                <div className="wheel-result-card">
                  <span className="wheel-result-label">Categoria</span>
                  <strong>{showWheelSpinning ? 'Girando...' : showWheelResult ?? liveState.currentTheme ?? 'Pendiente'}</strong>
                  <p>El tema que salga acá queda fijado para las preguntas del duelo.</p>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {showFlowStep === 'versus' ? (
          <>
            <div className="broadcast-show-versus">
              <div className={`show-versus-card show-versus-left player-theme-surface`} style={showSelectedPlayerLeft ? getPlayerThemeStyle(showSelectedPlayerLeft) : undefined}>
                <span>Jugador A</span>
                <strong>{showDuelNames.left}</strong>
              </div>
              <div className={`show-versus-card show-versus-right player-theme-surface`} style={showSelectedPlayerRight ? getPlayerThemeStyle(showSelectedPlayerRight) : undefined}>
                <span>Jugador B</span>
                <strong>{showDuelNames.right}</strong>
              </div>
            </div>
            <div className="broadcast-note">
              <strong>Duelo #{liveState.currentDuel}</strong>
              <span>La sala ya tiene cruce confirmado.</span>
            </div>
          </>
        ) : null}

        {showFlowStep === 'ready' ? (
          <>
            <div className="broadcast-show-ready">
              <div className={`show-ready-card player-theme-surface`} style={showSelectedPlayerLeft ? getPlayerThemeStyle(showSelectedPlayerLeft) : undefined}>
                <span>Duelo</span>
                <strong>{showDuelNames.left} vs {showDuelNames.right}</strong>
              </div>
              <div className={`show-ready-card player-theme-surface`} style={showSelectedPlayerRight ? getPlayerThemeStyle(showSelectedPlayerRight) : undefined}>
                <span>Cuenta regresiva</span>
                <strong>{showReadyCountdown > 0 ? `${showReadyCountdown}s` : 'Al aire'}</strong>
              </div>
            </div>
            <div className="broadcast-note">
              <strong>{liveConnection === 'connected' ? 'Sincronizado' : 'Conectando'}</strong>
              <span>El duelo arranca en segundos.</span>
            </div>
          </>
        ) : null}
      </section>
  );

  const renderBroadcastShowMirror = () => (
    <div className="broadcast-grid broadcast-show-grid">
      {renderBroadcastShowStage()}
    </div>
  );

  const renderBroadcastShowHostActions = () => (
    <section className="broadcast-card conductor-card">
      <div className="broadcast-card-head">
        <span className="machine-chip">HOST</span>
        <span className="machine-chip secondary">CONTROL DE SHOW</span>
      </div>
      <h2>Acciones del host</h2>
      <p>
        Esta vista sigue el mismo estado que ve SHOW y solo habilita las decisiones que corresponden en esta etapa.
      </p>
      <div className="broadcast-metrics">
        <div><span>Etapa</span><strong>{showFlowStep.toUpperCase()}</strong></div>
        <div><span>Activos</span><strong>{showEligiblePlayers.length}</strong></div>
        <div><span>Duelo</span><strong>#{liveState.currentDuel}</strong></div>
        <div><span>Seleccion</span><strong>{showDuelSelection.leftId && showDuelSelection.rightId ? 'Lista' : 'Pendiente'}</strong></div>
      </div>
      <div className="broadcast-actions">
        {showFlowStep === 'intro' ? (
          <button className="primary-action" type="button" onClick={() => setShowFlowStep('standby')}>Ir al ranking</button>
        ) : null}
        {showFlowStep === 'standby' ? (
          <button className="primary-action" type="button" onClick={startShowDuelDraw} disabled={showEligiblePlayers.length < 2}>Sortear duelo</button>
        ) : null}
        {showFlowStep === 'draw' ? (
          <>
            <button className="primary-action" type="button" onClick={advanceShowToThemeWheel} disabled={showSpinnerActive || !showDuelSelection.leftId || !showDuelSelection.rightId}>Avanzar hacia la ruleta</button>
            <button className="secondary-action" type="button" onClick={returnShowToStandby} disabled={showSpinnerActive}>Volver al ranking</button>
          </>
        ) : null}
        {showFlowStep === 'theme' ? (
          <>
            <button className="primary-action" type="button" onClick={startBroadcastThemeSpin} disabled={showWheelSpinning}>Girar ruleta</button>
            <button className="secondary-action" type="button" onClick={startShowDuel} disabled={!showWheelResult}>Comenzar duelo</button>
            <button className="secondary-action" type="button" onClick={returnShowToStandby}>Volver al ranking</button>
          </>
        ) : null}
        {showFlowStep === 'versus' ? (
          <>
            <button className="primary-action" type="button" onClick={startShowDuel} disabled={!showDuelSelection.leftId || !showDuelSelection.rightId}>Comenzar duelo</button>
            <button className="secondary-action" type="button" onClick={returnShowToStandby}>Volver al ranking</button>
            <button className="secondary-action" type="button" onClick={continueFromShowVersus}>Ir a salida</button>
          </>
        ) : null}
        {showFlowStep === 'ready' ? (
          <>
            <button className="primary-action" type="button" onClick={startShowDuel} disabled={!showDuelSelection.leftId || !showDuelSelection.rightId}>Comenzar duelo</button>
            <button className="secondary-action" type="button" onClick={returnShowToStandby}>Volver al ranking</button>
          </>
        ) : null}
      </div>
      <div className="broadcast-note">
        <strong>Estado:</strong>
        <span> {showFlowStep === 'standby' ? 'SHOW esperando un nuevo sorteo.' : showFlowStep === 'draw' ? 'SHOW está definiendo la dupla en vivo.' : showFlowStep === 'theme' ? 'La ruleta va a fijar la categoría del duelo.' : showFlowStep === 'versus' ? 'La dupla ya quedó definida.' : showFlowStep === 'ready' ? 'El show quedó listo para lanzar el duelo.' : 'La apertura sigue al aire.'}</span>
      </div>
    </section>
  );

  const renderBroadcast = () => (
    <section className="hero-frame broadcast-frame">
      <div className="match-header broadcast-header-minimal">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
      </div>
      <div className="broadcast-tabs" role="tablist" aria-label="Vistas en vivo">
        <button className={`broadcast-tab ${broadcastView === 'conductor' ? 'is-active' : ''}`} type="button" onClick={() => setBroadcastView('conductor')}>Host</button>
        <button className={`broadcast-tab ${broadcastView === 'show' ? 'is-active' : ''}`} type="button" onClick={() => setBroadcastView('show')}>Show</button>
      </div>
      <div className="broadcast-connection">
        <span className={`machine-chip ${liveConnection === 'connected' ? '' : 'secondary'}`}>Servidor {liveConnection}</span>
        <span className="machine-chip secondary">{liveState.connectedClients} clientes</span>
        <span className="machine-chip secondary">Duelo #{liveState.currentDuel}</span>
      </div>
      {broadcastView === 'conductor' ? (
        !showDuelLaunched ? (
          <div className="broadcast-grid host-grid">
            {renderBroadcastShowStage('ESPEJO SHOW')}
            {renderBroadcastShowHostActions()}
          </div>
        ) : (
        <div className="broadcast-grid host-grid">
          <section className={`broadcast-card show-stage show-stage-compact ${liveState.responderSide ? `is-${liveState.responderSide}` : ''}`}>
            <div className="show-stage-topline">
              <span className="show-badge">DUELO #{liveState.currentDuel}</span>
              <span className="machine-chip secondary">{liveState.currentTheme}</span>
              <span className="machine-chip secondary">{duelSeatThemeA.label}</span>
              <span className="machine-chip secondary">{duelSeatThemeB.label}</span>
            </div>
            {!liveState.questionVisible ? (
              <div className="show-question-card is-hidden">
                <span>ESPEJO EN VIVO</span>
                <strong>Pregunta oculta</strong>
                <p>El host la revela cuando todo está listo.</p>
              </div>
            ) : (
              <div className="show-question-card">
                <span>{liveState.currentTheme}</span>
                <strong>{liveState.question}</strong>
              </div>
            )}
              <div className="show-scoreboard">
                <div className="player-theme-surface" style={getPlayerThemeStyle(duelSeatPlayerA ?? { playerNumber: 1, themeId: duelSeatThemeA.id })}><span>{duelSeatPlayerA?.name ?? 'Jugador 01'}</span><strong>{liveState.scoreboard.playerA}</strong></div>
                <div className="player-theme-surface" style={getPlayerThemeStyle(duelSeatPlayerB ?? { playerNumber: 2, themeId: duelSeatThemeB.id })}><span>{duelSeatPlayerB?.name ?? 'Jugador 02'}</span><strong>{liveState.scoreboard.playerB}</strong></div>
              <div><span>Reloj</span><strong>{liveState.timer.running ? `${liveState.timer.seconds}s` : '—'}</strong></div>
            </div>
            {liveState.responderSide ? (
              <div className={`show-response-banner is-${liveState.responderSide}`}>
                <span>En respuesta</span>
                <strong>{liveResponderName} RESPONDE</strong>
              </div>
            ) : null}
            {liveState.responseOutcome ? (
              <div className={`show-outcome-card is-${liveState.responseOutcome.status}`}>
                <span>{liveState.responseOutcome.status === 'success' ? 'Respuesta correcta' : 'Respuesta incorrecta'}</span>
                <strong>{liveOutcomeName}</strong>
                <p>{liveState.responseOutcome.status === 'success' ? 'Punto confirmado por el host.' : 'El host marcó la jugada como fallida.'}</p>
              </div>
            ) : null}
            {liveState.duelFinished ? (
              <div className="question-answer-box">
                <span>Ganador del duelo</span>
                <strong>{liveDuelWinnerName ?? 'Pendiente'}</strong>
                <p>{liveState.message}</p>
              </div>
            ) : null}
            {liveState.revealAnswer ? (
              <div className="question-answer-box">
                <span>Respuesta</span>
                <strong>{liveState.answer}</strong>
              </div>
            ) : null}
          </section>
          <section className="broadcast-card conductor-card">
            <div className="broadcast-card-head">
              <span className="machine-chip">HOST</span>
              <span className="machine-chip secondary">{liveState.questionVisible ? 'Pregunta al aire' : 'Pregunta oculta'}</span>
            </div>
            <h2>Control del duelo</h2>
            <div className="live-editor">
              <input className="players-input" type="text" value={liveThemeDraft} onChange={(event) => setLiveThemeDraft(event.target.value)} placeholder="Tema" />
              <input className="players-input" type="text" value={liveQuestionDraft} onChange={(event) => setLiveQuestionDraft(event.target.value)} placeholder="Pregunta" />
              <input className="players-input" type="text" value={liveAnswerDraft} onChange={(event) => setLiveAnswerDraft(event.target.value)} placeholder="Respuesta" />
              <button className="primary-action" type="button" onClick={() => dispatchLiveAction({ type: 'SET_QUESTION', theme: liveThemeDraft.trim() || 'Historia', question: liveQuestionDraft.trim() || 'Pregunta sin cargar', answer: liveAnswerDraft.trim() || 'Respuesta pendiente', turnSide: liveTurnSide })}>Cargar pregunta oculta</button>
            </div>
            <div className="hidden-question">
              <span className="hidden-label">Respuesta privada</span>
              <strong>{liveState.answer}</strong>
              <p>{liveResponderName ? `${liveResponderName} tiene la palabra.` : 'Solo la ve el host hasta resolver la jugada.'}</p>
            </div>
            <div className="broadcast-metrics">
              <div><span>Tema</span><strong>{liveState.currentTheme}</strong></div>
              <div><span>Fase</span><strong>{liveCurrentPhase.title}</strong></div>
              <div><span>Reloj</span><strong>{String(liveState.timer.seconds).padStart(2, '0')}</strong></div>
              <div><span>Buzz</span><strong>{liveResponderName ?? 'Esperando'}</strong></div>
            </div>
            <div className="broadcast-card-head">
              <span className="machine-chip secondary">ACCIONES</span>
              <span className={`machine-chip secondary ${liveState.stealAvailable ? 'is-live-highlight' : ''}`}>{liveState.stealAvailable ? `ROBO ${liveStealName}` : 'ROBO CERRADO'}</span>
            </div>
            <div className="broadcast-actions">
              <button className="primary-action" type="button" onClick={() => dispatchLiveAction({ type: 'REVEAL_QUESTION' })} disabled={liveState.questionVisible}>Revelar pregunta</button>
              <button className="secondary-action" type="button" onClick={() => dispatchLiveAction({ type: 'OPEN_STEAL_WINDOW', side: liveStealSide })} disabled={!liveState.stealAvailable}>Abrir robo</button>
              <button className="secondary-action" type="button" onClick={() => dispatchLiveAction({ type: 'MARK_RESPONSE_CORRECT', side: liveState.responderSide ?? liveTurnSide })} disabled={!liveState.responderSide}>Respuesta correcta</button>
              <button className="secondary-action" type="button" onClick={() => dispatchLiveAction({ type: 'MARK_RESPONSE_WRONG', side: liveState.responderSide ?? liveTurnSide })} disabled={!liveState.responderSide}>Respuesta incorrecta</button>
              <button className="secondary-action" type="button" onClick={() => dispatchLiveAction({ type: 'MARK_STEAL_CORRECT', side: liveState.responderSide ?? liveStealSide })} disabled={!liveState.stealAvailable || !liveState.responderSide}>Robo correcto</button>
              <button className="secondary-action" type="button" onClick={() => dispatchLiveAction({ type: 'MARK_STEAL_WRONG', side: liveState.responderSide ?? liveStealSide })} disabled={!liveState.stealAvailable || !liveState.responderSide}>Robo incorrecto</button>
              <button className="secondary-action" type="button" onClick={() => dispatchLiveAction({ type: 'CLEAR_RESPONSE_OUTCOME' })} disabled={!liveState.responseOutcome}>Limpiar overlay</button>
              <button className="secondary-action" type="button" onClick={() => dispatchLiveAction({ type: 'TOGGLE_REVEAL' })}>Mostrar respuesta</button>
              <button className="secondary-action" type="button" onClick={() => dispatchLiveAction({ type: 'RESET_FLOW' })}>Reiniciar</button>
              <button className="secondary-action" type="button" onClick={applyDuelResultAndRotate} disabled={!liveState.duelFinished}>Siguiente duelo</button>
            </div>
            <div className="broadcast-note"><strong>Estado:</strong><span> {liveState.message}</span></div>
          </section>
        </div>
        )
      ) : broadcastView === 'show' ? (
        renderBroadcastShowMirror()
      ) : null}
    </section>
  );

  const renderCompetitors = () => (
    <section className="hero-frame competitors-frame">
      <div className="play-header">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
        <div className="play-header-copy">
          <p className="sponsor-line">COMPETIDORES</p>
          <h1 className="play-title">Panel de respuesta</h1>
        </div>
      </div>
      <div className="broadcast-connection">
        <span className={`machine-chip ${liveConnection === 'connected' ? '' : 'secondary'}`}>Servidor {liveConnection}</span>
        <span className="machine-chip secondary">Duelo #{liveState.currentDuel}</span>
      </div>
      <section className="broadcast-card competitors-stage">
        <div className="competitors-status">
          {!liveState.questionVisible ? (
            <>
              <span className="show-badge">ESPERA</span>
              <h2>Pregunta oculta</h2>
              <p>El host va a revelar la pregunta desde su panel. Cuando aparezca, tocá responder.</p>
            </>
          ) : liveState.responseOutcome ? (
            <>
              <span className={`show-badge ${liveState.responseOutcome.status === 'success' ? 'is-success' : 'is-error'}`}>{liveState.responseOutcome.status === 'success' ? 'ACIERTO' : 'ERROR'}</span>
              <h2>{liveOutcomeName}</h2>
              <p>{liveState.responseOutcome.status === 'success' ? 'Respuesta validada por el host.' : 'Esperando la apertura del robo o la siguiente jugada.'}</p>
            </>
          ) : liveState.responderSide ? (
            <>
              <span className={`show-badge is-${liveState.responderSide}`}>RESPONDE</span>
              <h2>{liveResponderName}</h2>
              <p>{liveResponderName} ya tomó la palabra. El resto espera resolución del host.</p>
            </>
          ) : (
            <>
              <span className="show-badge">AL AIRE</span>
              <h2>{liveState.stealAvailable ? `Robo para ${liveTurnName}` : '¡A responder!'}</h2>
              <p>{liveState.stealAvailable ? 'Solo el equipo habilitado puede tocar responder.' : 'El primer toque gana la palabra.'}</p>
            </>
          )}
        </div>
        <div className="competitor-actions-grid">
          {[
            { side: 'playerA', player: duelSeatPlayerA, fallbackTheme: duelSeatThemeA },
            { side: 'playerB', player: duelSeatPlayerB, fallbackTheme: duelSeatThemeB },
          ].map(({ side, player, fallbackTheme }) => (
            <button
              key={side}
              className="competitor-action-card player-theme-surface"
              type="button"
              onClick={() => dispatchLiveAction({ type: 'PLAYER_BUZZ_IN', side })}
              disabled={!canCompetitorBuzz(side)}
              style={getPlayerThemeStyle(player ?? { playerNumber: side === 'playerA' ? 1 : 2, themeId: fallbackTheme.id })}
            >
              <strong>{player?.name ?? (side === 'playerA' ? 'Jugador 01' : 'Jugador 02')}</strong>
              <em>{canCompetitorBuzz(side) ? 'RESPONDER' : liveState.responderSide === side ? 'TENÉS LA PALABRA' : 'ESPERA'}</em>
            </button>
          ))}
        </div>
      </section>
    </section>
  );

  const renderFinal = () => (
    <section className="hero-frame players-frame">
      <div className="play-header">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
        <div className="play-header-copy">
          <p className="sponsor-line">FINAL</p>
          <h1 className="play-title">Ranking por puntaje</h1>
        </div>
      </div>
      <div className="players-summary">
        <div className="summary-card"><span>Jugadores</span><strong>{players.length}</strong></div>
        <div className="summary-card"><span>Contendientes</span><strong>{finalContenders.length}</strong></div>
        <div className="summary-card" style={finalWinner ? getPlayerThemeStyle(finalWinner) : undefined}>
          <span>Lider</span>
          <strong>{finalWinner?.name ?? 'Pendiente'}</strong>
        </div>
      </div>
      <div className="players-rule"><strong>Desempate:</strong><span>Primero puntos, luego rondas ganadas, despues robos correctos, estado Imbatible y por ultimo numero de jugador.</span></div>
      <div className="players-layout">
        <section className="players-panel">
          <div className="players-list">
            {finalRanking.map((player, index) => (
              <article className={`player-card player-theme-surface ${index === 0 ? 'is-celebrating' : ''}`} key={player.id} style={getPlayerThemeStyle(player)}>
                <div className="player-card-top">
                  <div>
                    <span className="player-index">#{String(index + 1).padStart(2, '0')}</span>
                    <h2>{player.name}</h2>
                  </div>
                  <div className="player-badges">
                    <span className="player-badge theme">{player.themeLabel ?? getPlayerThemeById(player.themeId, player.playerNumber).label}</span>
                    {index === 0 ? <span className="player-badge highlight">Lider</span> : null}
                    {player.imbatible ? <span className="player-badge">Imbatible</span> : null}
                    <span className="player-badge muted">Racha {player.winStreak}</span>
                  </div>
                </div>
                <div className="player-points-box">
                  <span>Puntos totales</span>
                  <strong>{player.points}</strong>
                </div>
                <div className="show-side-list">
                  <div className="show-side-item"><span>Jugador</span><strong>#{player.playerNumber}</strong></div>
                  <div className="show-side-item"><span>Activo</span><strong>{player.active ? 'Si' : 'No'}</strong></div>
                  <div className="show-side-item"><span>Racha</span><strong>{player.winStreak}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </section>
        <aside className="players-side">
          <div className="players-note">
            <h2>Finalistas</h2>
            <p>{finalContenders.map((player) => player.name).join(' - ') || 'Sin clasificar todavia'}</p>
          </div>
          <div className="players-note">
            <h2>Empate en corte</h2>
            <p>{finalTiePlayers.length > 1 ? `${finalTiePlayers.length} jugadores quedaron empatados en ${finalCutoffPoints} puntos.` : 'No hay empate en el corte de ingreso.'}</p>
          </div>
          <div className="players-note">
            <h2>Ganador actual</h2>
            <p>{finalWinner ? `${finalWinner.name} lidera con ${finalWinner.points} puntos.` : 'Todavia no hay ranking.'}</p>
          </div>
        </aside>
      </div>
    </section>
  );

  const renderMatchFlow = () => (
    <section className="hero-frame match-frame"><div className="match-header"><button className="back-button" type="button" onClick={goBackScreen}>← Volver</button><div className="match-header-copy"><p className="sponsor-line">MOTOR DE PARTIDA</p><h1 className="play-title">Estados del juego</h1></div></div><div className="machine-panel"><div className="machine-status"><span className="machine-chip">{machine.activeState}</span><span className="machine-chip secondary">Duelo {machine.currentDuel}</span></div><div className="machine-current"><h2>{currentPhase.title}</h2><p>{currentPhase.description}</p></div><div className="phase-stepper">{gamePhases.map((phase, index) => <button key={phase.id} type="button" className={`phase-step ${index === machine.phaseIndex ? 'is-active' : ''}`} onClick={() => dispatch({ type: 'GOTO_PHASE', index })}><span>{String(index + 1).padStart(2, '0')}</span><strong>{phase.title}</strong></button>)}</div><div className="machine-actions"><button className="secondary-action" type="button" onClick={() => dispatch({ type: 'PREV_PHASE' })}>Estado anterior</button><button className="primary-action" type="button" onClick={() => dispatch({ type: 'NEXT_PHASE' })}>Siguiente estado</button><button className="secondary-action" type="button" onClick={() => dispatch({ type: 'RESET_FLOW' })}>Reiniciar</button></div><div className="duel-timer-panel"><div className="duel-timer-head"><span className="wheel-result-label">Reloj de duelo</span><strong>{duelTimer.label}</strong></div><div className={`duel-timer-display ${duelTimer.running ? 'is-running' : ''}`}>{String(duelTimer.seconds).padStart(2, '0')}</div><div className="duel-timer-actions"><button className="secondary-action" type="button" onClick={() => startDuelTimer('response', 5, 'Respuesta')}>Respuesta 5s</button><button className="secondary-action" type="button" onClick={() => startDuelTimer('steal', 3, 'Robo')}>Robo 3s</button><button className="secondary-action" type="button" onClick={() => { clearDuelTimer(); setDuelTimer({ label: 'Listo', seconds: 0, running: false, mode: 'idle' }); }}>Reset reloj</button></div></div></div></section>
  );

  if (!appRole) {
    return renderAccessGate();
  }

  if (appRole === 'participant') {
    return (
      <main className="app-shell">
        <div className="grid-overlay" />
        <div className="blob blob-one" />
        <div className="blob blob-two" />
        <div className="blob blob-three" />
        {renderParticipantLobby()}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="grid-overlay" />
      <div className="blob blob-one" />
      <div className="blob blob-two" />
      <div className="blob blob-three" />
      {screen === 'menu' && renderMenu()}
      {screen === 'playOptions' && renderPlayOptions()}
      {screen === 'showMvp' && renderShowMvp()}
      {screen === 'themeWheel' && renderThemeWheel()}
      {screen === 'players' && renderPlayers()}
      {screen === 'questions' && renderQuestions()}
      {screen === 'broadcast' && renderBroadcast()}
      {screen === 'competitors' && renderCompetitors()}
      {screen === 'final' && renderFinal()}
      {settingsOpen ? (<div className="modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="modal-kicker">CONFIGURACION</p><h2 id="settings-title">Preparar la trivia</h2></div><button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="Cerrar configuracion">×</button></div><div className="settings-list"><div className="setting-row"><span>Duracion de respuesta</span><strong>15 s</strong></div><div className="setting-row"><span>Sonidos del host</span><strong>Activados</strong></div><div className="setting-row"><span>Modo de puntuacion</span><strong>Clasico</strong></div></div><div className="host-password-box"><strong>Acceso al host</strong><p>Definí una clave local para bloquear Hostear, Comenzar Show y esta configuración.</p>{hostPassword ? <input className="players-input" type="password" value={hostPasswordCurrent} onChange={(event) => setHostPasswordCurrent(event.target.value)} placeholder="Contraseña actual" /> : null}<input className="players-input" type="password" value={hostPasswordDraft} onChange={(event) => setHostPasswordDraft(event.target.value)} placeholder="Nueva contraseña del host" /><input className="players-input" type="password" value={hostPasswordConfirm} onChange={(event) => setHostPasswordConfirm(event.target.value)} placeholder="Confirmar contraseña" />{hostSettingsMessage ? <p className="bulk-import-feedback">{hostSettingsMessage}</p> : null}</div><button className="modal-cta" type="button" onClick={saveSettings}>Guardar ajustes</button></div></div>) : null}
      {wheelEditOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setWheelEditOpen(false)}>
          <div className="modal-card bulk-import-modal wheel-edit-modal" role="dialog" aria-modal="true" aria-labelledby="wheel-edit-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="modal-kicker">RULETA</p>
                <h2 id="wheel-edit-title">Editar temas</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setWheelEditOpen(false)} aria-label="Cerrar editor de ruleta">×</button>
            </div>
            <div className="wheel-edit-list">
              {wheelEditDraft.map((theme, index) => (
                <div className="wheel-edit-row" key={`wheel-edit-${index}`}>
                  <div className="wheel-edit-preview" aria-hidden="true">{theme.emoji || '🎯'}</div>
                  <input
                    className="players-input"
                    type="text"
                    value={theme.emoji}
                    onChange={(event) => setWheelEditDraft((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, emoji: event.target.value } : item
                    )))}
                    placeholder="Emoji"
                  />
                  <input
                    className="players-input"
                    type="text"
                    value={theme.label}
                    onChange={(event) => setWheelEditDraft((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, label: event.target.value } : item
                    )))}
                    placeholder="Nombre del tema"
                  />
                </div>
              ))}
            </div>
            <button className="modal-cta" type="button" onClick={saveWheelThemes}>Guardar temas</button>
          </div>
        </div>
      ) : null}
      {hostAuthOpen ? (<div className="modal-backdrop" role="presentation" onClick={() => setHostAuthOpen(false)}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="host-auth-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="modal-kicker">HOST PROTEGIDO</p><h2 id="host-auth-title">Ingresar contraseña</h2></div><button className="icon-button" type="button" onClick={() => setHostAuthOpen(false)} aria-label="Cerrar acceso host">×</button></div><div className="host-password-box"><p>Ingresá la clave para abrir el panel de host o la proyección.</p><input className="players-input" type="password" value={hostAuthAttempt} onChange={(event) => setHostAuthAttempt(event.target.value)} placeholder="Contraseña del host" onKeyDown={(event) => { if (event.key === 'Enter') submitHostPassword(); }} />{hostAuthError ? <p className="bulk-import-feedback">{hostAuthError}</p> : null}</div><button className="modal-cta" type="button" onClick={submitHostPassword}>Entrar</button></div></div>) : null}
      {editQuestionOpen ? (<div className="modal-backdrop" role="presentation" onClick={() => setEditQuestionOpen(false)}><div className="modal-card bulk-import-modal" role="dialog" aria-modal="true" aria-labelledby="edit-question-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="modal-kicker">EDITAR PREGUNTA</p><h2 id="edit-question-title">Modificar contenido</h2></div><button className="icon-button" type="button" onClick={() => setEditQuestionOpen(false)} aria-label="Cerrar editor">×</button></div><div className="bulk-import-body"><input className="players-input" type="text" value={editQuestionDraft.prompt} onChange={(event) => setEditQuestionDraft((current) => ({ ...current, prompt: event.target.value }))} placeholder="Pregunta" /><input className="players-input" type="text" value={editQuestionDraft.answer} onChange={(event) => setEditQuestionDraft((current) => ({ ...current, answer: event.target.value }))} placeholder="Respuesta" /><div className="questions-filter-row"><select className="players-input" value={editQuestionDraft.theme} onChange={(event) => setEditQuestionDraft((current) => ({ ...current, theme: event.target.value }))}>{questionCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select><select className="players-input" value={editQuestionDraft.difficulty} onChange={(event) => setEditQuestionDraft((current) => ({ ...current, difficulty: event.target.value }))}><option value="Facil">Facil</option><option value="Media">Media</option><option value="Dificil">Dificil</option></select></div><div className="setting-row"><span>Usada</span><input type="checkbox" checked={editQuestionDraft.used} onChange={(event) => setEditQuestionDraft((current) => ({ ...current, used: event.target.checked }))} /></div><div className="setting-row"><span>Aprobada</span><input type="checkbox" checked={editQuestionDraft.approved} onChange={(event) => setEditQuestionDraft((current) => ({ ...current, approved: event.target.checked }))} /></div><div className="bulk-import-actions"><button className="primary-action" type="button" onClick={saveEditQuestion}>Guardar cambios</button><button className="secondary-action" type="button" onClick={() => setEditQuestionOpen(false)}>Cancelar</button></div></div></div></div>) : null}
      {bulkImportOpen ? (<div className="modal-backdrop" role="presentation" onClick={() => setBulkImportOpen(false)}><div className="modal-card bulk-import-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-import-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="modal-kicker">CARGA MASIVA</p><h2 id="bulk-import-title">Pegar preguntas en bloque</h2></div><button className="icon-button" type="button" onClick={() => setBulkImportOpen(false)} aria-label="Cerrar carga masiva">×</button></div><div className="bulk-import-body"><div className="bulk-import-spec"><strong>Formato esperado</strong><code>TEMA: Historia
 DIFICULTAD: Facil
 PREGUNTA: ¿En que ano se inauguro el Obelisco?
 RESPUESTA: 1936
 APROBADA: si
 USADA: no
 
 ---
 </code></div><textarea className="bulk-import-textarea" value={bulkImportText} onChange={(event) => setBulkImportText(event.target.value)} placeholder={`TEMA: Historia
 DIFICULTAD: Facil
 PREGUNTA: ¿En que ano se inauguro el Obelisco?
 RESPUESTA: 1936
 APROBADA: si
 USADA: no
 
 ---
 TEMA: Deportes
 DIFICULTAD: Media
 PREGUNTA: ¿Cuantos jugadores hay por equipo en cancha?
 RESPUESTA: 11`} /><div className="bulk-import-actions"><button className="primary-action" type="button" onClick={runBulkImport}>Importar preguntas</button><button className="secondary-action" type="button" onClick={() => { setBulkImportText(''); setBulkImportFeedback(''); }}>Limpiar</button></div>{bulkImportFeedback ? <p className="bulk-import-feedback">{bulkImportFeedback}</p> : null}</div></div></div>) : null}
    </main>
  );
}

export default App;
