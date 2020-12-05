import { effects } from 'ferp';
import Action from './actions';
import { SendOwnership } from './websocket';
import * as Connection from './connection';

const defaultStatistics = {
  mobbers: 0,
  goals: 0,
  connections: 0,
};

const extractStatistics = message => {
  const { type, ...data } = JSON.parse(message);

  switch (type) {
    case 'goals:update':
      return { goals: data.goals.length };

    case 'mob:update':
      return { mobbers: data.mob.length };

    default:
      return {};
  }
};

export const update = (action, state) =>
  Action.caseOf(
    {
      Init: () => [
        {
          connections: [],
          statistics: {},
        },
        effects.none(),
      ],

      AddConnection: (websocket, timerId) => {
        const connection = Connection.make(websocket, timerId);

        return [
          {
            ...state,
            connections: state.connections.concat(connection),
          },
          effects.batch([
            Action.SetTimerOwner(timerId),
            Action.UpdateStatisticsFromConnections(timerId),
          ]),
        ];
      },

      RemoveConnection: (websocket, timerId) => {
        const connections = state.connections.filter(
          c => c.getWebsocket() !== websocket,
        );

        return [
          {
            ...state,
            connections,
          },
          effects.batch([
            effects.thunk(() => {
              websocket.close();
              return effects.none();
            }),
            Action.SetTimerOwner(timerId),
            Action.UpdateStatisticsFromConnections(timerId),
          ]),
        ];
      },

      MessageTimer: (websocket, timerId, message) => {
        const connections = state.connections.filter(
          connection =>
            connection.timerId === timerId &&
            connection.getWebsocket() !== websocket,
        );

        return [
          state,
          effects.batch([
            effects.thunk(() => {
              connections.forEach(connection => {
                connection.getWebsocket().send(message);
              });
              return effects.none();
            }),
            Action.UpdateStatisticsFromMessage(timerId, message),
          ]),
        ];
      },

      MessageTimerOwner: (websocket, timerId, message) => {
        const owner = state.connections.find(
          c => c.timerId === timerId && c.isOwner,
        );

        return [
          state,
          effects.thunk(() => {
            if (owner && owner.getWebsocket() !== websocket) {
              owner.getWebsocket().send(message);
            }
            return effects.none();
          }),
        ];
      },

      UpdateStatisticsFromMessage: (timerId, message) => {
        const statistics = {
          ...state.statistics,
          [timerId]: {
            ...defaultStatistics,
            ...state.statistics[timerId],
            ...extractStatistics(message),
          },
        };

        return [
          {
            ...state,
            statistics,
          },
          effects.none(),
        ];
      },

      UpdateStatisticsFromConnections: timerId => {
        const connections = state.connections.filter(
          connection => connection.timerId === timerId,
        );

        const { [timerId]: old, ...prevStatistics } = state.statistics;

        const augment =
          connections.length > 0
            ? {
                [timerId]: {
                  ...defaultStatistics,
                  ...old,
                  connections: connections.length,
                },
              }
            : {};

        const statistics = {
          ...prevStatistics,
          ...augment,
        };

        return [
          {
            ...state,
            statistics,
          },
          effects.none(),
        ];
      },

      SetTimerOwner: timerId => {
        function findFirstConnectionToTimer() {
          return state.connections.findIndex(c => c.timerId === timerId);
        }

        function doNothing() {
          return [state, effects.none()];
        }

        const firstConnectionIndex = findFirstConnectionToTimer();
        const noConnectionsToTimer = firstConnectionIndex < 0;
        if (noConnectionsToTimer) {
          return doNothing();
        }

        function firstConnectionIsOwner(connection, index) {
          const isFirstConnection = firstConnectionIndex === index;
          return {
            ...connection,
            isOwner: isFirstConnection ? true : connection.isOwner,
          };
        }

        const connections = state.connections.map(firstConnectionIsOwner);

        function isConnectedToCurrentTimer(connection) {
          return connection.timerId === timerId;
        }

        function connectionFilterPredicate(connection, index) {
          return (
            isConnectedToCurrentTimer(connection) &&
            !(index === firstConnectionIndex)
          );
        }

        const timerConnections = connections.filter(connectionFilterPredicate);

        return [
          {
            ...state,
            connections,
          },
          effects.batch([
            SendOwnership(connections[firstConnectionIndex], true),
            ...timerConnections.map(tc => SendOwnership(tc, false)),
          ]),
        ];
      },
    },
    action,
  );
