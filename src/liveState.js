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

export function buildInitialShowState() {
  return {
    flowStep: 'intro',
    sessionStarted: false,
    spinnerActive: false,
    spinnerSelection: null,
    spinnerOffsets: { left: 0, right: 0 },
    duelNames: { left: 'Jugador X', right: 'Jugador Y' },
    duelSelection: { leftId: null, rightId: null },
    drawPool: [],
    readyCountdown: 10,
    introExiting: false,
    duelLaunched: false,
    spinnerEndsAt: null,
    wheelRotation: 0,
    wheelResult: null,
    wheelSpinning: false,
    wheelEndsAt: null,
    wheelTargetTheme: null,
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
  currentQuestionId: null,
  question: 'Esperando una pregunta del host',
  answer: 'Todavia no hay respuesta cargada',
  questionVisible: false,
  revealAnswer: false,
  turnSide: 'playerA',
  nextTurnSide: null,
  stealAvailable: false,
  responderSide: null,
  buzzLockedSide: null,
  responseOutcome: null,
  participantAction: null,
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
  show: buildInitialShowState(),
  sharedAppState: null,
};

function resolveOutcomeSide(state) {
  return state.responseOutcome?.side ?? state.responderSide ?? state.turnSide ?? 'playerA';
}

export function resolveNextQuestionTurnSide(state) {
  if (!state || typeof state !== 'object') {
    return 'playerA';
  }

  const fallbackSide = state.nextTurnSide ?? state.turnSide ?? 'playerA';

  if (!state.responseOutcome?.status) {
    return fallbackSide;
  }

  const outcomeSide = resolveOutcomeSide(state);

  if (state.responseOutcome.status === 'success') {
    return state.turnLabel === 'Robo correcto' ? outcomeSide : oppositeSide(outcomeSide);
  }

  return oppositeSide(outcomeSide);
}

function normalizeResolvedTurnState(state) {
  if (!state || typeof state !== 'object' || !state.responseOutcome?.status) {
    return state;
  }

  const nextTurnSide = resolveNextQuestionTurnSide(state);

  if (state.currentQuestionId !== null) {
    return {
      ...state,
      nextTurnSide,
    };
  }

  return {
    ...state,
    turnSide: nextTurnSide,
    nextTurnSide,
  };
}

export function buildLiveStateFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return initialLiveState;
  }

  const hydratedState = {
    ...initialLiveState,
    ...snapshot,
    timer: {
      ...initialLiveState.timer,
      ...(snapshot.timer ?? {}),
    },
    scoreboard: {
      ...initialLiveState.scoreboard,
      ...(snapshot.scoreboard ?? {}),
    },
    teamNames: {
      ...initialLiveState.teamNames,
      ...(snapshot.teamNames ?? {}),
    },
    show: {
      ...buildInitialShowState(),
      ...(snapshot.show ?? {}),
      spinnerOffsets: {
        ...buildInitialShowState().spinnerOffsets,
        ...(snapshot.show?.spinnerOffsets ?? {}),
      },
      duelNames: {
        ...buildInitialShowState().duelNames,
        ...(snapshot.show?.duelNames ?? {}),
      },
      duelSelection: {
        ...buildInitialShowState().duelSelection,
        ...(snapshot.show?.duelSelection ?? {}),
      },
      drawPool: Array.isArray(snapshot.show?.drawPool) ? snapshot.show.drawPool : buildInitialShowState().drawPool,
    },
  };

  return normalizeResolvedTurnState(hydratedState);
}

