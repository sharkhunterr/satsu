#ifndef CONFIG_H
#define CONFIG_H

// WiFi Configuration
#define WIFI_SSID     "your-wifi-ssid"
#define WIFI_PASSWORD "your-wifi-password"

// Server Configuration
#define SERVER_URL    "http://192.168.1.100:8400"
#define API_KEY       ""  // Leave empty if API key is disabled on server

// Hardware Configuration
#define BUTTON_SCAN   GPIO_NUM_12  // SCAN button GPIO
#define BUTTON_SEND   GPIO_NUM_13  // SEND button GPIO
#define BUTTON_RESET  GPIO_NUM_15  // RESET button GPIO
#define LED_PIN       GPIO_NUM_4   // Status LED GPIO (built-in flash LED)
#define FLASH_PIN     GPIO_NUM_4   // Camera flash GPIO

// Camera Settings (can be overridden by server config)
#define DEFAULT_FRAMESIZE  FRAMESIZE_UXGA  // 1600x1200
#define DEFAULT_QUALITY    10               // JPEG quality (0-63, lower = better)
#define DEFAULT_MAX_PAGES  10               // Max pages per batch
#define FLASH_ENABLED      true
#define FLASH_DURATION_MS  100              // Flash on time in ms

// Timing
#define HEARTBEAT_INTERVAL_MS  60000   // 60 seconds
#define DEBOUNCE_MS            300     // Button debounce
#define UPLOAD_RETRY_COUNT     3
#define UPLOAD_RETRY_DELAY_MS  1000

#endif // CONFIG_H
