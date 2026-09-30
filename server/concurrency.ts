// Générations en cours sur CETTE instance du serveur (mémoire du processus).
//
//  - plafond global (MAX_CONCURRENT_GENERATIONS) : protège le serveur d'IA d'un afflux de demandes
//    simultanées, tous utilisateurs confondus ;
//  - plafond par utilisateur (MAX_CONCURRENT_GENERATIONS_PER_USER) appliqué localement en plus du
//    compteur partagé de la base : il reste effectif si ce compteur est momentanément indisponible.
//
// Chaque place est libérée à la fin du flux ; une place jamais libérée (anomalie) cesse de compter
// après `ttlMs`, comme dans la base.

export interface InstanceLimits {
  /** Générations simultanées sur l'instance (0 = pas de limite). */
  max: number;
  /** Générations simultanées d'un même utilisateur sur l'instance (0 = pas de limite). */
  maxPerUser: number;
  /** Au-delà, une place non libérée ne compte plus (millisecondes). */
  ttlMs: number;
}

export type InstanceAdmission =
  | { ok: true; release: () => void }
  | { ok: false; reason: 'busy' | 'saturated' };

interface Slot {
  userId: string;
  startedAt: number;
}

export class InstanceGenerations {
  private readonly slots = new Map<symbol, Slot>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  /** Nombre de générations en cours (d'un utilisateur, ou de tous), places expirées exclues. */
  count(userId?: string, ttlMs = Number.POSITIVE_INFINITY): number {
    const oldest = this.now() - ttlMs;
    let n = 0;
    for (const slot of this.slots.values()) {
      if (slot.startedAt >= oldest && (userId === undefined || slot.userId === userId)) n++;
    }
    return n;
  }

  /**
   * Réserve une place : refus « busy » si l'utilisateur a déjà `maxPerUser` générations en cours ici,
   * « saturated » si l'instance en a déjà `max`. Synchrone, donc atomique au sein du processus.
   */
  acquire(userId: string, limits: InstanceLimits): InstanceAdmission {
    const now = this.now();
    for (const [key, slot] of this.slots) {
      if (slot.startedAt < now - limits.ttlMs) this.slots.delete(key);
    }
    if (limits.maxPerUser > 0 && this.count(userId) >= limits.maxPerUser) return { ok: false, reason: 'busy' };
    if (limits.max > 0 && this.slots.size >= limits.max) return { ok: false, reason: 'saturated' };
    const key = Symbol('generation');
    this.slots.set(key, { userId, startedAt: now });
    return { ok: true, release: () => void this.slots.delete(key) };
  }
}
