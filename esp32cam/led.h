#ifndef LED_H
#define LED_H

#include <Arduino.h>

// LED pattern states
enum LedPattern {
  LED_OFF,
  LED_FAST_BLINK,    // Connecting to WiFi
  LED_SLOW_BLINK,    // Registering with server
  LED_SOLID_ON,      // Idle, ready
  LED_QUICK_FLASH,   // Captured page (flash N times)
  LED_RAPID_PULSE,   // Uploading
  LED_DOUBLE_BLINK,  // Processing
  LED_SUCCESS,       // 3 slow blinks
  LED_SOS            // Error pattern
};

static LedPattern currentPattern = LED_OFF;
static unsigned long lastLedUpdate = 0;
static int ledState = LOW;
static int flashCount = 0;
static int flashRemaining = 0;

void ledSetup(int pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
}

void ledSetPattern(LedPattern pattern, int count = 0) {
  currentPattern = pattern;
  flashRemaining = count;
  flashCount = 0;
  lastLedUpdate = 0;
}

void ledUpdate(int pin) {
  unsigned long now = millis();

  switch (currentPattern) {
    case LED_OFF:
      digitalWrite(pin, LOW);
      break;

    case LED_FAST_BLINK:
      if (now - lastLedUpdate >= 100) {
        ledState = !ledState;
        digitalWrite(pin, ledState);
        lastLedUpdate = now;
      }
      break;

    case LED_SLOW_BLINK:
      if (now - lastLedUpdate >= 500) {
        ledState = !ledState;
        digitalWrite(pin, ledState);
        lastLedUpdate = now;
      }
      break;

    case LED_SOLID_ON:
      digitalWrite(pin, HIGH);
      break;

    case LED_QUICK_FLASH:
      if (flashRemaining > 0) {
        if (now - lastLedUpdate >= 150) {
          ledState = !ledState;
          digitalWrite(pin, ledState);
          lastLedUpdate = now;
          if (ledState == LOW) {
            flashRemaining--;
          }
        }
      } else {
        currentPattern = LED_SOLID_ON;
      }
      break;

    case LED_RAPID_PULSE:
      if (now - lastLedUpdate >= 50) {
        ledState = !ledState;
        digitalWrite(pin, ledState);
        lastLedUpdate = now;
      }
      break;

    case LED_DOUBLE_BLINK:
      // Pattern: ON-OFF-ON-OFF----
      {
        unsigned long phase = (now / 200) % 6;
        digitalWrite(pin, (phase == 0 || phase == 2) ? HIGH : LOW);
      }
      break;

    case LED_SUCCESS:
      // 3 slow blinks then off
      if (flashRemaining > 0 || flashCount < 3) {
        if (now - lastLedUpdate >= 400) {
          ledState = !ledState;
          digitalWrite(pin, ledState);
          lastLedUpdate = now;
          if (ledState == LOW) {
            flashCount++;
            if (flashCount >= 3) {
              currentPattern = LED_SOLID_ON;
            }
          }
        }
      }
      break;

    case LED_SOS:
      // SOS: ... --- ...
      {
        unsigned long phase = (now / 200) % 18;
        bool on = false;
        // S: 0,2,4  O: 6,7,8,10,11,12,14,15,16  (not exact but recognizable)
        if (phase < 6) on = (phase % 2 == 0);        // short short short
        else if (phase < 12) on = (phase >= 6 && phase <= 7) || (phase >= 9 && phase <= 10); // long long long
        else on = (phase % 2 == 0);                   // short short short
        digitalWrite(pin, on ? HIGH : LOW);
      }
      break;
  }
}

#endif // LED_H
