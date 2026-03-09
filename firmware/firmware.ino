/**
 * ESP32 LedgerBuddy Voice Assistant
 * 1) Receives MQTT text and speaks via Google TTS
 * 2) Records microphone audio to WAV while button is held
 * 3) Uploads WAV to Hono API on button release
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <SD.h>

#include "AudioTools.h"
#include "AudioTools/AudioCodecs/CodecMP3Helix.h"
#include "AudioTools/Communication/AudioHttp.h"

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

// ================= WIFI =================
const char* ssid = "Air";
const char* wifi_password = "1q2w3e4r";

// ================= MQTT =================
const char* mqtt_server = "46aa9262c317422fb10db9aeefd3a4c9.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "YOUR_USERNAME";
const char* mqtt_pass = "Aa1Aa1Aa1Aa1";
const char* topic = "esp32/test";

// ================= VOICE API =================
const char* voice_command_url = "https://ledger-buddy-api.chetan-ingale.workers.dev/api/voice/command";

// ================= SD + BUTTON =================
const int SD_CS_PIN = 5;
const int BUTTON_PIN = 4;  // Active LOW with INPUT_PULLUP
const char* VOICE_FILE_PATH = "/voice_cmd.wav";

// ================= I2S PINS =================
// Speaker (MAX98357A)
const int SPK_BCK_PIN = 26;
const int SPK_WS_PIN = 25;
const int SPK_DATA_PIN = 22;

// Microphone (INMP441)
const int MIC_BCK_PIN = 14;
const int MIC_WS_PIN = 15;
const int MIC_DATA_PIN = 32;

const uint32_t RECORD_SAMPLE_RATE = 16000;
const uint16_t RECORD_BITS_PER_SAMPLE = 16;
const uint16_t RECORD_CHANNELS = 1;

WiFiClientSecure espClient;
PubSubClient client(espClient);

// ================= AUDIO =================
I2SStream i2sOut;
I2SStream i2sIn;
MP3DecoderHelix mp3;
EncodedAudioStream decoder(&i2sOut, &mp3);
URLStream url;
StreamCopy copier(decoder, url);

Str query("http://translate.google.com/translate_tts?ie=UTF-8&tl=%1&client=tw-ob&ttsspeed=1&q=%2");

// ================= STATUS / QUEUE =================
enum LedStage {
  LED_WIFI_CONNECTING,
  LED_MQTT_CONNECTING,
  LED_IDLE,
  LED_PLAYING,
  LED_RECORDING,
  LED_UPLOADING
};

const int MESSAGE_QUEUE_SIZE = 10;
String messageQueue[MESSAGE_QUEUE_SIZE];
int queueHead = 0;
int queueTail = 0;
int queueCount = 0;

LedStage ledStage = LED_IDLE;
bool isPlaying = false;
unsigned long lastAudioDataMs = 0;
const unsigned long PLAYBACK_IDLE_TIMEOUT_MS = 1200;

bool isRecording = false;
bool buttonPreviouslyPressed = false;
File recordingFile;
uint32_t recordedBytes = 0;

void setLedStage(LedStage stage) {
  ledStage = stage;
}

void updateLedPattern() {
  static unsigned long lastToggleMs = 0;
  static bool ledOn = false;
  unsigned long now = millis();

  if (ledStage == LED_IDLE) {
    digitalWrite(LED_BUILTIN, LOW);
    ledOn = false;
    return;
  }

  if (ledStage == LED_PLAYING) {
    digitalWrite(LED_BUILTIN, HIGH);
    ledOn = true;
    return;
  }

  if (ledStage == LED_RECORDING) {
    unsigned long pulseMs = 90;
    if (now - lastToggleMs >= pulseMs) {
      lastToggleMs = now;
      ledOn = !ledOn;
      digitalWrite(LED_BUILTIN, ledOn ? HIGH : LOW);
    }
    return;
  }

  if (ledStage == LED_UPLOADING) {
    unsigned long pulseMs = 50;
    if (now - lastToggleMs >= pulseMs) {
      lastToggleMs = now;
      ledOn = !ledOn;
      digitalWrite(LED_BUILTIN, ledOn ? HIGH : LOW);
    }
    return;
  }

  unsigned long blinkMs = (ledStage == LED_WIFI_CONNECTING) ? 500 : 150;
  if (now - lastToggleMs >= blinkMs) {
    lastToggleMs = now;
    ledOn = !ledOn;
    digitalWrite(LED_BUILTIN, ledOn ? HIGH : LOW);
  }
}

bool enqueueMessage(const String& message) {
  if (queueCount >= MESSAGE_QUEUE_SIZE) {
    return false;
  }

  messageQueue[queueTail] = message;
  queueTail = (queueTail + 1) % MESSAGE_QUEUE_SIZE;
  queueCount++;
  return true;
}

bool dequeueMessage(String& message) {
  if (queueCount == 0) {
    return false;
  }

  message = messageQueue[queueHead];
  queueHead = (queueHead + 1) % MESSAGE_QUEUE_SIZE;
  queueCount--;
  return true;
}

void writeWavHeader(File& file, uint32_t dataSize) {
  uint32_t byteRate = RECORD_SAMPLE_RATE * RECORD_CHANNELS * (RECORD_BITS_PER_SAMPLE / 8);
  uint16_t blockAlign = RECORD_CHANNELS * (RECORD_BITS_PER_SAMPLE / 8);
  uint32_t riffChunkSize = dataSize + 36;

  file.seek(0);
  file.write((const uint8_t*)"RIFF", 4);
  file.write((uint8_t*)&riffChunkSize, 4);
  file.write((const uint8_t*)"WAVE", 4);

  file.write((const uint8_t*)"fmt ", 4);
  uint32_t fmtChunkSize = 16;
  uint16_t audioFormat = 1;
  file.write((uint8_t*)&fmtChunkSize, 4);
  file.write((uint8_t*)&audioFormat, 2);
  file.write((uint8_t*)&RECORD_CHANNELS, 2);
  file.write((uint8_t*)&RECORD_SAMPLE_RATE, 4);
  file.write((uint8_t*)&byteRate, 4);
  file.write((uint8_t*)&blockAlign, 2);
  file.write((uint8_t*)&RECORD_BITS_PER_SAMPLE, 2);

  file.write((const uint8_t*)"data", 4);
  file.write((uint8_t*)&dataSize, 4);
}

int extractFirstNumber(const String& text) {
  int start = -1;
  for (size_t i = 0; i < text.length(); i++) {
    if (isDigit(text[i])) {
      start = (int)i;
      break;
    }
  }

  if (start < 0) {
    return 0;
  }

  int end = start;
  while (end < (int)text.length() && isDigit(text[end])) {
    end++;
  }

  String num = text.substring(start, end);
  return num.toInt();
}

int extractIntentIdFromJson(const String& payload) {
  int keyPos = payload.indexOf("\"intentId\"");
  if (keyPos < 0) {
    return extractFirstNumber(payload);
  }

  int colonPos = payload.indexOf(':', keyPos);
  if (colonPos < 0) {
    return 0;
  }

  int scanPos = colonPos + 1;
  while (scanPos < (int)payload.length() && !isDigit(payload[scanPos])) {
    scanPos++;
  }

  if (scanPos >= (int)payload.length()) {
    return 0;
  }

  int end = scanPos;
  while (end < (int)payload.length() && isDigit(payload[end])) {
    end++;
  }

  return payload.substring(scanPos, end).toInt();
}

bool beginRecordingToSd() {
  if (SD.exists(VOICE_FILE_PATH)) {
    SD.remove(VOICE_FILE_PATH);
  }

  recordingFile = SD.open(VOICE_FILE_PATH, FILE_WRITE);
  if (!recordingFile) {
    Serial.println("Failed to open WAV file for write");
    return false;
  }

  recordedBytes = 0;
  writeWavHeader(recordingFile, 0);
  isRecording = true;
  setLedStage(LED_RECORDING);
  Serial.println("Recording started");
  return true;
}

void captureRecordingChunk() {
  if (!isRecording || !recordingFile) {
    return;
  }

  static uint8_t micBuffer[1024];
  size_t bytesRead = i2sIn.readBytes(micBuffer, sizeof(micBuffer));
  if (bytesRead > 0) {
    recordingFile.write(micBuffer, bytesRead);
    recordedBytes += bytesRead;
  }
}

bool stopRecordingAndFinalize() {
  if (!isRecording) {
    return false;
  }

  isRecording = false;

  if (!recordingFile) {
    Serial.println("Recording file handle invalid");
    return false;
  }

  writeWavHeader(recordingFile, recordedBytes);
  recordingFile.flush();
  recordingFile.close();

  bool exists = SD.exists(VOICE_FILE_PATH);
  if (!exists) {
    Serial.println("WAV file missing after recording");
    return false;
  }

  File verifyFile = SD.open(VOICE_FILE_PATH, FILE_READ);
  if (!verifyFile) {
    Serial.println("WAV file exists but failed to open for verification");
    return false;
  }

  size_t finalSize = verifyFile.size();
  verifyFile.close();

  Serial.print("Recording complete. File bytes: ");
  Serial.println((unsigned long)finalSize);

  if (finalSize <= 44) {
    Serial.println("WAV file too small, skipping upload");
    return false;
  }

  return true;
}

void handleIntentByNumber(int intentId) {
  switch (intentId) {
    case 1:
      Serial.println("Intent 1 detected: TODAY_TOTAL_SALES");
      break;
    default:
      Serial.println("Intent unsure or unhandled");
      break;
  }
}

bool uploadWavToVoiceApi() {
  File audioFile = SD.open(VOICE_FILE_PATH, FILE_READ);
  if (!audioFile) {
    Serial.println("Failed to open WAV file for upload");
    return false;
  }

  size_t fileSize = audioFile.size();
  Serial.print("Uploading WAV bytes: ");
  Serial.println((unsigned long)fileSize);

  WiFiClientSecure httpsClient;
  httpsClient.setInsecure();

  HTTPClient http;
  if (!http.begin(httpsClient, voice_command_url)) {
    Serial.println("HTTP begin failed");
    audioFile.close();
    return false;
  }

  http.addHeader("Content-Type", "audio/wav");
  setLedStage(LED_UPLOADING);

  int status = http.sendRequest("POST", &audioFile, fileSize);
  audioFile.close();

  String body = http.getString();
  http.end();

  Serial.print("Voice API status: ");
  Serial.println(status);
  Serial.print("Voice API body: ");
  Serial.println(body);

  if (status < 200 || status >= 300) {
    setLedStage(LED_IDLE);
    return false;
  }

  int intentId = extractIntentIdFromJson(body);
  Serial.print("Extracted intentId: ");
  Serial.println(intentId);

  // Regex-like number extraction on device for safety/fallback parsing.
  int firstNumber = extractFirstNumber(body);
  Serial.print("First number extracted from response: ");
  Serial.println(firstNumber);

  handleIntentByNumber(intentId);
  setLedStage(LED_IDLE);
  return true;
}

void handleVoiceButton() {
  bool buttonPressed = digitalRead(BUTTON_PIN) == LOW;

  if (buttonPressed && !buttonPreviouslyPressed && !isRecording) {
    if (isPlaying) {
      url.end();
      isPlaying = false;
    }
    beginRecordingToSd();
  }

  if (buttonPressed && isRecording) {
    captureRecordingChunk();
  }

  if (!buttonPressed && buttonPreviouslyPressed && isRecording) {
    bool validFile = stopRecordingAndFinalize();
    if (validFile) {
      uploadWavToVoiceApi();
    } else {
      setLedStage(LED_IDLE);
    }
  }

  buttonPreviouslyPressed = buttonPressed;
}

// ================= TTS FUNCTION =================
String createTTSUrl(String text) {
  Str q = query;
  q.replace("%1", "en");

  Str encoded(text.c_str());
  encoded.urlEncode();
  q.replace("%2", encoded.c_str());

  return String(q.c_str());
}

// ================= MQTT CALLBACK =================
void callback(char* topic, byte* payload, unsigned int length) {
  (void)topic;
  Serial.println("Message received!");

  String message = "";
  message.reserve(length);
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  message.trim();
  if (message.length() == 0) {
    Serial.println("Ignored empty message");
    return;
  }

  Serial.print("Text: ");
  Serial.println(message);

  if (!enqueueMessage(message)) {
    Serial.println("Queue full, dropping message");
    return;
  }

  Serial.print("Queued. Pending messages: ");
  Serial.println(queueCount);
}

// ================= WIFI =================
void setup_wifi() {
  delay(10);
  Serial.println("Connecting to WiFi...");
  setLedStage(LED_WIFI_CONNECTING);
  WiFi.begin(ssid, wifi_password);

  unsigned long lastDotMs = 0;
  while (WiFi.status() != WL_CONNECTED) {
    updateLedPattern();
    if (millis() - lastDotMs >= 500) {
      lastDotMs = millis();
      Serial.print(".");
    }
    delay(20);
  }

  Serial.println("\nWiFi connected");
  setLedStage(LED_IDLE);
}

// ================= MQTT RECONNECT =================
void reconnect() {
  setLedStage(LED_MQTT_CONNECTING);

  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");

    if (client.connect("ESP32Client", mqtt_user, mqtt_pass)) {
      Serial.println("connected");
      client.subscribe(topic);
      setLedStage(isPlaying ? LED_PLAYING : LED_IDLE);
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" retrying in 5 seconds");

      unsigned long waitStart = millis();
      while (millis() - waitStart < 5000) {
        updateLedPattern();
        delay(20);
      }
    }
  }
}

void startNextMessageIfIdle() {
  if (isPlaying) {
    return;
  }

  String nextMessage;
  if (!dequeueMessage(nextMessage)) {
    setLedStage(LED_IDLE);
    return;
  }

  String ttsUrl = createTTSUrl(nextMessage);
  Serial.print("Now speaking: ");
  Serial.println(nextMessage);
  Serial.println(ttsUrl);

  url.end();
  if (url.begin(ttsUrl.c_str(), "audio/mp3")) {
    isPlaying = true;
    lastAudioDataMs = millis();
    setLedStage(LED_PLAYING);
  } else {
    Serial.println("Failed to start TTS stream");
    setLedStage(LED_IDLE);
  }
}

void processPlayback() {
  if (!isPlaying || isRecording) {
    return;
  }

  size_t copied = copier.copy();
  if (copied > 0) {
    lastAudioDataMs = millis();
    return;
  }

  if (millis() - lastAudioDataMs >= PLAYBACK_IDLE_TIMEOUT_MS) {
    url.end();
    isPlaying = false;
    setLedStage(LED_IDLE);
    Serial.println("Playback complete");
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  AudioToolsLogger.begin(Serial, AudioToolsLogLevel::Info);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  setup_wifi();

  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("SD init failed");
  } else {
    Serial.println("SD init success");
  }

  espClient.setInsecure();  // For HiveMQ TLS (simplest way)
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);

  // I2S speaker output
  auto outConfig = i2sOut.defaultConfig(TX_MODE);
  outConfig.sample_rate = 44100;
  outConfig.bits_per_sample = 16;
  outConfig.channels = 2;
  outConfig.pin_bck = SPK_BCK_PIN;
  outConfig.pin_ws = SPK_WS_PIN;
  outConfig.pin_data = SPK_DATA_PIN;
  i2sOut.begin(outConfig);

  // I2S microphone input for WAV recording
  auto inConfig = i2sIn.defaultConfig(RX_MODE);
  inConfig.sample_rate = RECORD_SAMPLE_RATE;
  inConfig.bits_per_sample = RECORD_BITS_PER_SAMPLE;
  inConfig.channels = RECORD_CHANNELS;
  inConfig.pin_bck = MIC_BCK_PIN;
  inConfig.pin_ws = MIC_WS_PIN;
  inConfig.pin_data = MIC_DATA_PIN;
  i2sIn.begin(inConfig);

  decoder.begin();
}

// ================= LOOP =================
void loop() {
  if (!client.connected()) {
    reconnect();
  }

  client.loop();
  handleVoiceButton();
  processPlayback();
  startNextMessageIfIdle();
  updateLedPattern();
}