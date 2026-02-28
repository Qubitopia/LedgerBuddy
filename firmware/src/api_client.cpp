#include "api_client.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <SD.h>
#include <WiFi.h>
#include "config.h"

bool requestPaymentAnnouncementWav(const String& eventId, int amountPaise, const String& currency, String& outUrl) {
  outUrl = String(API_BASE_URL) + "/announcements/" + eventId + "/tts?amountPaise=" + String(amountPaise) + "&currency=" + currency;
  return true;
}

bool uploadVoiceCommandAndGetWav(const String& filePath, String& outUrl) {
  File file = SD.open(filePath, FILE_READ);
  if (!file) {
    return false;
  }

  HTTPClient http;
  String url = String(API_BASE_URL) + "/voice/commands";
  if (!http.begin(url)) {
    file.close();
    return false;
  }

  http.addHeader("x-device-token", API_DEVICE_TOKEN);
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("Content-Type", "audio/wav");
  int code = http.sendRequest("POST", &file, file.size());
  if (code < 200 || code >= 300) {
    file.close();
    http.end();
    return false;
  }

  String json = http.getString();
  file.close();
  http.end();

  DynamicJsonDocument doc(1024);
  if (deserializeJson(doc, json) != DeserializationError::Ok) {
    return false;
  }

  outUrl = String((const char*)doc["ttsUrl"]);
  if (outUrl.length() == 0) {
    return false;
  }

  return true;
}
