#pragma once

#include <Arduino.h>

bool requestPaymentAnnouncementWav(const String& eventId, int amountPaise, const String& currency, String& outUrl);
bool uploadVoiceCommandAndGetWav(const String& filePath, String& outUrl);
