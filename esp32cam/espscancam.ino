/*
 * Satsu - ESP32-CAM Document Scanner Firmware
 *
 * Hardware: ESP32-CAM AI-Thinker module (OV2640 + 4MB PSRAM)
 * Buttons: SCAN (capture), SEND (upload + process), RESET (clear batch)
 * LED: Status feedback patterns
 *
 * Configuration priority:
 *   1. NVS Preferences (written by web flasher or Serial config)
 *   2. config.h compile-time defaults
 *
 * On first boot (no NVS config), the firmware enters Serial config mode:
 *   - Waits 5 seconds for JSON config on Serial (115200 baud)
 *   - If received, saves to NVS and reboots
 *   - If timeout, boots with config.h defaults
 *
 * Flow: Boot → Load Config → WiFi → Register → Idle (button polling + heartbeat)
 */

#include "config.h"
#include "led.h"
#include "buttons.h"
#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>

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

// Runtime configuration — loaded from NVS or config.h defaults
String cfgWifiSsid;
String cfgWifiPass;
String cfgServerUrl;
String cfgApiKey;
int cfgBtnScan;
int cfgBtnSend;
int cfgBtnReset;
int cfgLedPin;
int cfgFlashPin;
int cfgMaxPages;

Preferences preferences;

// State
Button btnScan, btnSend, btnReset;
camera_fb_t** frameBuffer = nullptr;
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


// ---------------------------------------------------------------------------
// NVS Configuration
// ---------------------------------------------------------------------------

bool hasNvsConfig() {
  preferences.begin("satsu", true);  // read-only
  bool hasConfig = preferences.getBool("configured", false);
  preferences.end();
  return hasConfig;
}

void loadNvsConfig() {
  preferences.begin("satsu", true);  // read-only

  cfgWifiSsid   = preferences.getString("wifi_ssid", WIFI_SSID);
  cfgWifiPass    = preferences.getString("wifi_pass", WIFI_PASSWORD);
  cfgServerUrl   = preferences.getString("server_url", SERVER_URL);
  cfgApiKey      = preferences.getString("api_key", API_KEY);
  cfgBtnScan     = preferences.getInt("btn_scan", BUTTON_SCAN);
  cfgBtnSend     = preferences.getInt("btn_send", BUTTON_SEND);
  cfgBtnReset    = preferences.getInt("btn_reset", BUTTON_RESET);
  cfgLedPin      = preferences.getInt("led_pin", LED_PIN);
  cfgFlashPin    = preferences.getInt("flash_pin", FLASH_PIN);
  cfgMaxPages    = preferences.getInt("max_pages", DEFAULT_MAX_PAGES);

  preferences.end();

  maxPages = cfgMaxPages;
}

void saveNvsConfig(JsonDocument& doc) {
  preferences.begin("satsu", false);  // read-write

  if (doc.containsKey("wifi_ssid"))   preferences.putString("wifi_ssid", doc["wifi_ssid"].as<String>());
  if (doc.containsKey("wifi_pass"))   preferences.putString("wifi_pass", doc["wifi_pass"].as<String>());
  if (doc.containsKey("server_url"))  preferences.putString("server_url", doc["server_url"].as<String>());
  if (doc.containsKey("api_key"))     preferences.putString("api_key", doc["api_key"].as<String>());
  if (doc.containsKey("btn_scan"))    preferences.putInt("btn_scan", doc["btn_scan"].as<int>());
  if (doc.containsKey("btn_send"))    preferences.putInt("btn_send", doc["btn_send"].as<int>());
  if (doc.containsKey("btn_reset"))   preferences.putInt("btn_reset", doc["btn_reset"].as<int>());
  if (doc.containsKey("led_pin"))     preferences.putInt("led_pin", doc["led_pin"].as<int>());
  if (doc.containsKey("flash_pin"))   preferences.putInt("flash_pin", doc["flash_pin"].as<int>());
  if (doc.containsKey("max_pages"))   preferences.putInt("max_pages", doc["max_pages"].as<int>());

  preferences.putBool("configured", true);
  preferences.end();
}

