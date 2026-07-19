export type EventType = 'order.created' | 'catalog.updated' | 'message.received' | 'test.ping';

export const VALID_EVENT_TYPES: EventType[] = ['order.created', 'catalog.updated', 'message.received', 'test.ping'];

export const RETRY_DELAYS = [30, 300, 1800]; // retry delays in seconds (30s, 5m, 30m)

export interface WebhookEndpoint {
  id: string;
  tenant_id: string;
  url: string;
  events: string[];
  signing_secret: string;
  is_active: boolean;
  consecutive_failures: number;
  created_at?: string;
  updated_at?: string;
}

export interface DeliveryLog {
  id: string;
  endpoint_id: string;
  tenant_id: string;
  event_type: string;
  payload: any;
  status: 'delivered' | 'failed' | 'permanently_failed';
  status_code?: number | null;
  response_body?: string | null;
  attempt_number: number;
  parent_delivery_id?: string | null;
  is_test: boolean;
  created_at?: string;
}

export interface WebhookPayload {
  id: string;
  event: string;
  timestamp: string;
  tenant_id: string;
  data: any;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number | null;
  responseBody?: string | null;
  error?: string | null;
}
