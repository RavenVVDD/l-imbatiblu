export const LIVE_PHASES = [
  { id: 'lobby', title: 'Lobby', description: 'La partida esta lista para arrancar.' },
  {
    id: 'theme_selection',
    title: 'Seleccion de tema',
    description: 'La ruleta define el tema unico del duelo.',
  },
  {
    id: 'question_turn',
    title: 'Turno de pregunta',
    description: 'La pregunta se revela y espera una respuesta.',
  },
  {
    id: 'steal_turn',
    title: 'Turno de robo',
    description: 'Se abre una ultima ventana para robar la pregunta.',
  },
  {
    id: 'resolution',
    title: 'Resolucion',
    description: 'La app registra acierto, error o anulacion.',
  },
  {
    id: 'duel_end',
    title: 'Fin de duelo',
    description: 'Se detecta ganador al llegar a 5 puntos.',
  },
  {
    id: 'player_swap',
    title: 'Cambio de jugador',
    description: 'El perdedor sale y entra el siguiente.',
  },
  {
    id: 'final',
    title: 'Final',
    description: 'Los mejores por puntaje pasan a la final.',
  },
];

function oppositeSide(side) {
  return side === 'playerA' ? 'playerB' : 'playerA';
}

function buildTurnMessage(state, side, label) {
  return `${label} para ${state.teamNames[side]}`;
}

function buildIdleTimer() {
  return {
    label: 'Listo',
    seconds: 0,
    running: false,
    mode: 'idle',
  };
}

function buildOutcome(state, status, side) {
  return {
    status,
    side,
    token: Date.now(),
    label: status === 'success' ? `${state.teamNames[side]} respondio bien` : `${state.teamNames[side]} fallo`,
  };
}

function resolveScore(state, scorerSide, message) {
  const nextScore = Math.max(0, state.scoreboard[scorerSide] + 1);
  const duelEndIndex = LIVE_PHASES.findIndex((phase) => phase.id === 'duel_end');
  const duelWon = nextScore >= 5;

  return {
    ...state,
    scoreboard: {
      ...state.scoreboard,
      [scorerSide]: nextScore,
    },
    phaseIndex: duelWon ? duelEndIndex : Math.max(state.phaseIndex, 4),
    duelWinnerSide: duelWon ? scorerSide : state.duelWinnerSide,
    duelFinished: duelWon || state.duelFinished,
    message: duelWon ? `${state.teamNames[scorerSide]} gano el duelo` : message,
    lastAction: 'SCORE_UPDATE',
  };
}

export const initialLiveState = {
  phaseIndex: 0,
  currentDuel: 1,
  currentTheme: 'Historia',
  question: 'Esperando una pregunta del host',
  answer: 'Todavia no hay respuesta cargada',
  questionVisible: false,
  revealAnswer: false,
  turnSide: 'playerA',
  stealAvailable: false,
  responderSide: null,
  responseOutcome: null,
  turnLabel: 'Listo para arrancar',
  timer: buildIdleTimer(),
  scoreboard: {
    playerA: 0,
    playerB: 0,
  },
  duelWinnerSide: null,
  duelFinished: false,
  teamNames: {
    playerA: 'Jugador A',
    playerB: 'Jugador B',
  },
  message: 'Esperando senal del host',
  connectedClients: 0,
  lastAction: 'idle',
};

