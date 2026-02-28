import { Hono } from "hono";
import type { AppContext } from "../types";
import { deviceAuth } from "../middleware/device-auth";
import { detectIntent } from "../services/intent";
import { executeIntent } from "../services/intent-dispatcher";
import { getIntentExecutionByCommandId, insertIntentExecution, insertVoiceCommand } from "../db/queries";
import { synthesizeWavWithGoogle, transcribeWithDeepgram } from "../services/speech";

export const voiceRoute = new Hono<AppContext>();

voiceRoute.use("/*", deviceAuth);

voiceRoute.post("/commands", async (c) => {
  const startTs = Date.now();
  const contentType = c.req.header("content-type") || "";
  let file: File | undefined;
  let deviceId = c.req.header("x-device-id") || "default-device";

  if (contentType.includes("multipart/form-data")) {
    const body = await c.req.parseBody({ all: true });
    file = body.audio as File | undefined;
    deviceId = String(body.deviceId || deviceId);
  } else if (contentType.startsWith("audio/")) {
    const arr = await c.req.arrayBuffer();
    file = new File([arr], "command.wav", { type: contentType });
  }

  if (!file) {
    return c.json({ error: "audio file is required" }, 400);
  }

  const commandId = crypto.randomUUID();
  const transcript = await transcribeWithDeepgram(c.env, file);
  const intentId = await detectIntent(c.env, transcript);
  const responseText = await executeIntent(c.env, intentId);

  await insertVoiceCommand(c.env.DB, { commandId, deviceId, transcript, intentId });
  await insertIntentExecution(c.env.DB, {
    commandId,
    intentId,
    resultText: responseText,
    latencyMs: Date.now() - startTs
  });

  const origin = new URL(c.req.url).origin;
  const ttsUrl = `${origin}/voice/commands/${commandId}/tts`;

  return c.json({ commandId, transcript, intentId, responseText, ttsUrl }, 200);
});

voiceRoute.get("/commands/:commandId/tts", async (c) => {
  const commandId = c.req.param("commandId");
  const row = await getIntentExecutionByCommandId(c.env.DB, commandId);

  if (!row) {
    return c.json({ error: "Command not found" }, 404);
  }

  const wav = await synthesizeWavWithGoogle(c.env, row.result_text);
  return new Response(wav, {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store"
    }
  });
});
