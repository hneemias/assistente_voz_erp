export const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * Retorna a data no formato ISO YYYY-MM-DD considerando o fuso horário de Brasília (America/Sao_Paulo).
 */
export function getIsoDateSaoPaulo(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Retorna a data no formato brasileiro DD/MM/AAAA considerando o fuso horário de Brasília.
 */
export function formatDateSaoPaulo(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Retorna a hora no formato HH:mm considerando o fuso horário de Brasília.
 */
export function formatTimeSaoPaulo(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
}

/**
 * Retorna a hora atual como número inteiro (0 a 23) em Brasília.
 */
export function getHourSaoPaulo(date: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    hour: '2-digit',
    hour12: false,
  });
  return parseInt(formatter.format(date), 10);
}

/**
 * Retorna a saudação apropriada ("Bom dia", "Boa tarde", "Boa noite") para o horário atual de Brasília.
 */
export function getGreetingSaoPaulo(date: Date = new Date()): string {
  const hour = getHourSaoPaulo(date);
  if (hour >= 5 && hour < 12) {
    return 'Bom dia';
  }
  if (hour >= 12 && hour < 18) {
    return 'Boa tarde';
  }
  return 'Boa noite';
}

/**
 * Retorna uma data relativa no formato YYYY-MM-DD (ex: daysOffset = -1 para ontem, 0 para hoje).
 */
export function getRelativeIsoDateSaoPaulo(daysOffset = 0, refDate: Date = new Date()): string {
  const todayIso = getIsoDateSaoPaulo(refDate);
  const [year, month, day] = todayIso.split('-').map(Number);
  const d = new Date(Date.UTC(year!, month! - 1, day! + daysOffset, 12, 0, 0));
  return getIsoDateSaoPaulo(d);
}

/**
 * Normaliza filtros de data textuais como "hoje", "ontem", "DD/MM/AAAA" para o formato ISO YYYY-MM-DD.
 */
export function parseDateFilterToIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim().toLowerCase();
  if (s === 'hoje' || s === 'data de hoje') {
    return getIsoDateSaoPaulo();
  }
  if (s === 'ontem') {
    return getRelativeIsoDateSaoPaulo(-1);
  }
  if (s === 'anteontem') {
    return getRelativeIsoDateSaoPaulo(-2);
  }

  const clean = s.replace(/[\/\.]/g, '-');
  const parts = clean.split('-');
  if (parts.length === 3) {
    if (parts[0]!.length === 4) {
      // YYYY-MM-DD
      return `${parts[0]}-${parts[1]!.padStart(2, '0')}-${parts[2]!.padStart(2, '0')}`;
    } else {
      // DD-MM-YYYY
      return `${parts[2]}-${parts[1]!.padStart(2, '0')}-${parts[0]!.padStart(2, '0')}`;
    }
  }
  if (parts.length === 2) {
    // DD-MM (assume ano corrente em SP)
    const currentYear = getIsoDateSaoPaulo().slice(0, 4);
    return `${currentYear}-${parts[1]!.padStart(2, '0')}-${parts[0]!.padStart(2, '0')}`;
  }
  return null;
}
