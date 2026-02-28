#pragma once

#include <Arduino.h>

void mqttSetup(void (*onMessage)(const String& topic, const String& payload));
void mqttLoop();
bool mqttConnected();
