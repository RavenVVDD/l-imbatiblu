export const LIVE_PHASES = [
  { id: 'lobby', title: 'Lobby', description: 'La partida está lista para arrancar.' },
  {
    id: 'theme_selection',
    title: 'Selección de tema',
    description: 'La ruleta define el tema único del duelo.',
  },
  {
    id: 'question_turn',
    title: 'Turno de pregunta',
    description: 'La pregunta se revela y espera una respuesta.',
  },
  {
    id: 'steal_turn',
    title: 'Turno de robo',
    description: 'Se abre una última ventana para robar la pregunta.',
  },
  {
    id: 'resolution',
    title: 'Resolución',
    description: 'La app registra acierto, error o anulación.',
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

export const RESPONSE_TIMER_TOTAL_SECONDS = 20;
export const STEAL_WINDOW_START_SECOND = 12;
export const STEAL_WINDOW_REMAINING_SECONDS = RESPONSE_TIMER_TOTAL_SECONDS - STEAL_WINDOW_START_SECOND;

function oppositeSide(side) {
  return side === 'playerA' ? 'playerB' : 'playerA';
}

function isPlayerSide(side) {
  return side === 'playerA' || side === 'playerB';
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

const GROUP_DUEL_QUESTION_LIMIT = 6;

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
    groupDuelMode: false,
    groupDuelCursor: 0,
    groupDuelIntroEndsAt: null,
    groupDuel: null,
  };
}

function buildOutcome(state, status, side) {
  return {
    status,
    side,
    token: Date.now(),
    label: status === 'success' ? `${state.teamNames[side]} respondió bien` : `${state.teamNames[side]} falló`,
  };
}

function resolveScore(state, scorerSide, message) {
  const nextScore = Math.max(0, state.scoreboard[scorerSide] + 1);
  const duelEndIndex = LIVE_PHASES.findIndex((phase) => phase.id === 'duel_end');

  if (state.duelFormat === 'groups') {
    return finalizeGroupDuelProgress({
      ...state,
      scoreboard: {
        ...state.scoreboard,
        [scorerSide]: nextScore,
      },
      phaseIndex: Math.max(state.phaseIndex, 4),
      lastAction: 'SCORE_UPDATE',
    }, message);
  }

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
    message: duelWon ? `${state.teamNames[scorerSide]} ganó el duelo` : message,
    lastAction: 'SCORE_UPDATE',
  };
}

function finalizeGroupDuelProgress(state, message) {
  const duelEndIndex = LIVE_PHASES.findIndex((phase) => phase.id === 'duel_end');
  const resolvedQuestionCount = Math.min(GROUP_DUEL_QUESTION_LIMIT, (state.resolvedQuestionCount ?? 0) + 1);
  const scorePlayerA = state.scoreboard.playerA ?? 0;
  const scorePlayerB = state.scoreboard.playerB ?? 0;

  if (resolvedQuestionCount < GROUP_DUEL_QUESTION_LIMIT) {
    return {
      ...state,
      resolvedQuestionCount,
      duelFinished: false,
      duelWinnerSide: null,
      duelResult: null,
      message,
    };
  }

  if (scorePlayerA === scorePlayerB) {
    return {
      ...state,
      resolvedQuestionCount,
      duelFinished: true,
      duelWinnerSide: null,
      duelResult: 'tie',
      phaseIndex: duelEndIndex,
      message: 'Empate en el duelo de grupos',
    };
  }

  const duelWinnerSide = scorePlayerA > scorePlayerB ? 'playerA' : 'playerB';

  return {
    ...state,
    resolvedQuestionCount,
    duelFinished: true,
    duelWinnerSide,
    duelResult: 'win',
    phaseIndex: duelEndIndex,
    message: `${state.teamNames[duelWinnerSide]} ganó el duelo de grupos`,
  };
}

