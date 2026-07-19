import { VALID_EVENT_TYPES } from './webhook-types.js';

/**
 * Validates a webhook URL.
 * URL must be valid, start with https://, and be <= 2048 characters.
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url) {
    return { valid: false, error: 'La URL es obligatoria' };
  }

  if (url.length > 2048) {
    return { valid: false, error: 'La URL no puede superar los 2048 caracteres' };
  }

  if (!url.toLowerCase().startsWith('https://')) {
    return { valid: false, error: 'La URL debe comenzar con https:// (HTTPS obligatorio)' };
  }

  try {
    new URL(url);
  } catch (err) {
    return { valid: false, error: 'La URL provista no tiene un formato válido' };
  }

  return { valid: true };
}

/**
 * Validates that event types are selected and all selected events are valid.
 */
export function validateEventTypes(events: string[]): { valid: boolean; error?: string } {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return { valid: false, error: 'Debes seleccionar al menos un tipo de evento' };
  }

  for (const event of events) {
    if (!VALID_EVENT_TYPES.includes(event as any)) {
      return { valid: false, error: `El tipo de evento "${event}" no es válido` };
    }
  }

  return { valid: true };
}

/**
 * Truncates a string body to a maximum length (default 1024) and appends a truncation indicator if needed.
 */
export function truncateBody(body: string, maxLen: number = 1024): string {
  if (!body) return '';
  if (body.length <= maxLen) return body;
  const indicator = '... [TRUNCATED]';
  const cutoff = maxLen - indicator.length;
  return body.substring(0, Math.max(0, cutoff)) + indicator;
}
