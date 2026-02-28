import { INTENT_PROMPT } from "../contracts/intents";
import type { Bindings } from "../types";

export async function detectIntent(env: Bindings, transcript: string): Promise<number> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${INTENT_PROMPT}\n\nUser text: ${transcript}` }] }],
      generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 4 }
    })
  });

  if (!res.ok) {
    throw new Error(`Gemini failed with status ${res.status}`);
  }

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "0";
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