export const initialLiveState = {
  phaseIndex: 0,
  currentDuel: 1,
  duelFormat: 'standard',
  currentTheme: 'Historia',
  currentQuestionId: null,
  question: 'Esperando una pregunta del host',
  answer: 'Todavía no hay respuesta cargada',
  questionVisible: false,
  revealAnswer: false,
  turnSide: 'playerA',
  nextTurnSide: null,
  stealAvailable: false,
  responderSide: null,
  buzzLockedSide: null,
  responseOutcome: null,
  suspendedTimer: null,
  participantAction: null,
  timeoutEvent: null,
  turnLabel: 'Listo para arrancar',
  timer: buildIdleTimer(),
  scoreboard: {
    playerA: 0,
    playerB: 0,
  },
  duelWinnerSide: null,
  duelFinished: false,
  duelResult: null,
  resolvedQuestionCount: 0,
  teamNames: {
    playerA: 'Jugador A',
    playerB: 'Jugador B',
  },
  message: 'Esperando señal del host',
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
      groupDuelMode: Boolean(snapshot.show?.groupDuelMode),
      groupDuelCursor: Number.isFinite(snapshot.show?.groupDuelCursor) ? snapshot.show.groupDuelCursor : buildInitialShowState().groupDuelCursor,
      groupDuelIntroEndsAt: typeof snapshot.show?.groupDuelIntroEndsAt === 'number' ? snapshot.show.groupDuelIntroEndsAt : null,
      groupDuel: snapshot.show?.groupDuel ?? null,
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
        duelFormat: action.duelFormat === 'groups' ? 'groups' : 'standard',
        duelFinished: false, // Explicitly ensure duelFinished is reset
      };
    case 'NEXT_DUEL':
      return {
        ...state,
        currentDuel: state.currentDuel + 1,
        currentTheme: 'Historia',
        currentQuestionId: null,
        question: 'Esperando una pregunta del host',
        answer: 'Todavía no hay respuesta cargada',
        questionVisible: false,
        revealAnswer: false,
        turnSide: 'playerA',
        nextTurnSide: null,
        stealAvailable: false,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: null,
        buzzToken: null,
        timeoutEvent: null,
        turnLabel: 'Listo para arrancar',
        timer: buildIdleTimer(),
        scoreboard: {
          playerA: 0,
          playerB: 0,
        },
        duelWinnerSide: null,
        duelFinished: false,
        duelResult: null,
        resolvedQuestionCount: 0,
        duelFormat: 'standard',
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
        timeoutEvent: null,
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
        message: `${state.teamNames[action.side ?? state.turnSide]} activó ${action.kind === 'steal' ? 'robo' : 'respuesta'}`,
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
        timeoutEvent: null,
        nextTurnSide: null,
        timer: {
          label: 'Respuesta',
          seconds: RESPONSE_TIMER_TOTAL_SECONDS,
          running: true,
          mode: 'response',
        },
        turnLabel: 'Esperando responder',
        message: 'Pregunta revelada al aire',
        phaseIndex: LIVE_PHASES.findIndex((phase) => phase.id === 'question_turn'),
        lastAction: 'REVEAL_QUESTION',
      };
    case 'PLAYER_BUZZ_IN': {
      if (!isPlayerSide(action.side)) return state;
      if (!state.questionVisible || state.revealAnswer || state.responseOutcome || state.responderSide) return state;
      if (action.side !== state.turnSide && !state.stealAvailable && state.timer.mode !== 'steal') return state;

      return {
        ...state,
        responderSide: action.side,
        buzzLockedSide: action.side,
        buzzToken: Date.now(),
        turnLabel: `${state.teamNames[action.side]} responde`,
        message: `${state.teamNames[action.side]} tomó la palabra`,
        lastAction: 'PLAYER_BUZZ_IN',
        timeoutEvent: null,
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
        timeoutEvent: null,
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
        timeoutEvent: null,
      };
    case 'CLEAR_TIMER':
      return {
        ...state,
        timer: buildIdleTimer(),
        timeoutEvent: null,
        message: 'Reloj reiniciado',
        lastAction: 'CLEAR_TIMER',
      };
    case 'TICK_TIMER': {
      if (!state.timer.running) return state;

      if (state.timer.seconds > 1) {
        const nextSeconds = state.timer.seconds - 1;
        const stealWindowJustOpened =
          state.timer.mode === 'response' &&
          !state.stealAvailable &&
          !state.responderSide &&
          nextSeconds <= STEAL_WINDOW_REMAINING_SECONDS;

        return {
          ...state,
          stealAvailable: stealWindowJustOpened ? true : state.stealAvailable,
          timer: {
            ...state.timer,
            seconds: nextSeconds,
          },
          turnLabel: stealWindowJustOpened ? 'Robo habilitado' : state.turnLabel,
          message: stealWindowJustOpened ? `Robo habilitado para ${state.teamNames[oppositeSide(state.turnSide)]}` : state.message,
          lastAction: 'TICK_TIMER',
        };
      }

      const hasResponder = Boolean(state.responderSide);
      const hasOutcome = Boolean(state.responseOutcome);

      if (state.timer.mode === 'steal') {
        if (state.stealAvailable && !hasResponder) {
          const nextTurnSide = oppositeSide(state.turnSide);
          const nextState = {
            ...state,
            stealAvailable: false,
            currentQuestionId: null,
            questionVisible: false,
            revealAnswer: false,
            responseOutcome: null,
            responderSide: null,
            buzzLockedSide: null,
            timeoutEvent: {
              kind: 'steal_timeout',
              sides: ['playerA', 'playerB'],
              token: Date.now(),
            },
            turnSide: nextTurnSide,
            nextTurnSide,
            timer: buildIdleTimer(),
            turnLabel: buildTurnMessage(state, nextTurnSide, 'Turno de'),
            message: 'Tiempo agotado',
            lastAction: 'TICK_TIMER_STEAL_TIMEOUT',
          };
          return state.duelFormat === 'groups' ? finalizeGroupDuelProgress(nextState, nextState.message) : nextState;
        }

        console.warn('Timer expired in steal mode with an inconsistent state, forcing resolution.', {
          stealAvailable: state.stealAvailable,
          responderSide: state.responderSide,
          responseOutcome: state.responseOutcome,
          turnSide: state.turnSide,
        });

        const nextTurnSide = oppositeSide(state.turnSide);
        const nextState = {
          ...state,
          stealAvailable: false,
          currentQuestionId: null,
          questionVisible: false,
          revealAnswer: false,
          responseOutcome: state.responseOutcome ?? null,
          responderSide: null,
          buzzLockedSide: null,
          timeoutEvent: {
            kind: 'steal_timeout',
            sides: ['playerA', 'playerB'],
            token: Date.now(),
          },
          turnSide: nextTurnSide,
          nextTurnSide,
          timer: buildIdleTimer(),
          turnLabel: buildTurnMessage(state, nextTurnSide, 'Turno de'),
          message: 'Tiempo agotado',
          lastAction: 'TICK_TIMER_STEAL_TIMEOUT',
        };
        return state.duelFormat === 'groups' ? finalizeGroupDuelProgress(nextState, nextState.message) : nextState;
      }

      if (!hasResponder && !hasOutcome) {
        const nextTurnSide = oppositeSide(state.turnSide);
        const nextState = {
          ...state,
          stealAvailable: false,
          currentQuestionId: null,
          questionVisible: false,
          revealAnswer: false,
          responderSide: null,
          buzzLockedSide: null,
          responseOutcome: null,
          timeoutEvent: {
            kind: 'question_timeout',
            sides: ['playerA', 'playerB'],
            token: Date.now(),
          },
          turnSide: nextTurnSide,
          nextTurnSide,
          timer: buildIdleTimer(),
          turnLabel: buildTurnMessage(state, nextTurnSide, 'Turno de'),
          message: 'Tiempo agotado',
          lastAction: 'TICK_TIMER_QUESTION_TIMEOUT',
        };
        return state.duelFormat === 'groups' ? finalizeGroupDuelProgress(nextState, nextState.message) : nextState;
      }

      if (hasResponder && !hasOutcome) {
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

    case 'MARK_RESPONSE_CORRECT': {
      const scorerSide = action.side ?? state.responderSide ?? state.turnSide;
      const isSteal = scorerSide !== state.turnSide;
      return {
        ...resolveScore(state, scorerSide, isSteal ? `${state.teamNames[scorerSide]} robó bien` : `${state.teamNames[scorerSide]} respondió bien`),
        questionVisible: true,
        revealAnswer: true,
        stealAvailable: false,
        currentQuestionId: null,
        responderSide: scorerSide,
        buzzLockedSide: null,
        responseOutcome: buildOutcome(state, 'success', scorerSide),
        nextTurnSide: isSteal ? scorerSide : oppositeSide(scorerSide),
        timeoutEvent: null,
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
          suspendedTimer: {
            label: 'Tiempo de robo',
            seconds: state.timer.seconds,
            mode: 'steal',
            stealAvailable: true,
          },
          timeoutEvent: null,
          revealAnswer: false,
          timer: buildIdleTimer(),
          phaseIndex: Math.max(state.phaseIndex, LIVE_PHASES.findIndex((phase) => phase.id === 'steal_turn')),
          message: `${state.teamNames[wrongSide]} falló. La partida continuará en 5 segundos.`,
          turnLabel: 'Robo abierto',
          lastAction: 'MARK_RESPONSE_WRONG',
        };
      }

      const message = isSteal
        ? `${state.teamNames[wrongSide]} falló el robo`
        : `${state.teamNames[wrongSide]} falló. Se terminó la jugada.`;

      const nextState = {
        ...state,
        stealAvailable: false,
        currentQuestionId: null,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: buildOutcome(state, 'error', wrongSide),
        suspendedTimer: null,
        timeoutEvent: null,
        revealAnswer: true,
        turnSide: oppositeSide(wrongSide),
        nextTurnSide: oppositeSide(wrongSide),
        timer: buildIdleTimer(),
        phaseIndex: Math.max(state.phaseIndex, isSteal ? 3 : 2),
        message,
        turnLabel: isSteal ? 'Robo incorrecto' : 'Respuesta incorrecta',
        lastAction: 'MARK_RESPONSE_WRONG',
      };
      return state.duelFormat === 'groups' ? finalizeGroupDuelProgress(nextState, message) : nextState;
    }

    case 'MARK_NO_RESPONSE':
      {
      const nextState = {
        ...state,
        stealAvailable: false,
        currentQuestionId: null,
        questionVisible: false,
        revealAnswer: false,
        responderSide: null,
        buzzLockedSide: null,
        responseOutcome: null,
        timeoutEvent: null,
        nextTurnSide: oppositeSide(state.turnSide),
        timer: buildIdleTimer(),
        turnSide: oppositeSide(state.turnSide),
        phaseIndex: Math.max(state.phaseIndex, 2),
        message: `${state.teamNames[oppositeSide(state.turnSide)]} toma el siguiente turno`,
        turnLabel: buildTurnMessage(state, oppositeSide(state.turnSide), 'Turno de'),
        lastAction: 'MARK_NO_RESPONSE',
      };
      return state.duelFormat === 'groups' ? finalizeGroupDuelProgress(nextState, nextState.message) : nextState;
      }
    case 'MARK_STEAL_CORRECT': {
      const scorerSide = action.side ?? state.responderSide ?? oppositeSide(state.turnSide);
      return {
        ...resolveScore(state, scorerSide, `${state.teamNames[scorerSide]} robó bien`),
        questionVisible: true,
        revealAnswer: true,
        stealAvailable: false,
        currentQuestionId: null,
        responderSide: scorerSide,
        buzzLockedSide: null,
        responseOutcome: buildOutcome(state, 'success', scorerSide),
        nextTurnSide: scorerSide,
        timeoutEvent: null,
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
        timeoutEvent: null,
        revealAnswer: false,
        currentQuestionId: null,
        questionVisible: false,
        nextTurnSide: null,
        timer: buildIdleTimer(),
        message: 'Pregunta anulada',
        turnLabel: 'Sin pregunta válida',
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
        message: `${state.teamNames[side]} ${amount > 0 ? 'sumó' : 'restó'} 1 punto`,
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
        timer: action.value ? buildIdleTimer() : state.timer,
        timeoutEvent: action.value ? null : state.timeoutEvent,
        lastAction: 'SET_REVEAL_ANSWER',
      };
    case 'CLEAR_RESPONSE_OUTCOME':
      if (state.responseOutcome?.status === 'error' && state.suspendedTimer) {
        return {
          ...state,
          responseOutcome: null,
          suspendedTimer: null,
          responderSide: null,
          buzzLockedSide: null,
          stealAvailable: state.suspendedTimer.stealAvailable,
          timer: {
            label: state.suspendedTimer.label,
            seconds: state.suspendedTimer.seconds,
            running: true,
            mode: state.suspendedTimer.mode,
          },
          timeoutEvent: null,
          message: 'La jugada continúa',
          lastAction: 'CLEAR_RESPONSE_OUTCOME',
        };
      }
      return {
        ...state,
        responseOutcome: null,
        suspendedTimer: null,
        responderSide: null,
        buzzLockedSide: null,
        timeoutEvent: null,
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