/**
 * Wait for JSON config on Serial. Returns true if config was received.
 *
 * Protocol:
 *   1. Firmware prints "SATSU_READY" on Serial
 *   2. Host sends JSON config ending with newline
 *   3. Firmware parses, saves to NVS, prints "SATSU_OK"
 *   4. Firmware reboots
 */
bool waitForSerialConfig(unsigned long timeoutMs) {
  Serial.println("SATSU_READY");
  Serial.flush();

  unsigned long start = millis();
  String buffer = "";

  while (millis() - start < timeoutMs) {
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') {
        if (buffer.length() > 2) {
          // Try to parse JSON
          JsonDocument doc;
          DeserializationError error = deserializeJson(doc, buffer);
          if (!error) {
            saveNvsConfig(doc);
            Serial.println("SATSU_OK");
            Serial.flush();
            delay(500);
            ESP.restart();
            return true;
          } else {
            Serial.print("SATSU_ERROR: JSON parse failed: ");
            Serial.println(error.c_str());
          }
        }
        buffer = "";
      } else {
        buffer += c;
      }
    }
    delay(10);
  }

  Serial.println("SATSU_TIMEOUT");
  return false;
}


// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

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
  WiFi.begin(cfgWifiSsid.c_str(), cfgWifiPass.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    ledUpdate(cfgLedPin);
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
  String url = cfgServerUrl + "/api/device/register";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  if (cfgApiKey.length() > 0) {
    http.addHeader("X-API-Key", cfgApiKey);
  }

  JsonDocument doc;
  doc["mac"] = deviceMac;
  doc["ip"] = WiFi.localIP().toString();
  doc["firmware"] = "1.1.0";
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
    digitalWrite(cfgFlashPin, HIGH);
    delay(configFlashDuration);
  }

  camera_fb_t* fb = esp_camera_fb_get();

  if (configFlash) {
    digitalWrite(cfgFlashPin, LOW);
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
  String url = cfgServerUrl + "/api/scan/batch";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  if (cfgApiKey.length() > 0) {
    http.addHeader("X-API-Key", cfgApiKey);
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
      url = cfgServerUrl + "/api/scan/upload/" + batchId + "/" + String(i);
      http.begin(url);
      http.addHeader("Content-Type", "image/jpeg");
      http.addHeader("X-Device-MAC", deviceMac);
      if (cfgApiKey.length() > 0) {
        http.addHeader("X-API-Key", cfgApiKey);
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
  url = cfgServerUrl + "/api/scan/process/" + batchId;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  if (cfgApiKey.length() > 0) {
    http.addHeader("X-API-Key", cfgApiKey);
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

  // Load config from NVS (falls back to config.h defaults)
  loadNvsConfig();

  // Allocate frame buffer array
  frameBuffer = (camera_fb_t**)calloc(cfgMaxPages, sizeof(camera_fb_t*));

  // If no NVS config yet, wait for Serial config from web flasher
  if (!hasNvsConfig()) {
    Serial.println("No NVS config found. Waiting for Serial configuration...");
    waitForSerialConfig(5000);
    // Reload config in case it was just saved
    loadNvsConfig();
  }

  ledSetup(cfgLedPin);
  if (cfgFlashPin != cfgLedPin) {
    pinMode(cfgFlashPin, OUTPUT);
    digitalWrite(cfgFlashPin, LOW);
  }
  buttonSetup(btnScan, cfgBtnScan);
  buttonSetup(btnSend, cfgBtnSend);
  buttonSetup(btnReset, cfgBtnReset);

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
  ledUpdate(cfgLedPin);

  // Check for Serial config commands at runtime too
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.startsWith("{")) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, line);
      if (!error) {
        saveNvsConfig(doc);
        Serial.println("SATSU_OK");
        Serial.flush();
        delay(500);
        ESP.restart();
      }
    }
  }

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
