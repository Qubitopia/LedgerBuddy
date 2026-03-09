import { OpenAPIRoute } from "chanfana";
import { GoogleGenAI } from "@google/genai/web";
import { z } from "zod";

import { getMqttConfig, publishToMqtt } from "./mqttPublish";
import type { AppContext } from "../types";

type IntentDefinition = {
    id: number;
    name: string;
    description: string;
};

type DeepgramTranscriptionResponse = {
    results?: {
        channels?: Array<{
            alternatives?: Array<{
                transcript?: string;
            }>;
        }>;
    };
};

type IntentExecutionResult = {
    intentId: number;
    intentName: string;
    mqttMessage: string;
    metadata?: Record<string, unknown>;
};

const INTENTS: IntentDefinition[] = [
    {
        id: 1,
        name: "TODAY_TOTAL_SALES",
        description: "User asks for total sales amount for today",
    },
];

function formatRupeesFromPaise(amountPaise: number): string {
    const value = amountPaise / 100;
    if (Number.isInteger(value)) {
        return String(value);
    }
    return value.toFixed(2).replace(/\.00$/, "");
}

async function transcribeWithDeepgram(audioBuffer: ArrayBuffer, audioContentType: string, apiKey: string): Promise<string> {
    const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", {
        method: "POST",
        headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": audioContentType,
        },
        body: audioBuffer,
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Deepgram request failed (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as DeepgramTranscriptionResponse;
    const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!transcript) {
        throw new Error("Deepgram returned an empty transcript");
    }

    return transcript;
}

function buildIntentPrompt(transcript: string, intents: IntentDefinition[]): string {
    const intentLines = intents.map((intent) => `${intent.id}. ${intent.name}: ${intent.description}`).join("\n");
    return [
        "You are an intent classifier.",
        "From the given transcript, choose exactly one intent number from the list below.",
        "Rules:",
        "- Respond with only one integer.",
        "- If uncertain, respond with 0.",
        "- Do not add words or punctuation.",
        "Intent list:",
        intentLines,
        `Transcript: ${transcript}`,
    ].join("\n");
}

async function classifyIntentWithGemini(transcript: string, apiKey: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: buildIntentPrompt(transcript, INTENTS),
        config: {
            temperature: 0,
            maxOutputTokens: 8,
        },
    });

    const raw = (response.text ?? "").trim();
    if (!raw) {
        throw new Error("Gemini returned an empty intent response");
    }

    return raw;
}

function extractIntentNumber(rawModelResponse: string): number {
    const match = rawModelResponse.match(/\d+/);
    if (!match) {
        return 0;
    }
    const parsed = Number.parseInt(match[0], 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
}

async function handleTodayTotalSalesIntent(c: AppContext): Promise<IntentExecutionResult> {
    const row = await c.env.ledger_buddy_d1
        .prepare(
            `SELECT COALESCE(SUM(amount_paise), 0) AS total_paise
			 FROM razorpay_qr_credits
			 WHERE DATE(datetime(paid_at_unix, 'unixepoch', 'localtime')) = DATE('now', 'localtime')`,
        )
        .first<{ total_paise: number | string | null }>();

    const totalPaise = Number(row?.total_paise ?? 0);
    const normalizedTotalPaise = Number.isFinite(totalPaise) ? Math.max(0, Math.trunc(totalPaise)) : 0;
    const mqttMessage = `${formatRupeesFromPaise(normalizedTotalPaise)} is today's total sales`;

    return {
        intentId: 1,
        intentName: "TODAY_TOTAL_SALES",
        mqttMessage,
        metadata: {
            totalPaise: normalizedTotalPaise,
        },
    };
}

async function executeIntent(c: AppContext, intentId: number): Promise<IntentExecutionResult> {
    if (intentId === 1) {
        return handleTodayTotalSalesIntent(c);
    }

    return {
        intentId: 0,
        intentName: "UNSURE",
        mqttMessage: "Sorry, I am not sure what you asked.",
    };
}

export class VoiceCommand extends OpenAPIRoute {
    schema = {
        tags: ["Voice"],
        summary: "Process uploaded voice command with Deepgram and Gemini",
        request: {
            body: {
                content: {
                    "audio/wav": {
                        schema: z.any(),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Voice command processed and MQTT message published",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            transcript: z.string(),
                            modelIntentResponse: z.string(),
                            intentId: z.number(),
                            intentName: z.string(),
                            mqttMessage: z.string(),
                            metadata: z.record(z.unknown()).optional(),
                        }),
                    },
                },
            },
            "400": {
                description: "Invalid request",
            },
            "500": {
                description: "Processing failed",
            },
        },
    };

    async handle(c: AppContext) {
        const deepgramApiKey = c.env.DEEPGRAM_API_KEY;
        const geminiApiKey = c.env.GEMINI_API_KEY;
        if (!deepgramApiKey || !geminiApiKey) {
            return Response.json(
                { success: false, error: "Missing DEEPGRAM_API_KEY or GEMINI_API_KEY" },
                { status: 500 },
            );
        }

        const contentType = c.req.header("content-type")?.toLowerCase().split(";")[0]?.trim();
        if (contentType !== "audio/wav" && contentType !== "audio/x-wav") {
            return Response.json({ success: false, error: "Content-Type must be audio/wav" }, { status: 400 });
        }

        const audioBuffer = await c.req.arrayBuffer();
        if (audioBuffer.byteLength === 0) {
            return Response.json({ success: false, error: "Uploaded audio body is empty" }, { status: 400 });
        }

        try {
            const transcript = await transcribeWithDeepgram(audioBuffer, contentType, deepgramApiKey);
            const modelIntentResponse = await classifyIntentWithGemini(transcript, geminiApiKey);
            const parsedIntentId = extractIntentNumber(modelIntentResponse);
            const knownIntentId = INTENTS.some((intent) => intent.id === parsedIntentId) ? parsedIntentId : 0;
            const execution = await executeIntent(c, knownIntentId);

            const mqttConfig = getMqttConfig(c);
            await publishToMqtt(execution.mqttMessage, mqttConfig);

            return {
                success: true,
                transcript,
                modelIntentResponse,
                intentId: execution.intentId,
                intentName: execution.intentName,
                mqttMessage: execution.mqttMessage,
                metadata: execution.metadata,
            };
        } catch (error) {
            const detail = error instanceof Error ? error.message : "unknown voice command processing error";
            return Response.json({ success: false, error: detail }, { status: 500 });
        }
    }
}
