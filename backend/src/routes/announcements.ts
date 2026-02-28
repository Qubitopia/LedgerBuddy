import { Hono } from "hono";
import type { AppContext } from "../types";
import { synthesizeWavWithGoogle } from "../services/speech";

export const announcementsRoute = new Hono<AppContext>();

announcementsRoute.get("/:eventId/tts", async (c) => {
  const amountPaise = Number(c.req.query("amountPaise") || 0);
  const currency = c.req.query("currency") || c.env.DEFAULT_CURRENCY;

  if (!amountPaise) {
    return c.json({ error: "amountPaise query is required" }, 400);
  }

  const amount = (amountPaise / 100).toFixed(2);
  const text = `Payment received. ${amount} ${currency}.`;
  const wav = await synthesizeWavWithGoogle(c.env, text);

  return new Response(wav, {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store"
    }
  });
});
