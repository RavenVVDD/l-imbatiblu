import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { LIVE_PHASES, initialLiveState, liveReducer } from './liveState';

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
const APP_STORAGE_KEY = 'l-imbatiblu:persistent-state:v1';
const HOST_SCREENS = new Set(['playOptions', 'themeWheel', 'players', 'questions', 'broadcast', 'final', 'duelDraw', 'duelIntro', 'duelFinalize', 'showMvp']);
const SHOW_FLOW_STEPS = ['intro', 'standby', 'draw', 'rollers', 'versus', 'ready'];

const initialPlayers = [
  { id: 'p1', playerNumber: 1, name: 'Agus', points: 0, roundsWon: 0, stealsWon: 0, winStreak: 0, active: true, imbatible: false },
  { id: 'p2', playerNumber: 2, name: 'Lola', points: 0, roundsWon: 0, stealsWon: 0, winStreak: 0, active: true, imbatible: false },
  { id: 'p3', playerNumber: 3, name: 'Nico', points: 0, roundsWon: 0, stealsWon: 0, winStreak: 0, active: true, imbatible: false },
];

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
    id: 'duelDraw',
    kicker: '03',
    title: 'Sorteo de duelo',
    description: 'Hacé girar los dos rollers y dejá armada la pareja que va a jugar.',
    buttonLabel: 'Abrir sorteo',
  },
  {
    id: 'duelIntro',
    kicker: '04',
    title: 'Comienza el duelo',
    description: 'Mostrá la presentación previa antes de pasar al host y al show.',
    buttonLabel: 'Abrir intro',
  },
  {
    id: 'broadcast',
    kicker: '05',
    title: 'Pantallas en vivo',
    description: 'Separá conductor, show y standby con la misma verdad de la partida.',
    buttonLabel: 'Abrir pantallas',
  },
  {
    id: 'duelFinalize',
    kicker: '06',
    title: 'Finalización',
    description: 'Cerrá el duelo y devolvé la vista a standby para el próximo cruce.',
    buttonLabel: 'Cerrar duelo',
  },
  {
    id: 'final',
    kicker: '07',
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

function buildInitialPlayers() {
  const persisted = readPersistedAppState();
  if (Array.isArray(persisted?.players) && persisted.players.length) {
    return persisted.players;
  }
  return initialPlayers;
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
  const [screen, setScreen] = useState('menu');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hostAuthOpen, setHostAuthOpen] = useState(false);
  const [hostAccessTarget, setHostAccessTarget] = useState('playOptions');
  const [hostAuthAttempt, setHostAuthAttempt] = useState('');
  const [hostAuthError, setHostAuthError] = useState('');
  const [hostPassword, setHostPassword] = useState(() => readPersistedAppState()?.hostPassword ?? '');
  const [hostUnlocked, setHostUnlocked] = useState(() => !readPersistedAppState()?.hostPassword);
  const [hostPasswordCurrent, setHostPasswordCurrent] = useState('');
  const [hostPasswordDraft, setHostPasswordDraft] = useState(() => readPersistedAppState()?.hostPassword ?? '');
  const [hostPasswordConfirm, setHostPasswordConfirm] = useState(() => readPersistedAppState()?.hostPassword ?? '');
  const [hostSettingsMessage, setHostSettingsMessage] = useState('');
  const [broadcastView, setBroadcastView] = useState('standby');
  const [playFlowStep, setPlayFlowStep] = useState(0);
  const [showFlowStep, setShowFlowStep] = useState('intro');
  const [showSpinnerActive, setShowSpinnerActive] = useState(false);
  const [showSpinnerSelection, setShowSpinnerSelection] = useState(null);
  const [showSpinnerOffsets, setShowSpinnerOffsets] = useState({ left: 0, right: 0 });
  const [showDuelNames, setShowDuelNames] = useState({ left: 'Jugador X', right: 'Jugador Y' });
  const [showDuelSelection, setShowDuelSelection] = useState({ leftId: null, rightId: null });
  const [showReadyCountdown, setShowReadyCountdown] = useState(3);
  const [showIntroExiting, setShowIntroExiting] = useState(false);
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

  const [duelTimer, setDuelTimer] = useState({ label: 'Listo', seconds: 0, running: false, mode: 'idle' });
  const duelTimerRef = useRef(null);

  const [liveState, setLiveState] = useState(initialLiveState);
  const [liveConnection, setLiveConnection] = useState('offline');
  const [liveQuestionDraft, setLiveQuestionDraft] = useState('¿En que ano se inauguro el Obelisco?');
  const [liveAnswerDraft, setLiveAnswerDraft] = useState('1936');
  const [liveThemeDraft, setLiveThemeDraft] = useState('Historia');
  const liveSocketRef = useRef(null);
  const hasLoadedInitialRotationRef = useRef(false);

  const currentPhase = gamePhases[machine.phaseIndex];
  const liveCurrentPhase = LIVE_PHASES[liveState.phaseIndex];
  const wheelStep = 360 / wheelThemes.length;
  const wheelBackground = useMemo(() => buildWheelGradient(wheelThemes), [wheelThemes]);
  const liveTurnSide = liveState.turnSide ?? 'playerA';
  const liveStealSide = liveTurnSide === 'playerA' ? 'playerB' : 'playerA';
  const liveTurnName = liveState.teamNames[liveTurnSide];
  const liveStealName = liveState.teamNames[liveStealSide];
  const liveDuelWinnerName = liveState.duelWinnerSide ? liveState.teamNames[liveState.duelWinnerSide] : null;
  const liveResponderName = liveState.responderSide ? liveState.teamNames[liveState.responderSide] : null;
  const liveOutcomeName = liveState.responseOutcome?.side ? liveState.teamNames[liveState.responseOutcome.side] : null;

  const duelSeatPlayerA = players.find((player) => player.id === duelSeats.playerA) ?? null;
  const duelSeatPlayerB = players.find((player) => player.id === duelSeats.playerB) ?? null;
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
  const showDrawTrack = useMemo(() => {
    if (!showEligiblePlayers.length) return [];
    return Array.from({ length: 5 }, () => showEligiblePlayers).flat();
  }, [showEligiblePlayers]);
  const showSelectedPlayerLeft = showDuelSelection.leftId ? players.find((player) => player.id === showDuelSelection.leftId) ?? null : null;
  const showSelectedPlayerRight = showDuelSelection.rightId ? players.find((player) => player.id === showDuelSelection.rightId) ?? null : null;

  const navigateToScreen = (nextScreen) => {
    if (nextScreen === screen) return;
    window.history.pushState({ screen: nextScreen }, '', `#${nextScreen}`);
    setScreen(nextScreen);
  };

  const goBackScreen = () => {
    window.history.back();
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
        setShowFlowStep('intro');
        setShowSpinnerActive(false);
        setShowSpinnerSelection(null);
        setShowDuelSelection({ leftId: null, rightId: null });
        setShowReadyCountdown(3);
        setShowIntroExiting(false);
        setShowDuelNames({ left: 'Jugador X', right: 'Jugador Y' });
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
        setShowFlowStep('intro');
        setShowSpinnerActive(false);
        setShowSpinnerSelection(null);
        setShowDuelSelection({ leftId: null, rightId: null });
        setShowReadyCountdown(3);
        setShowIntroExiting(false);
        setShowDuelNames({ left: 'Jugador X', right: 'Jugador Y' });
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
        setShowFlowStep('intro');
        setShowSpinnerActive(false);
        setShowSpinnerSelection(null);
        setShowDuelSelection({ leftId: null, rightId: null });
        setShowReadyCountdown(3);
        setShowIntroExiting(false);
        setShowDuelNames({ left: 'Jugador X', right: 'Jugador Y' });
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
    const initialScreen = ['menu', 'playOptions', 'themeWheel', 'players', 'questions', 'broadcast', 'final', 'duelDraw', 'duelIntro', 'duelFinalize', 'showMvp', 'competitors'].includes(initialHash)
      ? initialHash
      : 'menu';
    if (initialScreen !== screen) {
      setScreen(initialScreen);
    }
    window.history.replaceState({ screen: initialScreen }, '', `#${initialScreen}`);

    const handlePopState = (event) => {
      const nextScreen = event.state?.screen ?? (window.location.hash.replace('#', '') || 'menu');
      if (['menu', 'playOptions', 'themeWheel', 'players', 'questions', 'broadcast', 'final', 'duelDraw', 'duelIntro', 'duelFinalize', 'showMvp', 'competitors'].includes(nextScreen)) {
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
    });
  }, [players, questions, nextPlayerNumber, playerSortKey, playerSortDirection, rotationQueue, duelSeats, hostPassword, wheelThemes]);

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
    socket.on('state', (state) => setLiveState(state));

    return () => {
      socket.disconnect();
      liveSocketRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    if (wheelSpinFrameRef.current) window.cancelAnimationFrame(wheelSpinFrameRef.current);
    if (duelTimerRef.current) window.clearInterval(duelTimerRef.current);
    if (duelDrawTimeoutRef.current) window.clearTimeout(duelDrawTimeoutRef.current);
    if (showFlowTimeoutRef.current) window.clearTimeout(showFlowTimeoutRef.current);
    if (showReadyIntervalRef.current) window.clearInterval(showReadyIntervalRef.current);
    if (showDrawSettleTimeoutRef.current) window.clearTimeout(showDrawSettleTimeoutRef.current);
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
      setShowReadyCountdown(3);
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
      const leftAdjustment = snapShowRollerToSelection(showLeftViewportRef.current, showLeftTrackRef.current, showDuelSelection.leftId);
      const rightAdjustment = snapShowRollerToSelection(showRightViewportRef.current, showRightTrackRef.current, showDuelSelection.rightId);

      setShowSpinnerOffsets((current) => ({
        left: current.left + (leftAdjustment ?? 0),
        right: current.right + (rightAdjustment ?? 0),
      }));

      showDrawSettleTimeoutRef.current = window.setTimeout(() => {
        setShowFlowStep('versus');
      }, 120);
    });

    return () => {
      if (showDrawSettleTimeoutRef.current) {
        window.clearTimeout(showDrawSettleTimeoutRef.current);
        showDrawSettleTimeoutRef.current = null;
      }
    };
  }, [screen, showFlowStep, showSpinnerActive, showDuelSelection.leftId, showDuelSelection.rightId]);

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
    setPlayers((current) => [...current, { id: newPlayerId, playerNumber: nextPlayerNumber, name: trimmed, points: 0, roundsWon: 0, stealsWon: 0, winStreak: 0, active: true, imbatible: false }]);
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

  const buildShowDrawOffset = (playerId, poolSize) => {
    const index = showEligiblePlayers.findIndex((player) => player.id === playerId);
    if (index === -1) return 0;
    const centerOffset = DUEL_DRAW_VIEWPORT_HEIGHT / 2 - DUEL_DRAW_ITEM_HEIGHT / 2;
    const targetSlot = poolSize * 2 + index;
    return centerOffset - targetSlot * DUEL_DRAW_ITEM_HEIGHT;
  };

  const snapShowRollerToSelection = (viewportElement, trackElement, playerId) => {
    if (!viewportElement || !trackElement) return null;
    const selectedIndex = showEligiblePlayers.findIndex((player) => player.id === playerId);
    if (selectedIndex === -1) return null;

    const targetSlot = showEligiblePlayers.length * 2 + selectedIndex;
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
      const fields = {};
      let currentKey = null;

      block.split('\n').forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) return;

        const match = line.match(/^(tema|theme|pregunta|question|respuesta|answer|dificultad|difficulty|aprobada|approved|usada|used)\s*:\s*(.*)$/i);
        if (match) {
          currentKey = match[1].toLowerCase();
          fields[currentKey] = match[2].trim();
          return;
        }

        if (currentKey) {
          fields[currentKey] = `${fields[currentKey]}\n${line}`.trim();
        }
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

  const startDuelDraw = () => {
    if (duelDrawState.spinning) return;
    if (duelDrawEligiblePlayers.length < 2) {
      setDuelDrawState((current) => ({
        ...current,
        status: 'Necesitas al menos 2 jugadores aptos para el sorteo',
        selection: null,
      }));
      return;
    }

    const firstPick = duelDrawEligiblePlayers[Math.floor(Math.random() * duelDrawEligiblePlayers.length)];
    const remainingPlayers = duelDrawEligiblePlayers.filter((player) => player.id !== firstPick.id);
    const secondPick = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];

    const leftOffset = buildDuelDrawOffset(firstPick.id, duelDrawEligiblePlayers.length);
    const rightOffset = buildDuelDrawOffset(secondPick.id, duelDrawEligiblePlayers.length);

    setDuelDrawState({
      spinning: true,
      status: 'GIRANDO...',
      selection: {
        playerAId: firstPick.id,
        playerBId: secondPick.id,
      },
      leftOffset,
      rightOffset,
    });

    if (duelDrawTimeoutRef.current) window.clearTimeout(duelDrawTimeoutRef.current);
    duelDrawTimeoutRef.current = window.setTimeout(() => {
      setDuelSeats({
        playerA: firstPick.id,
        playerB: secondPick.id,
      });
      setDuelDrawState({
        spinning: false,
        status: `${firstPick.name} vs ${secondPick.name}`,
        selection: {
          playerAId: firstPick.id,
          playerBId: secondPick.id,
        },
        leftOffset,
        rightOffset,
      });
    }, DUEL_DRAW_SPIN_MS);
  };

  const startShowDuelDraw = () => {
    if (showSpinnerActive) return;
    if (showEligiblePlayers.length < 2) return;

    const firstPick = showEligiblePlayers[Math.floor(Math.random() * showEligiblePlayers.length)];
    const remainingPlayers = showEligiblePlayers.filter((player) => player.id !== firstPick.id);
    const secondPick = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];

    const leftOffset = buildShowDrawOffset(firstPick.id, showEligiblePlayers.length);
    const rightOffset = buildShowDrawOffset(secondPick.id, showEligiblePlayers.length);

    setShowFlowStep('draw');
    setShowSpinnerActive(true);
    showDrawNeedsSettleRef.current = false;
    setShowSpinnerSelection({
      leftId: firstPick.id,
      rightId: secondPick.id,
    });
    setShowDuelSelection({
      leftId: firstPick.id,
      rightId: secondPick.id,
    });
    setShowSpinnerOffsets({ left: 0, right: 0 });

    if (duelDrawTimeoutRef.current) window.clearTimeout(duelDrawTimeoutRef.current);
    if (showDrawSettleTimeoutRef.current) window.clearTimeout(showDrawSettleTimeoutRef.current);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setShowSpinnerOffsets({ left: leftOffset, right: rightOffset });
      });
    });
    duelDrawTimeoutRef.current = window.setTimeout(() => {
      setDuelSeats({
        playerA: firstPick.id,
        playerB: secondPick.id,
      });
      setShowDuelNames({ left: firstPick.name, right: secondPick.name });
      setShowSpinnerActive(false);
      showDrawNeedsSettleRef.current = true;
    }, DUEL_DRAW_SPIN_MS);
  };

  const continueFromShowVersus = () => {
    setShowFlowStep('ready');
  };

  const startShowDuel = () => {
    if (showDuelSelection.leftId && showDuelSelection.rightId) {
      setDuelSeats({
        playerA: showDuelSelection.leftId,
        playerB: showDuelSelection.rightId,
      });
    }
    setBroadcastView('show');
    navigateToScreen('broadcast');
  };

  const applyDuelDrawSelection = () => {
    if (!duelDrawState.selection) return;
    setDuelSeats({
      playerA: duelDrawState.selection.playerAId,
      playerB: duelDrawState.selection.playerBId,
    });
    navigateToScreen('duelIntro');
  };

  const continueFromDuelIntro = () => {
    setBroadcastView('conductor');
    navigateToScreen('broadcast');
  };

  const openDuelFinalization = () => {
    navigateToScreen('duelFinalize');
  };

  const returnToStandby = () => {
    setBroadcastView('standby');
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

    const socket = liveSocketRef.current;
    if (socket?.connected) {
      socket.emit('action', action);
      return;
    }
    setLiveState((current) => liveReducer(current, action));
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
    if (wheelSpinning) return;
    const targetIndex = Math.floor(Math.random() * wheelThemes.length);
    const currentNormalized = ((wheelRotation % 360) + 360) % 360;
    const targetNormalized = 360 - targetIndex * wheelStep - wheelStep / 2;
    const extraTurns = 5 + Math.floor(Math.random() * 3);
    const nextRotation = wheelRotation + (targetNormalized - currentNormalized + extraTurns * 360);
    setWheelResult(null);
    setPendingThemeIndex(targetIndex);
    setWheelSpinning(true);
    if (wheelSpinFrameRef.current) window.cancelAnimationFrame(wheelSpinFrameRef.current);
    wheelSpinFrameRef.current = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setWheelRotation(nextRotation);
      });
    });
  };

  const handleWheelTransitionEnd = (event) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform' || pendingThemeIndex === null) return;
    setWheelResult(wheelThemes[pendingThemeIndex].label);
    setWheelSpinning(false);
    setPendingThemeIndex(null);
  };

  const canCompetitorBuzz = (side) => {
    if (!liveState.questionVisible) return false;
    if (!liveState.timer.running) return false;
    if (liveState.revealAnswer || liveState.responseOutcome || liveState.responderSide || liveState.duelFinished) return false;
    if (liveState.stealAvailable) return side === liveTurnSide;
    return true;
  };


  const renderMenu = () => (
    <section className="hero-frame"><div className="top-ribbon"><span className="ribbon-pill" /><span className="ribbon-pill ribbon-pill-mid" /><span className="ribbon-pill ribbon-pill-lime" /></div><p className="sponsor-line">AUSPICIADO POR SDJ</p><div className="title-card"><div className="title-card-back" /><h1 className="brand-title">L'IMBATIBLU</h1><p className="brand-subtitle">Gestor de trivia live</p><div className="status-row"><span className="status-dot" /><span>Sala preparada para arrancar</span></div></div><div className="cta-panel"><button className="primary-action" type="button" onClick={() => requestHostAccess('playOptions')}>HOSTEAR</button><button className="secondary-action" type="button" onClick={() => requestHostAccess('showMvp')}>COMENZAR SHOW</button><button className="secondary-action" type="button" onClick={() => navigateToScreen('competitors')}>COMPETIDORES</button></div><div className="corner-deco corner-star">✳</div><div className="corner-deco corner-note">★</div><div className="corner-deco corner-arrow">➜</div></section>
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
      <div className="play-header">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
        <div className="play-header-copy">
          <p className="sponsor-line">COMENZAR SHOW</p>
          <h1 className="play-title">Pantalla del publico</h1>
        </div>
      </div>
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
            <section className="broadcast-card show-standing-stage">
              <div className="show-standing-head">
                <button className="primary-action" type="button" onClick={startShowDuelDraw} disabled={showEligiblePlayers.length < 2}>SORTEAR DUELO</button>
              </div>
              <h2>Tabla general</h2>
              <p>Mientras se arma el próximo duelo, así queda la clasificación en vivo.</p>
              <div className="standby-summary">
                <div className="summary-card"><span>Jugadores</span><strong>{players.length}</strong></div>
                <div className="summary-card"><span>Activos</span><strong>{showEligiblePlayers.length}</strong></div>
                <div className="summary-card"><span>Duelo</span><strong>#{liveState.currentDuel}</strong></div>
              </div>
              <div className="show-standby-list">
                {finalRanking.map((player, index) => (
                  <article className={`show-standby-row ${index === 0 ? 'is-top' : ''}`} key={player.id}>
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
            <div className="show-draw-side show-draw-side-left">
              <div className="show-badge">EQUIPO CORAL</div>
              <h2>{showSpinnerActive ? 'Girando...' : showSelectedPlayerLeft?.name ?? 'Listo para salir'}</h2>
              <p>{showSpinnerActive ? 'El lado coral está buscando a su protagonista.' : `Jugador #${String(showSelectedPlayerLeft?.playerNumber ?? '?').padStart(2, '0')}`}</p>
              <div className="show-roller-shell">
                <span className="show-roller-arrow" aria-hidden="true">➜</span>
                <div className={`show-roller-viewport ${showSpinnerActive ? 'is-spinning' : ''}`}>
                  <div className="show-roller-focus" aria-hidden="true" />
                  <div className="show-roller-track" style={{ transform: `translateY(${showSpinnerOffsets.left}px)` }}>
                    {showDrawTrack.map((player, index) => (
                      <div className={`show-roller-item ${showSpinnerSelection?.leftId === player.id && !showSpinnerActive ? 'is-selected' : ''}`} key={`show-left-${player.id}-${index}`}>
                        <span>#{String(player.playerNumber).padStart(2, '0')}</span>
                        <strong>{player.name}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="show-draw-side show-draw-side-right">
              <div className="show-badge">EQUIPO TEAL</div>
              <h2>{showSpinnerActive ? 'Girando...' : showSelectedPlayerRight?.name ?? 'Listo para salir'}</h2>
              <p>{showSpinnerActive ? 'El lado teal está cerrando la dupla del duelo.' : `Jugador #${String(showSelectedPlayerRight?.playerNumber ?? '?').padStart(2, '0')}`}</p>
              <div className="show-roller-shell">
                <span className="show-roller-arrow is-right" aria-hidden="true">➜</span>
                <div className={`show-roller-viewport ${showSpinnerActive ? 'is-spinning' : ''}`}>
                  <div className="show-roller-focus" aria-hidden="true" />
                  <div className="show-roller-track" style={{ transform: `translateY(${showSpinnerOffsets.right}px)` }}>
                    {showDrawTrack.map((player, index) => (
                      <div className={`show-roller-item ${showSpinnerSelection?.rightId === player.id && !showSpinnerActive ? 'is-selected' : ''}`} key={`show-right-${player.id}-${index}`}>
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
            <p>{showSpinnerActive ? 'Los dos tambores giran juntos hasta clavar una pareja distinta.' : 'La pareja quedó definida y pasa directo a la placa de versus.'}</p>
          </div>
          <div className="broadcast-actions">
            <button className="primary-action" type="button" onClick={startShowDuelDraw} disabled={showSpinnerActive || showEligiblePlayers.length < 2}>
              {showSpinnerActive ? 'Girando...' : 'Comenzar sorteo'}
            </button>
            <button className="secondary-action" type="button" onClick={() => setShowFlowStep('standby')} disabled={showSpinnerActive}>Volver al ranking</button>
          </div>
        </section>
      ) : null}

      {showFlowStep === 'versus' ? (
        <section className="broadcast-card show-versus-stage">
          <div className="show-versus-hero">
            <div className="show-versus-card show-versus-left">
              <span>Jugador coral</span>
              <strong>{showDuelNames.left}</strong>
            </div>
            <div className="show-versus-vs">VS</div>
            <div className="show-versus-card show-versus-right">
              <span>Jugador teal</span>
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
          <p>El duelo arranca en segundos. Todo está sincronizado para entrar al vivo con la dupla sorteada.</p>
          <div className="show-ready-hero">
            <div className="show-ready-card">
              <span>Duelo</span>
              <strong>{showDuelNames.left} vs {showDuelNames.right}</strong>
            </div>
            <div className="show-ready-card">
              <span>Cuenta regresiva</span>
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
            onTransitionEnd={handleWheelTransitionEnd}
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
            <span>Estado</span>
            <span>Puntos</span>
            <span>Acciones</span>
          </div>
          <div className="players-list">
            {sortedPlayers.map((player) => (
              <article className={`player-row ${player.active ? '' : 'is-muted'} ${celebratingPlayerId === player.id ? 'is-celebrating' : ''}`} key={player.id}>
                <div className="player-row-cell player-row-index">
                  <span className="player-index">#{String(player.playerNumber).padStart(2, '0')}</span>
                </div>
                <div className="player-row-cell player-row-name">
                  <strong>{player.name}</strong>
                  <div className="player-badges compact">
                    {player.winStreak > 0 ? <span className="player-badge">Racha {player.winStreak}</span> : null}
                    {player.imbatible ? <span className="player-badge highlight">Imbatible</span> : null}
                  </div>
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

  const renderBroadcast = () => (
    <section className="hero-frame broadcast-frame">
      <div className="match-header broadcast-header-minimal">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
      </div>
      <div className="broadcast-tabs" role="tablist" aria-label="Vistas en vivo">
        <button className={`broadcast-tab ${broadcastView === 'conductor' ? 'is-active' : ''}`} type="button" onClick={() => setBroadcastView('conductor')}>Host</button>
        <button className={`broadcast-tab ${broadcastView === 'show' ? 'is-active' : ''}`} type="button" onClick={() => setBroadcastView('show')}>Show</button>
        <button className={`broadcast-tab ${broadcastView === 'standby' ? 'is-active' : ''}`} type="button" onClick={() => setBroadcastView('standby')}>Standby</button>
      </div>
      <div className="broadcast-connection">
        <span className={`machine-chip ${liveConnection === 'connected' ? '' : 'secondary'}`}>Servidor {liveConnection}</span>
        <span className="machine-chip secondary">{liveState.connectedClients} clientes</span>
        <span className="machine-chip secondary">Duelo #{liveState.currentDuel}</span>
      </div>
      {broadcastView === 'conductor' ? (
        <div className="broadcast-grid">
          <section className="broadcast-card conductor-card">
            <div className="broadcast-card-head">
              <span className="machine-chip">HOST</span>
              <span className="machine-chip secondary">{liveState.questionVisible ? 'Pregunta al aire' : 'Pregunta oculta'}</span>
            </div>
            <h2>Admin de aire</h2>
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
          </section>
          <section className="broadcast-card conductor-card">
            <div className="broadcast-card-head">
              <span className="machine-chip secondary">ACCIONES</span>
              <span className={`machine-chip secondary ${liveState.stealAvailable ? 'is-live-highlight' : ''}`}>{liveState.stealAvailable ? `ROBO ${liveStealName}` : 'ROBO CERRADO'}</span>
            </div>
            <h2>Control del duelo</h2>
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
      ) : broadcastView === 'show' ? (
        <div className="broadcast-grid show-grid show-grid-single">
          <section className={`broadcast-card show-stage ${liveState.responderSide ? `is-${liveState.responderSide}` : ''}`}>
            <div className="show-stage-topline">
              <span className="show-badge">DUELO #{liveState.currentDuel}</span>
              <span className="machine-chip secondary">{liveState.currentTheme}</span>
            </div>
            {!liveState.questionVisible ? (
              <div className="show-question-card is-hidden">
                <span>L&apos;Imbatiblú</span>
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
              <div><span>{liveState.teamNames.playerA}</span><strong>{liveState.scoreboard.playerA}</strong></div>
              <div><span>{liveState.teamNames.playerB}</span><strong>{liveState.scoreboard.playerB}</strong></div>
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
        </div>
      ) : (
        <>
          <div className="broadcast-grid standby-grid">
            <section className="broadcast-card standby-stage">
              <div className="show-badge">STANDBY</div>
              <h2>Ranking en vivo</h2>
              <p>Lista rankeada con las fuentes de verdad de la app: puntos, rondas ganadas, robos y estado Imbatible.</p>
              <div className="standby-summary">
                <div className="summary-card"><span>Jugadores</span><strong>{players.length}</strong></div>
                <div className="summary-card"><span>Imbatibles</span><strong>{imbatibles}</strong></div>
                <div className="summary-card"><span>Duelo</span><strong>#{liveState.currentDuel}</strong></div>
              </div>
              <div className="standby-list">
                {finalRanking.map((player, index) => (
                  <article className={`standby-row ${index === 0 ? 'is-top' : ''}`} key={player.id}>
                    <div className="standby-rank">
                      <span>#{String(index + 1).padStart(2, '0')}</span>
                      <strong>{player.name}</strong>
                    </div>
                    <div className="standby-metrics">
                      <div><span>Puntos</span><strong>{player.points}</strong></div>
                      <div><span>Rondas</span><strong>{player.roundsWon}</strong></div>
                      <div><span>Robos</span><strong>{player.stealsWon}</strong></div>
                      <div><span>Jugador</span><strong>#{player.playerNumber}</strong></div>
                    </div>
                    <div className="standby-badges">
                      {player.imbatible ? <span className="player-badge highlight">Imbatible</span> : <span className="player-badge muted">Activo</span>}
                      {player.active ? <span className="player-badge">En rueda</span> : <span className="player-badge muted">Fuera</span>}
                      <span className="player-badge">Racha {player.winStreak}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
          <div className="broadcast-actions">
            <button className="primary-action" type="button" onClick={() => navigateToScreen('duelDraw')}>Comenzar sorteo de duelo</button>
          </div>
        </>
      )}
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
          {['playerA', 'playerB'].map((side) => (
            <button
              key={side}
              className={`competitor-action-card ${side === 'playerA' ? 'is-playerA' : 'is-playerB'}`}
              type="button"
              onClick={() => dispatchLiveAction({ type: 'PLAYER_BUZZ_IN', side })}
              disabled={!canCompetitorBuzz(side)}
            >
              <span>{side === 'playerA' ? 'Equipo coral' : 'Equipo teal'}</span>
              <strong>{liveState.teamNames[side]}</strong>
              <em>{canCompetitorBuzz(side) ? 'RESPONDER' : liveState.responderSide === side ? 'TENÉS LA PALABRA' : 'ESPERA'}</em>
            </button>
          ))}
        </div>
      </section>
    </section>
  );

  const renderDuelDraw = () => (
    <section className="hero-frame duel-draw-frame">
      <div className="play-header">
        <button className="back-button" type="button" onClick={goBackScreen}>← Volver</button>
        <div className="play-header-copy">
          <p className="sponsor-line">SORTEO DE DUELO</p>
          <h1 className="play-title">Roller vs roller</h1>
        </div>
      </div>

      <div className="duel-draw-layout">
        <section className="broadcast-card duel-draw-stage">
          <div className="duel-draw-head">
            <span className="machine-chip">DUELO</span>
            <span className={`machine-chip ${duelDrawEligiblePlayers.length >= 2 ? 'secondary' : ''}`}>{duelDrawEligiblePlayers.length >= 2 ? 'Listo para sortear' : 'Faltan jugadores aptos'}</span>
          </div>
          <p>La app toma a los jugadores activos, saca a los Imbatibles y respeta la racha activa para no volver a meter al mismo que ya viene en juego.</p>
          <div className="duel-draw-rollers">
            {[{ side: 'A', offset: duelDrawState.leftOffset, player: duelDrawResultPlayerA }, { side: 'B', offset: duelDrawState.rightOffset, player: duelDrawResultPlayerB }].map((roller) => (
              <div className="duel-roller" key={roller.side}>
                <div className="duel-roller-label">ROLLER {roller.side}</div>
                <div className={`duel-roller-viewport ${duelDrawState.spinning ? 'is-spinning' : ''}`}>
                  <div className="duel-roller-marker" />
                  <div className="duel-roller-track" style={{ transform: `translateY(${roller.offset}px)` }}>
                    {duelDrawTrack.map((player, index) => (
                      <div className={`duel-roller-item ${player.id === roller.player?.id ? 'is-selected' : ''}`} key={`${roller.side}-${player.id}-${index}`}>
                        <span>#{String(player.playerNumber).padStart(2, '0')}</span>
                        <strong>{player.name}</strong>
                        {player.winStreak > 0 ? <em>Racha {player.winStreak}</em> : <em>Activo</em>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="duel-draw-result">
            <span>Resultado</span>
            <strong>{duelDrawState.selection && !duelDrawState.spinning ? `${duelDrawResultPlayerA?.name ?? 'Pendiente'} vs ${duelDrawResultPlayerB?.name ?? 'Pendiente'}` : duelDrawState.status}</strong>
            <p>{duelDrawState.selection && !duelDrawState.spinning ? `J${duelDrawResultPlayerA?.playerNumber ?? '?'} vs J${duelDrawResultPlayerB?.playerNumber ?? '?'}` : 'Los dos tambores giran juntos hasta clavar una pareja distinta.'}</p>
          </div>
        </section>

        <aside className="broadcast-card duel-draw-side">
          <h2>Jugadores aptos</h2>
          <p>{duelDrawEligiblePlayers.length ? 'Estos entran en el sorteo actual.' : 'No hay suficientes jugadores que cumplan las condiciones.'}</p>
          <div className="show-side-list">
            {duelDrawEligiblePlayers.slice(0, 6).map((player) => (
              <div className="show-side-item" key={player.id}>
                <span>#{String(player.playerNumber).padStart(2, '0')}</span>
                <strong>{player.name}</strong>
              </div>
            ))}
          </div>
          {duelDrawBlockedPlayerId ? (
            <div className="broadcast-note">
              <strong>Racha activa:</strong>
              <span> Se excluye al jugador que viene sosteniendo la seguidilla para que el sorteo no lo repita.</span>
            </div>
          ) : null}
          <div className="broadcast-actions">
            <button className="primary-action" type="button" onClick={startDuelDraw} disabled={duelDrawState.spinning || duelDrawEligiblePlayers.length < 2}>
              {duelDrawState.spinning ? 'Girando...' : 'Comenzar sorteo'}
            </button>
            <button className="secondary-action" type="button" onClick={() => setDuelDrawState({ spinning: false, status: 'Listo para sortear', selection: null, leftOffset: 0, rightOffset: 0 })}>Limpiar</button>
            <button className="secondary-action" type="button" onClick={applyDuelDrawSelection} disabled={!duelDrawState.selection || duelDrawState.spinning}>Continuar</button>
            <button className="secondary-action" type="button" onClick={() => { if (duelDrawState.selection) { setDuelSeats({ playerA: duelDrawState.selection.playerAId, playerB: duelDrawState.selection.playerBId }); setBroadcastView('conductor'); navigateToScreen('broadcast'); } }} disabled={!duelDrawState.selection || duelDrawState.spinning}>Ir al host</button>
          </div>
        </aside>
      </div>
    </section>
  );

  const renderDuelIntro = () => {
    const introPlayerA = duelSeatPlayerA;
    const introPlayerB = duelSeatPlayerB;

    return (
      <section className="hero-frame duel-intro-frame">
        <div className="duel-intro-stage">
          <div className="duel-intro-pulse" />
          <div className="show-badge">COMIENZA EL DUELO</div>
          <h1>Que empiece el cruce</h1>
          <p>
            {introPlayerA?.name ?? 'Jugador A'} vs {introPlayerB?.name ?? 'Jugador B'}
          </p>
          <div className="duel-intro-versus">
            <div className="duel-intro-card">
              <span>J{introPlayerA?.playerNumber ?? '?'}</span>
              <strong>{introPlayerA?.name ?? 'Pendiente'}</strong>
            </div>
            <div className="duel-intro-vs">VS</div>
            <div className="duel-intro-card">
              <span>J{introPlayerB?.playerNumber ?? '?'}</span>
              <strong>{introPlayerB?.name ?? 'Pendiente'}</strong>
            </div>
          </div>
          <div className="broadcast-actions duel-intro-actions">
            <button className="primary-action" type="button" onClick={continueFromDuelIntro}>Continuar</button>
            <button className="secondary-action" type="button" onClick={goBackScreen}>Volver</button>
          </div>
        </div>
      </section>
    );
  };

  const renderDuelFinalize = () => {
    const introPlayerA = duelSeatPlayerA;
    const introPlayerB = duelSeatPlayerB;

    return (
      <section className="hero-frame duel-intro-frame">
        <div className="duel-intro-stage duel-finalize-stage">
          <div className="duel-intro-pulse" />
          <div className="show-badge">FINALIZACION DEL DUELO</div>
          <h1>Cerramos esta ronda</h1>
          <p>
            {introPlayerA?.name ?? 'Jugador A'} vs {introPlayerB?.name ?? 'Jugador B'}
          </p>
          <div className="duel-intro-versus">
            <div className="duel-intro-card">
              <span>Salida</span>
              <strong>Standby</strong>
            </div>
            <div className="duel-intro-vs">→</div>
            <div className="duel-intro-card">
              <span>Destino</span>
              <strong>Vista en vivo</strong>
            </div>
          </div>
          <div className="broadcast-actions duel-intro-actions">
            <button className="primary-action" type="button" onClick={returnToStandby}>Volver a standby</button>
            <button className="secondary-action" type="button" onClick={() => navigateToScreen('broadcast')}>Ir al vivo</button>
          </div>
        </div>
      </section>
    );
  };

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
        <div className="summary-card"><span>Lider</span><strong>{finalWinner?.name ?? 'Pendiente'}</strong></div>
      </div>
      <div className="players-rule"><strong>Desempate:</strong><span>Primero puntos, luego rondas ganadas, despues robos correctos, estado Imbatible y por ultimo numero de jugador.</span></div>
      <div className="players-layout">
        <section className="players-panel">
          <div className="players-list">
            {finalRanking.map((player, index) => (
              <article className={`player-card ${index === 0 ? 'is-celebrating' : ''}`} key={player.id}>
                <div className="player-card-top">
                  <div>
                    <span className="player-index">#{String(index + 1).padStart(2, '0')}</span>
                    <h2>{player.name}</h2>
                  </div>
                  <div className="player-badges">
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
      {screen === 'duelDraw' && renderDuelDraw()}
      {screen === 'duelIntro' && renderDuelIntro()}
      {screen === 'duelFinalize' && renderDuelFinalize()}
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
