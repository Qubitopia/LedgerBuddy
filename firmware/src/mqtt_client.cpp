#include "mqtt_client.h"

#include <WiFi.h>
#include <PubSubClient.h>
#include "config.h"

static WiFiClient wifiClient;
static PubSubClient mqtt(wifiClient);
static void (*messageHandler)(const String&, const String&) = nullptr;

static String paymentTopic() {
  return String(MQTT_TOPIC_PREFIX) + "/" + DEVICE_ID + "/payment-events";
}

static void callback(char* topic, byte* payload, unsigned int length) {
  if (!messageHandler) {
    return;
  }
  String msg;
  msg.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  messageHandler(String(topic), msg);
}

void mqttSetup(void (*onMessage)(const String& topic, const String& payload)) {
  messageHandler = onMessage;
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(callback);
}

bool mqttConnected() {
  return mqtt.connected();
}

void mqttLoop() {
  if (!mqtt.connected()) {
    String clientId = String("ledger-buddy-") + DEVICE_ID;
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      mqtt.subscribe(paymentTopic().c_str(), 1);
    }
  }
  mqtt.loop();
}
