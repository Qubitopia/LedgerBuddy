import type { Bindings } from "../types";

export async function transcribeWithDeepgram(env: Bindings, audioFile: File): Promise<string> {
  const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true", {
    method: "POST",
    headers: {
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "Content-Type": audioFile.type || "audio/wav"
    },
    body: await audioFile.arrayBuffer()
  });

  if (!res.ok) {
    throw new Error(`Deepgram failed with status ${res.status}`);
  }

  const json = await res.json() as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] }
  };

  return json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
}

export async function synthesizeWavWithGoogle(env: Bindings, text: string): Promise<ArrayBuffer> {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "en-IN", ssmlGender: "FEMALE" },
      audioConfig: { audioEncoding: "LINEAR16", speakingRate: 1.0 }
    })
  });

  if (!res.ok) {
    throw new Error(`Google TTS failed with status ${res.status}`);
  }

  const json = await res.json() as { audioContent?: string };
  if (!json.audioContent) {
    throw new Error("Google TTS did not return audio content");
  }

  const binary = atob(json.audioContent);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
