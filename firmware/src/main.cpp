#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>

#include "api_client.h"
#include "audio_playback.h"
#include "config.h"
#include "mqtt_client.h"
#include "recorder.h"

enum class DeviceState {
  IDLE,
  RECORDING,
  UPLOADING,
  PLAYING
};

static DeviceState state = DeviceState::IDLE;
static bool buttonWasPressed = false;
static String pendingAudioUrl;

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
  }
}

static void onMqttMessage(const String& topic, const String& payload) {
  DynamicJsonDocument doc(1024);
  if (deserializeJson(doc, payload) != DeserializationError::Ok) {
    return;
  }

  String eventId = doc["eventId"] | "";
  int amountPaise = doc["amountPaise"] | 0;
  String currency = doc["currency"] | "INR";
  if (eventId.length() == 0 || amountPaise <= 0) {
    return;
  }

  String url;
  if (!requestPaymentAnnouncementWav(eventId, amountPaise, currency, url)) {
    return;
  }
  pendingAudioUrl = url;
  state = DeviceState::PLAYING;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  connectWifi();
  recorderBegin();
  mqttSetup(onMqttMessage);
}

void loop() {
  mqttLoop();

  bool buttonPressed = digitalRead(PIN_BUTTON) == LOW;
  if (buttonPressed && !buttonWasPressed && state == DeviceState::IDLE) {
    recorderStart("/cmd.wav");
    state = DeviceState::RECORDING;
  }

  if (state == DeviceState::RECORDING) {
    if (buttonPressed) {
      recorderCaptureChunk();
    } else {
      recorderStopAndFinalize();
      if (recorderFileReady()) {
        state = DeviceState::UPLOADING;
      } else {
        state = DeviceState::IDLE;
      }
    }
  }

  if (state == DeviceState::UPLOADING) {
    String wavUrl;
    if (uploadVoiceCommandAndGetWav(recorderCurrentFilePath(), wavUrl)) {
      pendingAudioUrl = wavUrl;
      state = DeviceState::PLAYING;
    } else {
      state = DeviceState::IDLE;
    }
  }

  if (state == DeviceState::PLAYING) {
    if (pendingAudioUrl.length() > 0) {
      playWavFromUrl(pendingAudioUrl);
      pendingAudioUrl = "";
    }
    state = DeviceState::IDLE;
  }

  buttonWasPressed = buttonPressed;
  delay(5);
}
