import type { Bindings } from "../types";

export async function insertPaymentEvent(db: Bindings["DB"], input: {
  eventId: string;
  dedupeKey: string;
  deviceId: string;
  amountPaise: number;
  currency: string;
  paidAt: string;
  rawPayload: string;
}) {
  return db.prepare(
    `INSERT INTO payment_events (event_id, dedupe_key, device_id, amount_paise, currency, paid_at, raw_payload)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(input.eventId, input.dedupeKey, input.deviceId, input.amountPaise, input.currency, input.paidAt, input.rawPayload).run();
}

export async function insertVoiceCommand(db: Bindings["DB"], input: {
  commandId: string;
  deviceId: string;
  transcript: string;
  intentId: number;
}) {
  return db.prepare(
    `INSERT INTO voice_commands (command_id, device_id, transcript, intent_id)
     VALUES (?1, ?2, ?3, ?4)`
  ).bind(input.commandId, input.deviceId, input.transcript, input.intentId).run();
}

export async function insertIntentExecution(db: Bindings["DB"], input: {
  commandId: string;
  intentId: number;
  resultText: string;
  latencyMs: number;
}) {
  return db.prepare(
    `INSERT INTO intent_executions (command_id, intent_id, result_text, latency_ms)
     VALUES (?1, ?2, ?3, ?4)`
  ).bind(input.commandId, input.intentId, input.resultText, input.latencyMs).run();
}

export async function getTodayTotalPaise(db: Bindings["DB"], startIso: string, endIso: string) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(amount_paise), 0) AS total
     FROM payment_events
     WHERE paid_at >= ?1 AND paid_at < ?2`
  ).bind(startIso, endIso).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function getLastPayment(db: Bindings["DB"]) {
  return db.prepare(
    `SELECT amount_paise, currency, paid_at
     FROM payment_events
     ORDER BY paid_at DESC
     LIMIT 1`
  ).first<{ amount_paise: number; currency: string; paid_at: string }>();
}

export async function getIntentExecutionByCommandId(db: Bindings["DB"], commandId: string) {
  return db.prepare(
    `SELECT result_text, intent_id
     FROM intent_executions
     WHERE command_id = ?1
     ORDER BY id DESC
     LIMIT 1`
  ).bind(commandId).first<{ result_text: string; intent_id: number }>();
}
