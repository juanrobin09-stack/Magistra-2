// Magistra locale depuis le site web : connecteur local de l'application Windows (voir shared/localConnector.ts).
// Point d'entrée unique ; chaque module peut aussi être importé directement.

export {
  createLocalEngineController, LocalEngineContext, NOT_ANSWERED_PERMISSION_MESSAGE, OPEN_APP_ENGINE_START_MS, OPEN_APP_POLL_MS,
  OPEN_APP_SEARCH_MS, UNPAIR_NOT_CONFIRMED_MESSAGE, useLocalEngine,
  type LocalEngineController, type LocalEngineState, type LocalEngineStateKind,
} from './controller';
export {
  CONNECTOR_CLIENT_TIMEOUTS, LocalConnectorClient, openMagistraUrl, PAIRING_NOT_RECEIVED_MESSAGE, STOPPED_BY_APP_MESSAGE,
  STREAM_INTERRUPTED_MESSAGE, UNEXPECTED_REPLY_MESSAGE, UNRECOGNIZED_BY_APP_MESSAGE, UNSUPPORTED_BROWSER_MESSAGE,
  type LocalConnectorClientOptions,
} from './client';
export {
  adoptLocalChoiceAfterPairing, ENGINE_CHOICE_STORAGE_KEY, getEngineChoice, setEngineChoice, useEngineChoice, type EngineChoice,
} from './engineChoice';
export { queryLoopbackPermission, type LoopbackPermission } from './permission';
export { isDisplayableText, localEngineMessage } from './texts';
export {
  createIndexedDbPairingStore, createMemoryPairingStore, defaultPairingStore, MemoryPairingStore, PAIRING_DB_NAME,
  type PairingStore, type StoredPairing,
} from './pairingStore';