export function isShowInProgress(showState) {
  if (!showState || typeof showState !== 'object') return false;

  return (
    showState.flowStep !== 'intro' ||
    Boolean(showState.duelLaunched) ||
    Boolean(showState.spinnerActive) ||
    Boolean(showState.spinnerSelection?.leftId || showState.spinnerSelection?.rightId) ||
    Boolean(showState.spinnerEndsAt) ||
    Boolean(showState.wheelSpinning) ||
    Boolean(showState.wheelEndsAt) ||
    Boolean(showState.wheelTargetTheme) ||
    Boolean(showState.wheelResult)
  );
}

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
        currentDuel: action.currentDuel ?? state.currentDuel,
      };
    case 'NEXT_DUEL':
      return {
        ...state,
        currentDuel: state.currentDuel + 1,
        currentTheme: 'Historia',
        currentQuestionId: null,
        question: 'Esperando una pregunta del host',
        answer: 'Todavia no hay respuesta cargada',
        questionVisible: false,
        revealAnswer: false,
        turnSide: 'playerA',
        nextTurnSide: null,
        stealAvailable: false,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: null,
        buzzToken: null,
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
        currentQuestionId: null,
        nextTurnSide: null,
        phaseIndex: Math.max(state.phaseIndex, 1),
        message: `Tema fijado: ${action.theme}`,
        lastAction: 'SET_THEME',
      };
    case 'SET_QUESTION':
      return {
        ...state,
        currentQuestionId: action.questionId ?? null,
        question: action.question,
        answer: action.answer ?? state.answer,
        currentTheme: action.theme ?? state.currentTheme,
        questionVisible: false,
        revealAnswer: false,
        nextTurnSide: null,
        stealAvailable: false,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: null,
        nextTurnSide: null,
        turnSide: action.turnSide ?? state.turnSide,
        timer: buildIdleTimer(),
        turnLabel: 'Pregunta oculta',
        message: 'Pregunta cargada y lista para revelar',
        phaseIndex: Math.max(state.phaseIndex, 1),
        lastAction: 'SET_QUESTION',
      };
    case 'PARTICIPANT_PRIMARY_ACTION':
      return {
        ...state,
        participantAction: {
          side: action.side ?? null,
          kind: action.kind ?? 'response',
          token: Date.now(),
        },
        message: `${state.teamNames[action.side ?? state.turnSide]} activo ${action.kind === 'steal' ? 'robo' : 'respuesta'}`,
        lastAction: 'PARTICIPANT_PRIMARY_ACTION',
      };
    case 'REVEAL_QUESTION':
      return {
        ...state,
        questionVisible: true,
        revealAnswer: false,
        stealAvailable: false,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: null,
        nextTurnSide: null,
        timer: {
          label: 'Respuesta',
          seconds: 12,
          running: true,
          mode: 'response',
        },
        turnLabel: 'Esperando responder',
        message: 'Pregunta revelada al aire',
        phaseIndex: LIVE_PHASES.findIndex((phase) => phase.id === 'question_turn'),
        lastAction: 'REVEAL_QUESTION',
      };
    case 'PLAYER_BUZZ_IN': {
      if (!state.questionVisible || state.responseOutcome || state.responderSide) return state;

      return {
        ...state,
        responderSide: action.side,
        buzzLockedSide: action.side,
        buzzToken: Date.now(),
        turnLabel: `${state.teamNames[action.side]} responde`,
        message: `${state.teamNames[action.side]} tomo la palabra`,
        lastAction: 'PLAYER_BUZZ_IN',
        timer: {
          ...state.timer,
          running: false,
        },
      };
    }
    case 'SET_TURN_SIDE':
      return {
        ...state,
        turnSide: action.side,
        nextTurnSide: null,
        stealAvailable: false,
        responderSide: null,
        buzzLockedSide: null,
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
        if (state.responseOutcome?.status === 'error' && state.stealAvailable && !state.responderSide) {
          const nextTurnSide = oppositeSide(state.turnSide);
          return {
            ...state,
            stealAvailable: false,
            currentQuestionId: null,
            responseOutcome: null,
            responderSide: null,
            turnSide: nextTurnSide,
            timer: buildIdleTimer(),
            turnLabel: buildTurnMessage(state, nextTurnSide, 'Turno de'),
            message: `${state.teamNames[nextTurnSide]} pasa al siguiente duelo`,
            lastAction: 'TICK_TIMER',
          };
        }
        if (!state.responderSide && !state.responseOutcome) {
          const nextTurnSide = oppositeSide(state.turnSide);
          return {
            ...state,
            stealAvailable: false,
            currentQuestionId: null,
            responderSide: null,
            buzzLockedSide: null,
            responseOutcome: null,
            turnSide: nextTurnSide,
            timer: buildIdleTimer(),
            turnLabel: buildTurnMessage(state, nextTurnSide, 'Turno de'),
            message: `${state.teamNames[nextTurnSide]} toma el siguiente turno`,
            lastAction: 'TICK_TIMER',
          };
        }
        if (state.responderSide && !state.responseOutcome) {
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
      const isSteal = scorerSide !== state.turnSide;
      return {
        ...resolveScore(state, scorerSide, isSteal ? `${state.teamNames[scorerSide]} robo bien` : `${state.teamNames[scorerSide]} respondio bien`),
        questionVisible: true,
        revealAnswer: true,
        stealAvailable: false,
        currentQuestionId: null,
        responderSide: scorerSide,
        buzzLockedSide: null,
        responseOutcome: buildOutcome(state, 'success', scorerSide),
        nextTurnSide: isSteal ? scorerSide : oppositeSide(scorerSide),
        timer: buildIdleTimer(),
        turnSide: isSteal ? scorerSide : oppositeSide(scorerSide),
        turnLabel: isSteal ? 'Robo correcto' : 'Respuesta correcta',
        lastAction: 'MARK_RESPONSE_CORRECT',
      };
    }
    case 'MARK_RESPONSE_WRONG': {
      const wrongSide = action.side ?? state.responderSide ?? state.turnSide;
      const isSteal = wrongSide !== state.turnSide;
      if (!isSteal) {
        return {
          ...state,
          stealAvailable: true,
          responderSide: null,
          buzzLockedSide: null,
          responseOutcome: buildOutcome(state, 'error', wrongSide),
          revealAnswer: false,
          nextTurnSide: oppositeSide(state.turnSide),
          phaseIndex: Math.max(state.phaseIndex, 2),
          message: `${state.teamNames[wrongSide]} fallo`,
          turnLabel: 'Respuesta incorrecta',
          lastAction: 'MARK_RESPONSE_WRONG',
        };
      }
      return {
        ...state,
        stealAvailable: false,
        currentQuestionId: null,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: buildOutcome(state, 'error', wrongSide),
        revealAnswer: true,
        turnSide: oppositeSide(wrongSide),
        nextTurnSide: oppositeSide(wrongSide),
        timer: buildIdleTimer(),
        phaseIndex: Math.max(state.phaseIndex, isSteal ? 3 : 2),
        message: isSteal ? `${state.teamNames[wrongSide]} fallo el robo` : `${state.teamNames[wrongSide]} fallo`,
        turnLabel: isSteal ? 'Robo incorrecto' : 'Respuesta incorrecta',
        lastAction: 'MARK_RESPONSE_WRONG',
      };
    }
    case 'MARK_NO_RESPONSE':
      return {
        ...state,
        stealAvailable: false,
        currentQuestionId: null,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: null,
        nextTurnSide: oppositeSide(state.turnSide),
        timer: buildIdleTimer(),
        turnSide: oppositeSide(state.turnSide),
        phaseIndex: Math.max(state.phaseIndex, 2),
        message: `${state.teamNames[oppositeSide(state.turnSide)]} toma el siguiente turno`,
        turnLabel: buildTurnMessage(state, oppositeSide(state.turnSide), 'Turno de'),
        lastAction: 'MARK_NO_RESPONSE',
      };
    case 'MARK_STEAL_CORRECT': {
      const scorerSide = action.side ?? state.responderSide ?? oppositeSide(state.turnSide);
      return {
        ...resolveScore(state, scorerSide, `${state.teamNames[scorerSide]} robo bien`),
        questionVisible: true,
        revealAnswer: true,
        stealAvailable: false,
        currentQuestionId: null,
        responderSide: scorerSide,
        buzzLockedSide: null,
        responseOutcome: buildOutcome(state, 'success', scorerSide),
        nextTurnSide: scorerSide,
        timer: buildIdleTimer(),
        turnSide: scorerSide,
        turnLabel: 'Robo correcto',
        lastAction: 'MARK_STEAL_CORRECT',
      };
    }
    case 'ANULATE_QUESTION':
      return {
        ...state,
        stealAvailable: false,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: null,
        revealAnswer: false,
        currentQuestionId: null,
        questionVisible: false,
        nextTurnSide: null,
        timer: buildIdleTimer(),
        message: 'Pregunta anulada',
        turnLabel: 'Sin pregunta valida',
        lastAction: 'ANULATE_QUESTION',
      };
    case 'ADD_SCORE': {
      const side = action.side === 'playerB' ? 'playerB' : 'playerA';
      const amount = Number.isFinite(action.amount) && action.amount < 0 ? -1 : 1;
      const nextScore = Math.max(0, (state.scoreboard[side] ?? 0) + amount);
      return {
        ...state,
        scoreboard: {
          ...state.scoreboard,
          [side]: nextScore,
        },
        message: `${state.teamNames[side]} ${amount > 0 ? 'sumo' : 'resto'} 1 punto`,
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
    case 'SET_REVEAL_ANSWER':
      return {
        ...state,
        questionVisible: action.value ? true : state.questionVisible,
        revealAnswer: Boolean(action.value),
        lastAction: 'SET_REVEAL_ANSWER',
      };
    case 'CLEAR_RESPONSE_OUTCOME':
      return {
        ...state,
        responseOutcome: null,
        responderSide: null,
        buzzLockedSide: null,
        lastAction: 'CLEAR_RESPONSE_OUTCOME',
      };
    case 'SET_CONNECTED_CLIENTS':
      return {
        ...state,
        connectedClients: action.count,
      };
    case 'SYNC_APP_STATE':
      return {
        ...state,
        sharedAppState: action.payload ?? null,
        lastAction: 'SYNC_APP_STATE',
      };
    case 'SHOW_PATCH':
      return {
        ...state,
        show: {
          ...state.show,
          ...action.patch,
        },
        lastAction: 'SHOW_PATCH',
      };
    case 'SHOW_RESET':
      return {
        ...state,
        show: buildInitialShowState(),
        lastAction: 'SHOW_RESET',
      };
    default:
      return state;
  }
}