export function liveReducer(state, action) {
  switch (action.type) {
    case 'NEXT_PHASE': {
      const nextIndex = Math.min(state.phaseIndex + 1, LIVE_PHASES.length - 1);
      return {
        ...state,
        phaseIndex: nextIndex,
        lastAction: 'NEXT_PHASE',
      };
    }
    case 'PREV_PHASE': {
      const prevIndex = Math.max(state.phaseIndex - 1, 0);
      return {
        ...state,
        phaseIndex: prevIndex,
        lastAction: 'PREV_PHASE',
      };
    }
    case 'RESET_FLOW':
      return {
        ...initialLiveState,
        connectedClients: state.connectedClients,
        teamNames: state.teamNames,
        currentDuel: state.currentDuel,
      };
    case 'NEXT_DUEL':
      return {
        ...state,
        currentDuel: state.currentDuel + 1,
        currentTheme: 'Historia',
        question: 'Esperando una pregunta del host',
        answer: 'Todavia no hay respuesta cargada',
        questionVisible: false,
        revealAnswer: false,
        turnSide: 'playerA',
        stealAvailable: false,
        responderSide: null,
        responseOutcome: null,
        turnLabel: 'Listo para arrancar',
        timer: buildIdleTimer(),
        scoreboard: {
          playerA: 0,
          playerB: 0,
        },
        duelWinnerSide: null,
        duelFinished: false,
        phaseIndex: 0,
        message: `Arranca el duelo ${state.currentDuel + 1}`,
        lastAction: 'NEXT_DUEL',
      };
    case 'SET_THEME':
      return {
        ...state,
        currentTheme: action.theme,
        phaseIndex: Math.max(state.phaseIndex, 1),
        message: `Tema fijado: ${action.theme}`,
        lastAction: 'SET_THEME',
      };
    case 'SET_QUESTION':
      return {
        ...state,
        question: action.question,
        answer: action.answer ?? state.answer,
        currentTheme: action.theme ?? state.currentTheme,
        questionVisible: false,
        revealAnswer: false,
        stealAvailable: false,
        responderSide: null,
        responseOutcome: null,
        turnSide: action.turnSide ?? state.turnSide,
        timer: buildIdleTimer(),
        turnLabel: 'Pregunta oculta',
        message: 'Pregunta cargada y lista para revelar',
        phaseIndex: Math.max(state.phaseIndex, 1),
        lastAction: 'SET_QUESTION',
      };
    case 'REVEAL_QUESTION':
      return {
        ...state,
        questionVisible: true,
        revealAnswer: false,
        stealAvailable: false,
        responderSide: null,
        responseOutcome: null,
        timer: {
          label: 'Respuesta',
          seconds: 5,
          running: true,
          mode: 'response',
        },
        turnLabel: 'Esperando responder',
        message: 'Pregunta revelada al aire',
        phaseIndex: LIVE_PHASES.findIndex((phase) => phase.id === 'question_turn'),
        lastAction: 'REVEAL_QUESTION',
      };
    case 'OPEN_STEAL_WINDOW': {
      const stealSide = action.side ?? oppositeSide(state.turnSide);
      return {
        ...state,
        questionVisible: true,
        stealAvailable: true,
        responderSide: null,
        responseOutcome: null,
        turnSide: stealSide,
        timer: {
          label: 'Robo',
          seconds: 3,
          running: true,
          mode: 'steal',
        },
        turnLabel: `Robo para ${state.teamNames[stealSide]}`,
        message: `${state.teamNames[stealSide]} puede robar`,
        phaseIndex: LIVE_PHASES.findIndex((phase) => phase.id === 'steal_turn'),
        lastAction: 'OPEN_STEAL_WINDOW',
      };
    }
    case 'PLAYER_BUZZ_IN': {
      if (!state.questionVisible || state.responseOutcome || state.responderSide) return state;
      if (state.stealAvailable && action.side !== state.turnSide) return state;

      return {
        ...state,
        responderSide: action.side,
        turnSide: action.side,
        turnLabel: `${state.teamNames[action.side]} responde`,
        message: `${state.teamNames[action.side]} tomo la palabra`,
        lastAction: 'PLAYER_BUZZ_IN',
      };
    }
    case 'SET_TURN_SIDE':
      return {
        ...state,
        turnSide: action.side,
        stealAvailable: false,
        responderSide: null,
        turnLabel: buildTurnMessage(state, action.side, 'Turno de'),
        message: `Turno asignado a ${state.teamNames[action.side]}`,
        lastAction: 'SET_TURN_SIDE',
      };
    case 'SET_TIMER':
      return {
        ...state,
        timer: {
          label: action.label,
          seconds: action.seconds,
          running: true,
          mode: action.mode,
        },
        message: `${action.label} en marcha`,
        lastAction: 'SET_TIMER',
      };
    case 'CLEAR_TIMER':
      return {
        ...state,
        timer: buildIdleTimer(),
        message: 'Reloj reiniciado',
        lastAction: 'CLEAR_TIMER',
      };
    case 'TICK_TIMER': {
      if (!state.timer.running) return state;
      if (state.timer.seconds <= 1) {
        return {
          ...state,
          timer: {
            ...state.timer,
            seconds: 0,
            running: false,
          },
          message: `${state.timer.label} finalizado`,
          lastAction: 'TICK_TIMER',
        };
      }
      return {
        ...state,
        timer: {
          ...state.timer,
          seconds: state.timer.seconds - 1,
        },
        lastAction: 'TICK_TIMER',
      };
    }
    case 'MARK_RESPONSE_CORRECT': {
      const scorerSide = action.side ?? state.responderSide ?? state.turnSide;
      return {
        ...resolveScore(state, scorerSide, `${state.teamNames[scorerSide]} respondio bien`),
        questionVisible: true,
        revealAnswer: true,
        stealAvailable: false,
        responderSide: scorerSide,
        responseOutcome: buildOutcome(state, 'success', scorerSide),
        timer: buildIdleTimer(),
        turnLabel: 'Respuesta correcta',
        lastAction: 'MARK_RESPONSE_CORRECT',
      };
    }
    case 'MARK_RESPONSE_WRONG': {
      const wrongSide = action.side ?? state.responderSide ?? state.turnSide;
      return {
        ...state,
        stealAvailable: true,
        responderSide: null,
        responseOutcome: buildOutcome(state, 'error', wrongSide),
        timer: buildIdleTimer(),
        phaseIndex: Math.max(state.phaseIndex, 3),
        turnSide: oppositeSide(wrongSide),
        message: `${state.teamNames[wrongSide]} fallo`,
        turnLabel: 'Respuesta incorrecta',
        lastAction: 'MARK_RESPONSE_WRONG',
      };
    }
    case 'MARK_NO_RESPONSE':
      return {
        ...state,
        stealAvailable: true,
        responderSide: null,
        responseOutcome: null,
        timer: buildIdleTimer(),
        phaseIndex: Math.max(state.phaseIndex, 3),
        turnSide: oppositeSide(action.side ?? state.turnSide),
        message: `${state.teamNames[action.side ?? state.turnSide]} no respondio`,
        turnLabel: 'Sin respuesta',
        lastAction: 'MARK_NO_RESPONSE',
      };
    case 'MARK_STEAL_CORRECT': {
      const scorerSide = action.side ?? state.responderSide ?? oppositeSide(state.turnSide);
      return {
        ...resolveScore(state, scorerSide, `${state.teamNames[scorerSide]} robo bien`),
        questionVisible: true,
        revealAnswer: true,
        stealAvailable: false,
        responderSide: scorerSide,
        responseOutcome: buildOutcome(state, 'success', scorerSide),
        timer: buildIdleTimer(),
        turnSide: scorerSide,
        turnLabel: 'Robo correcto',
        lastAction: 'MARK_STEAL_CORRECT',
      };
    }
    case 'MARK_STEAL_WRONG': {
      const wrongSide = action.side ?? state.responderSide ?? oppositeSide(state.turnSide);
      return {
        ...state,
        stealAvailable: false,
        responderSide: null,
        responseOutcome: buildOutcome(state, 'error', wrongSide),
        revealAnswer: true,
        timer: buildIdleTimer(),
        message: `${state.teamNames[wrongSide]} fallo el robo`,
        turnLabel: 'Robo incorrecto',
        lastAction: 'MARK_STEAL_WRONG',
      };
    }
    case 'ANULATE_QUESTION':
      return {
        ...state,
        stealAvailable: false,
        responderSide: null,
        responseOutcome: null,
        revealAnswer: false,
        questionVisible: false,
        timer: buildIdleTimer(),
        message: 'Pregunta anulada',
        turnLabel: 'Sin pregunta valida',
        lastAction: 'ANULATE_QUESTION',
      };
    case 'ADD_SCORE': {
      const nextScore = Math.max(0, state.scoreboard[action.side] + action.amount);
      return {
        ...state,
        scoreboard: {
          ...state.scoreboard,
          [action.side]: nextScore,
        },
        message: `Score actualizado para ${action.side}`,
        lastAction: 'ADD_SCORE',
      };
    }
    case 'SET_TEAM_NAMES':
      return {
        ...state,
        teamNames: {
          playerA: action.playerA ?? state.teamNames.playerA,
          playerB: action.playerB ?? state.teamNames.playerB,
        },
        lastAction: 'SET_TEAM_NAMES',
      };
    case 'TOGGLE_REVEAL':
      return {
        ...state,
        revealAnswer: !state.revealAnswer,
        lastAction: 'TOGGLE_REVEAL',
      };
    case 'CLEAR_RESPONSE_OUTCOME':
      return {
        ...state,
        responseOutcome: null,
        responderSide: null,
        lastAction: 'CLEAR_RESPONSE_OUTCOME',
      };
    case 'SET_CONNECTED_CLIENTS':
      return {
        ...state,
        connectedClients: action.count,
      };
    default:
      return state;
  }
}
