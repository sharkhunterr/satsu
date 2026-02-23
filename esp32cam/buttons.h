#ifndef BUTTONS_H
#define BUTTONS_H

#include <Arduino.h>

struct Button {
  int pin;
  bool lastState;
  bool currentState;
  unsigned long lastDebounceTime;
  bool pressed;  // True for one cycle when button is pressed
};

void buttonSetup(Button &btn, int pin) {
  btn.pin = pin;
  btn.lastState = HIGH;
  btn.currentState = HIGH;
  btn.lastDebounceTime = 0;
  btn.pressed = false;
  pinMode(pin, INPUT_PULLUP);
}

void buttonUpdate(Button &btn, unsigned long debounceMs) {
  btn.pressed = false;
  bool reading = digitalRead(btn.pin);

  if (reading != btn.lastState) {
    btn.lastDebounceTime = millis();
  }

  if ((millis() - btn.lastDebounceTime) > debounceMs) {
    if (reading != btn.currentState) {
      btn.currentState = reading;
      if (btn.currentState == LOW) {
        btn.pressed = true;
      }
    }
  }

  btn.lastState = reading;
}

#endif // BUTTONS_H
