#include "recorder.h"

#include <SD.h>
#include "config.h"

static File wavFile;
static String currentPath = "/cmd.wav";
static bool active = false;

bool recorderBegin() {
  return SD.begin(PIN_SD_CS);
}

void recorderStart(const String& filePath) {
  currentPath = filePath;
  if (SD.exists(currentPath)) {
    SD.remove(currentPath);
  }
  wavFile = SD.open(currentPath, FILE_WRITE);
  if (!wavFile) {
    active = false;
    return;
  }
  uint8_t header[44] = {0};
  wavFile.write(header, 44);
  active = true;
}

void recorderCaptureChunk() {
  if (!active || !wavFile) {
    return;
  }
  uint8_t chunk[512];
  memset(chunk, 0, sizeof(chunk));
  wavFile.write(chunk, sizeof(chunk));
}

bool recorderStopAndFinalize() {
  if (!active || !wavFile) {
    return false;
  }
  wavFile.flush();
  size_t fileSize = wavFile.size();
  if (fileSize <= 44) {
    wavFile.close();
    active = false;
    return false;
  }
  wavFile.seek(0);
  uint8_t header[44] = {
    'R','I','F','F',
    (uint8_t)((fileSize - 8) & 0xff), (uint8_t)(((fileSize - 8) >> 8) & 0xff), (uint8_t)(((fileSize - 8) >> 16) & 0xff), (uint8_t)(((fileSize - 8) >> 24) & 0xff),
    'W','A','V','E','f','m','t',' ',
    16,0,0,0,
    1,0,
    1,0,
    0x80,0x3E,0x00,0x00,
    0x00,0x7D,0x00,0x00,
    2,0,
    16,0,
    'd','a','t','a',
    (uint8_t)((fileSize - 44) & 0xff), (uint8_t)(((fileSize - 44) >> 8) & 0xff), (uint8_t)(((fileSize - 44) >> 16) & 0xff), (uint8_t)(((fileSize - 44) >> 24) & 0xff)
  };
  wavFile.write(header, sizeof(header));
  wavFile.close();
  active = false;
  return true;
}

bool recorderFileReady() {
  if (!SD.exists(currentPath)) {
    return false;
  }
  File test = SD.open(currentPath, FILE_READ);
  if (!test) {
    return false;
  }
  bool ready = test.size() > 44;
  test.close();
  return ready;
}

String recorderCurrentFilePath() {
  return currentPath;
}
