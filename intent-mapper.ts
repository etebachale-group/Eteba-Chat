// ============================================================
// Intent Mapper Module
// Maps heuristic intent classification to proxy actions per
// business type, and provides keyword sets + LLM prompt additions.
// Requirements: 4.1–7.4, 8.7, 14.1–14.5
// ============================================================

import type { BusinessType } from './connector-cache.js';

export type ProxyAction = string;

// --- Action sets per business type ---

const BUSINESS_TYPE_ACTIONS: Record<BusinessType, string[]> = {
  ecommerce:    ['search_products', 'get_product_detail', 'list_categories', 'insert_order', 'list_stores'],
  appointments: ['check_availability', 'list_services', 'book_appointment', 'cancel_appointment'],
  restaurant:   ['get_menu', 'check_item_availability', 'place_order'],
  services:     ['search', 'get_detail', 'submit_inquiry'],
  general:      ['search'],
};

// --- Keyword sets per business type (Req 14.1–14.5) ---

const KEYWORDS: Record<BusinessType, string[]> = {
  ecommerce:    ['producto', 'productos', 'precio', 'comprar', 'tienda', 'stock', 'categoría', 'pedido', 'orden', 'product', 'buy', 'shop', 'order', 'price', 'store'],
  appointments: ['disponibilidad', 'cita', 'reservar', 'cancelar', 'servicio', 'horario', 'availability', 'book', 'cancel', 'reschedule', 'appointment', 'schedule'],
  restaurant:   ['menú', 'menu', 'platillo', 'dish', 'carta', 'pedido', 'ordenar', 'disponible hoy', 'order', 'table', 'food', 'eat'],
  services:     ['servicio', 'consulta', 'detalle', 'pregunta', 'cotización', 'service', 'inquiry', 'detail', 'quote'],
  general:      ['buscar', 'información', 'search', 'info', 'help'],
};

// --- System prompt additions per business type (Req 14.4) ---

const SYSTEM_PROMPTS: Record<BusinessType, string> = {
  ecommerce:
    'You are a shopping assistant. Help users find products, check prices, place orders, and browse categories. Use the search_products action for product searches and insert_order for purchases.',
  appointments:
    'You are a scheduling assistant. Help users check availability, book appointments, list services, and cancel bookings. Always confirm dates and times with the user before booking.',
  restaurant:
    'You are a restaurant assistant. Help users browse the menu, check item availability, and place orders. Ask about dine-in, takeout, or delivery preference when placing an order.',
  services:
    'You are a services assistant. Help users discover services, get details, and submit inquiries. Collect contact information before submitting an inquiry.',
  general:
    'You are a helpful assistant. Help users search for information and answer questions.',
};

// --- Intent → action mapping ---

interface IntentMapping {
  keywords: string[];
  action: ProxyAction;
}

const INTENT_MAP: Record<BusinessType, IntentMapping[]> = {
  ecommerce: [
    { keywords: ['buscar', 'busco', 'search', 'find', 'show', 'listar productos'], action: 'search_products' },
    { keywords: ['detalle', 'detail', 'info sobre', 'cuéntame del', 'tell me about'], action: 'get_product_detail' },
    { keywords: ['categoría', 'category', 'categorías', 'categories'], action: 'list_categories' },
    { keywords: ['ordenar', 'comprar', 'pedir', 'order', 'buy', 'purchase'], action: 'insert_order' },
    { keywords: ['tienda', 'tiendas', 'store', 'stores', 'sucursal'], action: 'list_stores' },
  ],
  appointments: [
    { keywords: ['disponibilidad', 'disponible', 'available', 'availability', 'cuando', 'when'], action: 'check_availability' },
    { keywords: ['servicios', 'services', 'qué ofrecen', 'what services'], action: 'list_services' },
    { keywords: ['reservar', 'agendar', 'book', 'schedule', 'appointment'], action: 'book_appointment' },
    { keywords: ['cancelar', 'cancel', 'cancellation'], action: 'cancel_appointment' },
  ],
  restaurant: [
    { keywords: ['menú', 'menu', 'carta', 'platillos', 'dishes', 'food'], action: 'get_menu' },
    { keywords: ['disponible', 'available', 'hay', 'tienen'], action: 'check_item_availability' },
    { keywords: ['ordenar', 'pedir', 'order', 'quiero', 'want'], action: 'place_order' },
  ],
  services: [
    { keywords: ['buscar', 'busco', 'search', 'find'], action: 'search' },
    { keywords: ['detalle', 'detail', 'más info', 'more info'], action: 'get_detail' },
    { keywords: ['consulta', 'inquiry', 'contactar', 'pregunta', 'cotizar'], action: 'submit_inquiry' },
  ],
  general: [
    { keywords: ['buscar', 'search', 'help', 'ayuda'], action: 'search' },
  ],
};

/**
 * Maps an intent type/query to a proxy action and params for a given business type.
 * Falls back to the first action in the type's set if no keyword matches.
 */
export function mapIntentToAction(
  intentType: string,
  businessType: BusinessType,
  query: string,
): { action: ProxyAction; params: Record<string, unknown> } {
  const mappings = INTENT_MAP[businessType] ?? INTENT_MAP.general;
  const lowerQuery = query.toLowerCase();
  const lowerIntent = intentType.toLowerCase();

  for (const mapping of mappings) {
    if (mapping.keywords.some(kw => lowerQuery.includes(kw) || lowerIntent.includes(kw))) {
      return { action: mapping.action, params: buildDefaultParams(mapping.action, query) };
    }
  }

  // Fallback: first action for this business type
  const fallback = BUSINESS_TYPE_ACTIONS[businessType][0] ?? 'search';
  return { action: fallback, params: buildDefaultParams(fallback, query) };
}

/** Builds sensible default params for a given action. */
function buildDefaultParams(action: ProxyAction, query: string): Record<string, unknown> {
  switch (action) {
    case 'search_products':
    case 'search':
      return { term: query, limit: 10 };
    case 'get_product_detail':
    case 'get_detail':
      return { id: query };
    case 'check_availability':
      return { date: new Date().toISOString().split('T')[0] };
    case 'get_menu':
      return {};
    default:
      return {};
  }
}

/**
 * Returns the keyword set for intent classification for a given business type.
 * Requirements: 14.1–14.3, 14.5
 */
export function getBusinessTypeKeywords(businessType: BusinessType): string[] {
  return KEYWORDS[businessType] ?? KEYWORDS.general;
}

/**
 * Returns the LLM system prompt additions for a given business type.
 * Requirement: 14.4
 */
export function getSystemPromptInstructions(businessType: BusinessType): string {
  return SYSTEM_PROMPTS[businessType] ?? SYSTEM_PROMPTS.general;
}

/**
 * Returns the valid action set for a given business type.
 */
export function getActionsForBusinessType(businessType: BusinessType): string[] {
  return BUSINESS_TYPE_ACTIONS[businessType] ?? [];
}
