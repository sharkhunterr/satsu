/*
 * ESPScanCam - ESP32-CAM Document Scanner Firmware
 *
 * Hardware: ESP32-CAM AI-Thinker module (OV2640 + 4MB PSRAM)
 * Buttons: SCAN (capture), SEND (upload + process), RESET (clear batch)
 * LED: Status feedback patterns
 *
 * Flow: Boot → WiFi → Register → Idle (button polling + heartbeat)
 */

#include "config.h"
#include "led.h"
#include "buttons.h"
#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Camera pin definitions for AI-Thinker module
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// State
Button btnScan, btnSend, btnReset;
camera_fb_t* frameBuffer[DEFAULT_MAX_PAGES];
int capturedPages = 0;
int maxPages = DEFAULT_MAX_PAGES;
String batchId = "";
unsigned long lastHeartbeat = 0;
String deviceMac = "";

// Runtime config (updated from server)
int configQuality = DEFAULT_QUALITY;
framesize_t configFramesize = DEFAULT_FRAMESIZE;
bool configFlash = FLASH_ENABLED;
int configFlashDuration = FLASH_DURATION_MS;

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    config.frame_size = configFramesize;
    config.jpeg_quality = configQuality;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  return (err == ESP_OK);
}

void connectWiFi() {
  ledSetPattern(LED_FAST_BLINK);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    ledUpdate(LED_PIN);
    delay(500);
    attempts++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    ledSetPattern(LED_SOS);
    return;
  }

  deviceMac = WiFi.macAddress();
}

bool registerDevice() {
  ledSetPattern(LED_SLOW_BLINK);

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/device/register";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  if (strlen(API_KEY) > 0) {
    http.addHeader("X-API-Key", API_KEY);
  }

  JsonDocument doc;
  doc["mac"] = deviceMac;
  doc["ip"] = WiFi.localIP().toString();
  doc["firmware"] = "1.0.0";
  doc["resolution"] = (configFramesize == FRAMESIZE_UXGA) ? "UXGA" : "SVGA";
  doc["max_pages"] = maxPages;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  bool success = (httpCode == 200);

  if (success) {
    // Parse response for pending config
    String response = http.getString();
    JsonDocument respDoc;
    DeserializationError error = deserializeJson(respDoc, response);
    if (!error && respDoc.containsKey("pending_config")) {
      JsonObject pendingConfig = respDoc["pending_config"];
      if (pendingConfig.containsKey("quality")) {
        configQuality = pendingConfig["quality"];
      }
      if (pendingConfig.containsKey("flash")) {
        configFlash = pendingConfig["flash"];
      }
    }
    ledSetPattern(LED_SOLID_ON);
  } else {
    ledSetPattern(LED_SOS);
  }

  http.end();
  return success;
}

void captureFrame() {
  if (capturedPages >= maxPages) return;

  // Flash
  if (configFlash) {
    digitalWrite(FLASH_PIN, HIGH);
    delay(configFlashDuration);
  }

  camera_fb_t* fb = esp_camera_fb_get();

  if (configFlash) {
    digitalWrite(FLASH_PIN, LOW);
  }

  if (!fb) return;

  // Store in buffer (PSRAM)
  frameBuffer[capturedPages] = fb;
  capturedPages++;

  ledSetPattern(LED_QUICK_FLASH, capturedPages);
}

bool uploadBatch() {
  if (capturedPages == 0) return false;

  ledSetPattern(LED_RAPID_PULSE);

  // Create batch
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/scan/batch";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) {
    http.addHeader("X-API-Key", API_KEY);
  }

  JsonDocument doc;
  doc["source_type"] = "esp32cam";
  doc["device_mac"] = deviceMac;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  if (httpCode != 201) {
    http.end();
    ledSetPattern(LED_SOS);
    return false;
  }

  // Parse batch_id
  String response = http.getString();
  JsonDocument respDoc;
  deserializeJson(respDoc, response);
  batchId = respDoc["id"].as<String>();
  http.end();

  // Upload each page
  for (int i = 0; i < capturedPages; i++) {
    bool uploaded = false;
    for (int retry = 0; retry < UPLOAD_RETRY_COUNT && !uploaded; retry++) {
      url = String(SERVER_URL) + "/api/scan/upload/" + batchId + "/" + String(i);
      http.begin(url);
      http.addHeader("Content-Type", "image/jpeg");
      http.addHeader("X-Device-MAC", deviceMac);
      if (strlen(API_KEY) > 0) {
        http.addHeader("X-API-Key", API_KEY);
      }

      httpCode = http.sendRequest("POST", frameBuffer[i]->buf, frameBuffer[i]->len);
      uploaded = (httpCode == 200);
      http.end();

      if (!uploaded && retry < UPLOAD_RETRY_COUNT - 1) {
        delay(UPLOAD_RETRY_DELAY_MS);
      }
    }

    if (!uploaded) {
      ledSetPattern(LED_SOS);
      return false;
    }
  }

  // Trigger processing
  ledSetPattern(LED_DOUBLE_BLINK);
  url = String(SERVER_URL) + "/api/scan/process/" + batchId;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) {
    http.addHeader("X-API-Key", API_KEY);
  }
  httpCode = http.POST("{}");
  http.end();

  ledSetPattern(LED_SUCCESS);
  return true;
}

void clearBatch() {
  for (int i = 0; i < capturedPages; i++) {
    if (frameBuffer[i]) {
      esp_camera_fb_return(frameBuffer[i]);
      frameBuffer[i] = nullptr;
    }
  }
  capturedPages = 0;
  batchId = "";
  ledSetPattern(LED_SOLID_ON);
}

void setup() {
  Serial.begin(115200);

  ledSetup(LED_PIN);
  buttonSetup(btnScan, BUTTON_SCAN);
  buttonSetup(btnSend, BUTTON_SEND);
  buttonSetup(btnReset, BUTTON_RESET);

  memset(frameBuffer, 0, sizeof(frameBuffer));

  if (!initCamera()) {
    ledSetPattern(LED_SOS);
    return;
  }

  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    registerDevice();
    lastHeartbeat = millis();
  }
}

void loop() {
  ledUpdate(LED_PIN);

  // Reconnect WiFi if needed
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() == WL_CONNECTED) {
      registerDevice();
      lastHeartbeat = millis();
    }
    return;
  }

  // Heartbeat
  if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    registerDevice();
    lastHeartbeat = millis();
  }

  // Button polling
  buttonUpdate(btnScan, DEBOUNCE_MS);
  buttonUpdate(btnSend, DEBOUNCE_MS);
  buttonUpdate(btnReset, DEBOUNCE_MS);

  if (btnScan.pressed) {
    captureFrame();
  }

  if (btnSend.pressed) {
    if (uploadBatch()) {
      clearBatch();
    }
  }

  if (btnReset.pressed) {
    clearBatch();
  }
}
