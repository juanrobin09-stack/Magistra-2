// Autorisation du navigateur « accès au réseau local / aux applications de cet appareil » (Local Network Access de
// Chrome et Edge) : un site public qui veut joindre http://127.0.0.1 doit l'obtenir de l'enseignant.
//
// L'état est LU sans jamais déclencher la demande : seule une requête réelle vers la boucle locale (recherche ou
// connexion demandée par l'enseignant) fait apparaître la question du navigateur. Magistra ne contourne jamais cette
// protection : l'interface explique la demande AVANT qu'elle s'affiche, et comment l'accorder après un refus.
//
// Noms essayés dans l'ordre : « loopback-network » (autorisation propre à la boucle locale), puis
// « local-network-access » (nom initial de Chrome). Navigateur sans ce mécanisme (ou nom inconnu) : 'unsupported'.

export type LoopbackPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

const PERMISSION_NAMES = ['loopback-network', 'local-network-access'] as const;
/** Réponse de navigator.permissions.query : au-delà, l'état est considéré inconnu. */
const QUERY_TIMEOUT_MS = 2_000;

type PermissionsLike = Pick<Permissions, 'query'>;

function currentPermissions(): PermissionsLike | null {
  try {
    return typeof navigator !== 'undefined' && navigator.permissions && typeof navigator.permissions.query === 'function'
      ? navigator.permissions
      : null;
  } catch {
    return null;
  }
}

function queryWithTimeout(permissions: PermissionsLike, name: string): Promise<PermissionStatus | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), QUERY_TIMEOUT_MS);
    let pending: Promise<PermissionStatus>;
    try {
      // Nom absent des types du DOM (autorisation récente) : le navigateur rejette les noms qu'il ne connaît pas.
      pending = permissions.query({ name } as unknown as PermissionDescriptor);
    } catch {
      clearTimeout(timer);
      resolve(null);
      return;
    }
    pending.then(
      status => {
        clearTimeout(timer);
        resolve(status);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * État de l'autorisation d'accès à la boucle locale pour ce site, SANS la demander. Ne lève jamais d'exception :
 * tout échec (API absente, nom inconnu, réponse inattendue) donne 'unsupported'.
 */
export async function queryLoopbackPermission(permissions: PermissionsLike | null = currentPermissions()): Promise<LoopbackPermission> {
  if (!permissions) return 'unsupported';
  for (const name of PERMISSION_NAMES) {
    const status = await queryWithTimeout(permissions, name);
    const state = status?.state;
    if (state === 'granted' || state === 'prompt' || state === 'denied') return state;
  }
  return 'unsupported';
}
