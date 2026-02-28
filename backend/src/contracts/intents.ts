export const INTENTS = {
  UNKNOWN: 0,
  TODAY_TOTAL_SALES: 1,
  LAST_PAYMENT: 2
} as const;

export const INTENT_PROMPT = `You are an intent classifier. Return only one integer from this list:\n0 = unknown or unclear\n1 = today's total sales\n2 = last payment amount\nIf command is unclear, return 0.`;
