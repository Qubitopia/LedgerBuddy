#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PubSubClient.h>

#include "AudioTools.h"
#include "AudioTools/AudioCodecs/CodecMP3Helix.h"
#include "AudioTools/Communication/AudioHttp.h"

#include "SD.h"
#include "SPI.h"

// ================= WIFI =================
const char *ssid = "Air";
const char *password = "1q2w3e4r";

// ================= MQTT =================
const char *mqtt_server = "46aa9262c317422fb10db9aeefd3a4c9.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char *mqtt_user = "YOUR_USERNAME";
const char *mqtt_pass = "Aa1Aa1Aa1Aa1";
const char *topic = "esp32/test";

WiFiClientSecure espClient;
PubSubClient client(espClient);

// ================= AUDIO (FIXED) =================
I2SStream i2sMic;
I2SStream i2sSpeaker;

MP3DecoderHelix mp3;
EncodedAudioStream decoder(&i2sSpeaker, &mp3);
URLStream url;
StreamCopy copier(decoder, url);

// ================= HARDWARE =================
const int BUTTON_PIN = 4;
const int SPEAKER_SHUTDOWN = 16;
const int SD_CS = 5;

// ================= FILE =================
const char *filename = "/recording.wav";

// ================= WAV =================
const int SAMPLE_RATE = 24000;
const int BITS_PER_SAMPLE = 16;
const int CHANNELS = 1;

File audioFile;
uint32_t data_size = 0;

// ================= MODE =================
enum Mode {
  MODE_IDLE,
  MODE_RECORD,
  MODE_PLAY
};
Mode currentMode = MODE_IDLE;

// ================= TTS =================
Str query("http://translate.google.com/translate_tts?ie=UTF-8&tl=%1&client=tw-ob&q=%2");

String createTTSUrl(String text) {
  Str q = query;
  q.replace("%1", "en");

  Str encoded(text.c_str());
  encoded.urlEncode();
  q.replace("%2", encoded.c_str());

  return String(q.c_str());
}

// ================= WAV HEADER =================
void writeWavHeader(File file, uint32_t dataSize) {
  file.seek(0);

  uint32_t byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8;
  uint16_t blockAlign = CHANNELS * BITS_PER_SAMPLE / 8;

  file.write((const uint8_t *)"RIFF", 4);
  uint32_t chunkSize = 36 + dataSize;
  file.write((uint8_t *)&chunkSize, 4);

  file.write((const uint8_t *)"WAVE", 4);
  file.write((const uint8_t *)"fmt ", 4);

  uint32_t subChunk1Size = 16;
  uint16_t audioFormat = 1;

  file.write((uint8_t *)&subChunk1Size, 4);
  file.write((uint8_t *)&audioFormat, 2);
  file.write((uint8_t *)&CHANNELS, 2);
  file.write((uint8_t *)&SAMPLE_RATE, 4);
  file.write((uint8_t *)&byteRate, 4);
  file.write((uint8_t *)&blockAlign, 2);
  file.write((uint8_t *)&BITS_PER_SAMPLE, 2);

  file.write((const uint8_t *)"data", 4);
  file.write((uint8_t *)&dataSize, 4);
}

// ================= I2S SETUP (NEW) =================
void setupMic() {
  auto config = i2sMic.defaultConfig(RX_MODE);
  config.port_no = 0;
  config.i2s_format = I2S_STD_FORMAT;
  config.sample_rate = SAMPLE_RATE;
  config.channels = CHANNELS;
  config.bits_per_sample = BITS_PER_SAMPLE;

  config.pin_bck = 27;
  config.pin_ws = 14;
  config.pin_data = 32;

  i2sMic.begin(config);
}

void setupSpeaker() {
  auto config = i2sSpeaker.defaultConfig(TX_MODE);
  config.port_no = 1;
  config.i2s_format = I2S_STD_FORMAT;
  config.sample_rate = 24000;
  config.channels = 1;
  config.bits_per_sample = 16;

  config.pin_bck = 25;
  config.pin_ws = 26;
  config.pin_data = 33;

  i2sSpeaker.begin(config);
  decoder.begin();

  digitalWrite(SPEAKER_SHUTDOWN, HIGH);
}

