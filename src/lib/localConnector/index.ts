// Magistra locale depuis le site web : connecteur local de l'application Windows (voir shared/localConnector.ts).
// Point d'entrée unique ; chaque module peut aussi être importé directement.

export {
  createLocalEngineController, LocalEngineContext, OPEN_APP_POLL_MS, OPEN_APP_SEARCH_MS, useLocalEngine,
  type LocalEngineController, type LocalEngineState, type LocalEngineStateKind,
} from './controller';
export {
  CONNECTOR_CLIENT_TIMEOUTS, LocalConnectorClient, openMagistraUrl, PAIRING_NOT_RECEIVED_MESSAGE, STREAM_INTERRUPTED_MESSAGE,
  UNEXPECTED_REPLY_MESSAGE, UNSUPPORTED_BROWSER_MESSAGE, type LocalConnectorClientOptions,
} from './client';
export {
  adoptLocalChoiceAfterPairing, ENGINE_CHOICE_STORAGE_KEY, getEngineChoice, setEngineChoice, useEngineChoice, type EngineChoice,
} from './engineChoice';
export { queryLoopbackPermission, type LoopbackPermission } from './permission';
export {
  createIndexedDbPairingStore, createMemoryPairingStore, defaultPairingStore, MemoryPairingStore, PAIRING_DB_NAME,
  type PairingStore, type StoredPairing,
} from './pairingStore';
