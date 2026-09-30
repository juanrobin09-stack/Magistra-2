// Fuseaux horaires : validation (Intl) et début de journée locale.
// Les statistiques « aujourd'hui » dépendent du fuseau de l'enseignant, pas de celui du serveur.

const TZ_PATTERN = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;

/** Renvoie le nom canonique du fuseau (ex. « Europe/Paris »), ou null s'il est inconnu. */
export function normalizeTimeZone(tz: string | null | undefined): string | null {
  if (!tz || !TZ_PATTERN.test(tz)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, tz: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Décalage (ms) entre l'heure locale du fuseau et UTC à un instant donné. */
function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

/** Instant correspondant à minuit (heure locale du fuseau) du jour contenant `now`. */
export function startOfDayInZone(now: Date, tz: string): Date {
  const p = zonedParts(now, tz);
  const localMidnight = Date.UTC(p.year, p.month - 1, p.day);
  let guess = localMidnight - offsetMs(now, tz);
  // Deux itérations suffisent à absorber un changement d'heure entre minuit et maintenant.
  for (let i = 0; i < 2; i++) {
    const next = localMidnight - offsetMs(new Date(guess), tz);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
