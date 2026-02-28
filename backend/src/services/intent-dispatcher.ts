import { INTENTS } from "../contracts/intents";
import { getLastPayment, getTodayTotalPaise } from "../db/queries";
import type { Bindings } from "../types";

function getTodayRangeInIST() {
  const now = new Date();
  const dateInIst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const start = new Date(dateInIst);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const startUtc = new Date(start.getTime() - (5.5 * 60 * 60 * 1000)).toISOString();
  const endUtc = new Date(end.getTime() - (5.5 * 60 * 60 * 1000)).toISOString();
  return { startUtc, endUtc };
}

export async function executeIntent(env: Bindings, intentId: number): Promise<string> {
  if (intentId === INTENTS.TODAY_TOTAL_SALES) {
    const { startUtc, endUtc } = getTodayRangeInIST();
    const totalPaise = await getTodayTotalPaise(env.DB, startUtc, endUtc);
    return `Today's total is ${(totalPaise / 100).toFixed(2)} rupees.`;
  }

  if (intentId === INTENTS.LAST_PAYMENT) {
    const row = await getLastPayment(env.DB);
    if (!row) {
      return "No payments found yet.";
    }
    return `Last payment was ${(row.amount_paise / 100).toFixed(2)} ${row.currency}.`;
  }

  return "Sorry, I did not understand the command.";
}
