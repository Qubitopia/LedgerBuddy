#include "audio_playback.h"

#include <HTTPClient.h>

bool playWavFromUrl(const String& url) {
  HTTPClient http;
  if (!http.begin(url)) {
    return false;
  }

  int code = http.GET();
  if (code <= 0) {
    http.end();
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buffer[1024];
  while (http.connected()) {
    int available = stream->available();
    if (available <= 0) {
      delay(10);
      continue;
    }
    int read = stream->readBytes(buffer, min(available, (int)sizeof(buffer)));
    if (read <= 0) {
      break;
    }
  }

  http.end();
  return true;
}