// ================= SD =================
bool initSD() {
  if (!SD.begin(SD_CS)) {
    Serial.println("SD Card failed!");
    return false;
  }
  Serial.println("SD Card initialized");
  return true;
}

File createWavFile() {
  File file = SD.open(filename, FILE_WRITE);
  if (!file) return File();

  for (int i = 0; i < 44; i++) file.write((uint8_t)0);
  return file;
}

// ================= WIFI =================
void setup_wifi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nConnected!");
}

// ================= MQTT =================
void reconnect() {
  while (!client.connected()) {
    Serial.print("MQTT connecting...");

    if (client.connect("ESP32Client", mqtt_user, mqtt_pass, NULL, 0, false, NULL, false)) {
      Serial.println("connected");
      client.subscribe(topic, 1);
    } else {
      Serial.println("failed");
      delay(3000);
    }
  }
}

// ================= RECORD =================
void recordAndUpload() {
  currentMode = MODE_RECORD;

  audioFile = createWavFile();
  if (!audioFile) return;

  Serial.println("audio file pass!");

  data_size = 0;

  uint8_t buffer[1024];
  float gain = 8.0;

  Serial.println("Recording...");

  while (digitalRead(BUTTON_PIN) == LOW) {
    int bytesRead = i2sMic.readBytes(buffer, sizeof(buffer));
    Serial.print(".");

    if (bytesRead > 0) {
      int16_t *samples = (int16_t *)buffer;
      int sampleCount = bytesRead / 2;

      for (int i = 0; i < sampleCount; i++) {
        int32_t amplified = samples[i] * gain;

        if (amplified > 32767) amplified = 32767;
        if (amplified < -32768) amplified = -32768;

        samples[i] = amplified;
      }

      int totalWritten = 0;
      while (totalWritten < bytesRead) {
        int written = audioFile.write(buffer + totalWritten, bytesRead - totalWritten);
        if (written <= 0) break;
        totalWritten += written;
      }

      data_size += totalWritten;
    }
  }


  writeWavHeader(audioFile, data_size);
  audioFile.close();

  File file = SD.open(filename);
  if (!file) {
    Serial.println("Failed to open file for upload");
    return;
  }

  client.disconnect();

  HTTPClient http;
  http.begin("https://ledger-buddy-api.chetan-ingale.workers.dev/api/voice/command");

  http.addHeader("Content-Type", "audio/wav");
  http.addHeader("accept", "application/json");

  Serial.println("Uploading...");

  int httpResponseCode = http.sendRequest("POST", &file, file.size());

  Serial.print("Response code: ");
  Serial.println(httpResponseCode);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.println("Response:");
    Serial.println(response);
  } else {
    Serial.println("Upload failed");
    Serial.print("Error: ");
    Serial.println(http.errorToString(httpResponseCode));
  }

  http.end();
  file.close();

  currentMode = MODE_IDLE;
}

// ================= MQTT CALLBACK =================
void callback(char *topic, byte *payload, unsigned int length) {
  String message;

  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  handleTTSMessage(message);
}

void handleTTSMessage(String message) {
  Serial.println("TTS: " + message);

  currentMode = MODE_PLAY;

  url.end();
  decoder.end();
  decoder.begin();

  digitalWrite(SPEAKER_SHUTDOWN, HIGH);

  String url_tts = createTTSUrl(message);
  url.begin(url_tts.c_str(), "audio/mp3");
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(SPEAKER_SHUTDOWN, OUTPUT);
  digitalWrite(SPEAKER_SHUTDOWN, LOW);

  initSD();
  setup_wifi();

  setupMic();
  setupSpeaker();

  espClient.setInsecure();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

// ================= LOOP =================
void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  // 🎤 RECORD
  if (digitalRead(BUTTON_PIN) == LOW && currentMode != MODE_RECORD) {
    recordAndUpload();
  }

  // 🔊 PLAY
  if (currentMode == MODE_PLAY) {
    if (!copier.copy()) {
      Serial.println("Done speaking");
      digitalWrite(SPEAKER_SHUTDOWN, LOW);
      currentMode = MODE_IDLE;
    }
  }
}