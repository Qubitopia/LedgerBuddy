#pragma once

#include <Arduino.h>

bool recorderBegin();
void recorderStart(const String& filePath);
void recorderCaptureChunk();
bool recorderStopAndFinalize();
bool recorderFileReady();
String recorderCurrentFilePath();
