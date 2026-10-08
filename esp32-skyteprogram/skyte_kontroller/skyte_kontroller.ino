// Skytekontroller for ESP32-C6
// Styrer rødt og grønt lys etter ISSF/VM-tider og tar imot kommandoer fra
// skjermen over ESP-NOW. Krever Arduino-ESP32 core 3.x (C6-støtte).

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

#include <SkyteProtokoll.h>

#include "ShotEngine.h"

// ---------------------------------------------------------------------------
// Maskinvare (ESP32-C6-DevKitC-1). Lampene MÅ drives via MOSFET eller relé.
// ---------------------------------------------------------------------------
const int PIN_RED = 4;
const int PIN_GREEN = 5;
const int PIN_BUZZER = 6;          // aktiv summer, -1 hvis ingen
const int PIN_BUTTON = 9;          // BOOT-knappen: start/stopp uten skjerm
const bool OUTPUT_ACTIVE_HIGH = true;  // false for relémoduler som er aktiv lav

static const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

Preferences prefs;
ShotEngine engine;
Settings settings;
uint8_t selectedProgram = 0;

QueueHandle_t cmdQueue;
uint32_t lastSeq = 0;
bool haveSeq = false;

uint32_t buzzerOffAt = 0;
uint32_t lastStatusAt = 0;
bool statusDirty = true;

// ---------------------------------------------------------------------------
// Utganger
// ---------------------------------------------------------------------------
void writeOutput(int pin, bool on) {
  digitalWrite(pin, on == OUTPUT_ACTIVE_HIGH ? HIGH : LOW);
}

void setLight(uint8_t light) {
  writeOutput(PIN_RED, light == L_RED);
  writeOutput(PIN_GREEN, light == L_GREEN);
#ifdef RGB_BUILTIN
  // Innebygd RGB-LED speiler lampene (praktisk ved testing på benken)
  rgbLedWrite(RGB_BUILTIN, light == L_RED ? 40 : 0, light == L_GREEN ? 40 : 0, 0);
#endif
}

void beep(uint32_t ms) {
  if (PIN_BUZZER < 0) return;
  digitalWrite(PIN_BUZZER, HIGH);
  buzzerOffAt = millis() + ms;
}

void updateBuzzer() {
  if (PIN_BUZZER >= 0 && buzzerOffAt && (int32_t)(millis() - buzzerOffAt) >= 0) {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerOffAt = 0;
  }
}

// ---------------------------------------------------------------------------
// Lagring av innstillinger
// ---------------------------------------------------------------------------
void loadSettings() {
  settings = defaultSettings();
  prefs.begin("skyte", true);
  for (uint8_t p = 0; p < P_COUNT; p++) {
    char key[4];
    snprintf(key, sizeof(key), "p%u", p);
    setParam(settings, p, prefs.getShort(key, getParam(settings, p)));
  }
  selectedProgram = prefs.getUChar("prog", 0);
  if (selectedProgram >= PROGRAM_COUNT) selectedProgram = 0;
  prefs.end();
}

void saveSettings() {
  prefs.begin("skyte", false);
  for (uint8_t p = 0; p < P_COUNT; p++) {
    char key[4];
    snprintf(key, sizeof(key), "p%u", p);
    prefs.putShort(key, getParam(settings, p));
  }
  prefs.putUChar("prog", selectedProgram);
  prefs.end();
}

// ---------------------------------------------------------------------------
// ESP-NOW
// ---------------------------------------------------------------------------
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
#else
void onReceive(const uint8_t* mac, const uint8_t* data, int len) {
#endif
  if (len != sizeof(CmdMsg)) return;
  CmdMsg msg;
  memcpy(&msg, data, sizeof(msg));
  if (!headerValid(msg.h, MSG_CMD)) return;
  xQueueSend(cmdQueue, &msg, 0);  // behandles i loop(), ikke i WiFi-tråden
}

void setupRadio() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init feilet");
    return;
  }
  esp_now_register_recv_cb(onReceive);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = ESPNOW_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
  Serial.print("Kontroller MAC: ");
  Serial.println(WiFi.macAddress());
}

void sendStatus() {
  uint32_t now = millis();
  StatusMsg s = {};
  fillHeader(s.h, MSG_STATUS);
  s.running = engine.running();
  s.program = engine.running() ? engine.program() : selectedProgram;
  s.phase = engine.phase();
  s.light = engine.light();
  s.shot = engine.shot();
  s.shots = PROGRAMS[s.program].shots;
  s.remainingMs = engine.remainingMs(now);
  s.seriesDone = engine.seriesDone();
  s.luft = settings.luft;
  s.luftRedS = settings.luftRedS;
  s.loadS = settings.loadS;
  s.duelGreenDs = settings.duelGreenDs;
  esp_now_send(BROADCAST, (const uint8_t*)&s, sizeof(s));
  lastStatusAt = now;
  statusDirty = false;
}

// ---------------------------------------------------------------------------
// Kommandoer
// ---------------------------------------------------------------------------
void startSeries() {
  if (engine.running()) return;
  engine.start(selectedProgram, settings, millis());
  setLight(engine.light());
  beep(150);
  Serial.printf("Start: %s\n", PROGRAMS[selectedProgram].name);
}

void stopSeries() {
  bool wasRunning = engine.running();
  engine.stop();
  setLight(engine.light());
  if (wasRunning) beep(600);
  Serial.println("Stopp");
}

void handleCommand(const CmdMsg& c) {
  if (haveSeq && c.seq == lastSeq) return;  // repetisjon av samme kommando
  haveSeq = true;
  lastSeq = c.seq;

  switch (c.cmd) {
    case CMD_START:
      startSeries();
      break;
    case CMD_STOP:
      stopSeries();
      break;
    case CMD_SELECT:
      if (!engine.running() && c.arg < PROGRAM_COUNT) {
        selectedProgram = c.arg;
        engine.stop();  // nullstill "ferdig"-visning
        saveSettings();
      }
      break;
    case CMD_SET:
      if (!engine.running() && c.arg < P_COUNT) {
        setParam(settings, c.arg, c.value);
        saveSettings();
      }
      break;
  }
  statusDirty = true;
}

void pollButton() {
  static bool lastPressed = false;
  static uint32_t lastChange = 0;
  bool pressed = digitalRead(PIN_BUTTON) == LOW;
  if (pressed != lastPressed && millis() - lastChange > 50) {
    lastChange = millis();
    lastPressed = pressed;
    if (pressed) {
      if (engine.running()) stopSeries();
      else startSeries();
      statusDirty = true;
    }
  }
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_RED, OUTPUT);
  pinMode(PIN_GREEN, OUTPUT);
  if (PIN_BUZZER >= 0) {
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
  }
  pinMode(PIN_BUTTON, INPUT_PULLUP);

  loadSettings();
  setLight(engine.light());

  cmdQueue = xQueueCreate(16, sizeof(CmdMsg));
  setupRadio();
}

void loop() {
  CmdMsg c;
  while (xQueueReceive(cmdQueue, &c, 0) == pdTRUE) handleCommand(c);

  pollButton();

  switch (engine.update(millis())) {
    case EV_GREEN:
      setLight(L_GREEN);
      beep(150);
      statusDirty = true;
      break;
    case EV_STEP:
      setLight(engine.light());
      statusDirty = true;
      break;
    case EV_DONE:
      setLight(engine.light());
      beep(600);
      statusDirty = true;
      break;
    case EV_NONE:
      break;
  }

  updateBuzzer();

  // Status oftere mens serien går, så skjermen viser riktig nedtelling
  uint32_t interval = engine.running() ? 100 : 500;
  if (statusDirty || millis() - lastStatusAt >= interval) sendStatus();

  delay(1);
}
