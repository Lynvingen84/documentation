// Skjerm/fjernkontroll for skyteanlegget.
// Laget for LCDWIKI ES3C28P (ESP32-S3, 2,8" ILI9341V + FT6336 touch).
// Velg program, start/stopp, bytt mellom 25m og luftpistol og juster tider.

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

#include <SkyteProtokoll.h>

#include "Display_ES3C28P.h"

#define SCREEN_W 320
#define SCREEN_H 240

LGFX_ES3C28P tft;

// Fontnumrene er de samme som i TFT_eSPI: 1 = liten, 2, 4 og 7 (7-segment)
const lgfx::IFont* fontFor(uint8_t n) {
  switch (n) {
    case 1: return &fonts::Font0;
    case 4: return &fonts::Font4;
    case 7: return &fonts::Font7;
  }
  return &fonts::Font2;
}

void drawText(const char* text, int32_t x, int32_t y, uint8_t font) {
  tft.setFont(fontFor(font));
  tft.drawString(text, x, y);
}

static const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ---------------------------------------------------------------------------
// Status fra kontrolleren
// ---------------------------------------------------------------------------
portMUX_TYPE statusMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool statusFresh = false;
StatusMsg rxStatus;  // skrives i WiFi-tråden

StatusMsg status;          // kopi som brukes i loop()
bool haveStatus = false;
uint32_t statusAt = 0;     // millis() da siste status kom
uint32_t cmdSeq = 0;

bool connected() { return haveStatus && millis() - statusAt < 1500; }

Settings statusSettings() {
  Settings s;
  s.luft = status.luft;
  s.luftRedS = status.luftRedS;
  s.loadS = status.loadS;
  s.duelGreenDs = status.duelGreenDs;
  return s;
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
#else
void onReceive(const uint8_t* mac, const uint8_t* data, int len) {
#endif
  if (len != sizeof(StatusMsg)) return;
  const StatusMsg* m = (const StatusMsg*)data;
  if (!headerValid(m->h, MSG_STATUS)) return;
  portENTER_CRITICAL(&statusMux);
  memcpy(&rxStatus, data, sizeof(StatusMsg));
  statusFresh = true;
  portEXIT_CRITICAL(&statusMux);
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
}

// Broadcast har ingen kvittering, så kommandoen sendes 3 ganger med samme
// sekvensnummer. Kontrolleren ignorerer duplikatene.
void sendCommand(uint8_t cmd, uint8_t arg = 0, int16_t value = 0) {
  CmdMsg c = {};
  fillHeader(c.h, MSG_CMD);
  c.cmd = cmd;
  c.arg = arg;
  c.value = value;
  c.seq = ++cmdSeq;
  for (int i = 0; i < 3; i++) {
    esp_now_send(BROADCAST, (const uint8_t*)&c, sizeof(c));
    delay(15);
  }
}

// ---------------------------------------------------------------------------
// Knapper
// ---------------------------------------------------------------------------
struct Button {
  int16_t x, y, w, h;
};

bool hit(const Button& b, int16_t x, int16_t y) {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

void drawButton(const Button& b, const char* label, uint16_t color, bool enabled,
                uint8_t font = 4) {
  uint16_t fill = enabled ? color : TFT_DARKGREY;
  tft.fillRoundRect(b.x, b.y, b.w, b.h, 8, fill);
  tft.drawRoundRect(b.x, b.y, b.w, b.h, 8, TFT_WHITE);
  tft.setTextDatum(MC_DATUM);
  tft.setTextPadding(0);
  tft.setTextColor(enabled && color == TFT_GREEN ? TFT_BLACK : TFT_WHITE, fill);
  drawText(label, b.x + b.w / 2, b.y + b.h / 2 + 1, font);
}

// Hovedskjerm
const Button BTN_PREV = {4, 30, 44, 46};
const Button BTN_NEXT = {272, 30, 44, 46};
const Button BTN_START = {4, 186, 75, 50};
const Button BTN_STOP = {83, 186, 75, 50};
const Button BTN_LUFT = {162, 186, 75, 50};
const Button BTN_MENU = {241, 186, 75, 50};

// Innstillinger: tre rader med [-] verdi [+]
const uint8_t SETTING_PARAMS[] = {P_LUFT_RED_S, P_LOAD_S, P_DUEL_GREEN_DS};
const char* SETTING_LABELS[] = {"Luft: rod pause", "Ladetid", "Duell: gront"};
const int SETTING_ROWS = 3;
const int ROW_Y0 = 36;
const int ROW_H = 50;
Button minusBtn(int row) { return {170, (int16_t)(ROW_Y0 + row * ROW_H), 44, 42}; }
Button plusBtn(int row) { return {272, (int16_t)(ROW_Y0 + row * ROW_H), 44, 42}; }
const Button BTN_BACK = {90, 190, 140, 46};

// ---------------------------------------------------------------------------
// Tegning
// ---------------------------------------------------------------------------
enum Screen { SCR_MAIN, SCR_SETTINGS };
Screen screen = SCR_MAIN;

// Det som sist ble tegnet, for å unngå flimmer
struct Drawn {
  bool valid;
  bool connected;
  bool running;
  uint8_t program;
  uint8_t phase;
  uint8_t light;
  uint8_t shot;
  uint16_t series;
  Settings settings;
  char time[12];
} drawn;

void invalidate() { drawn.valid = false; }

void formatTime(uint32_t ms, char* buf, size_t len) {
  if (ms >= 60000) {
    uint32_t s = (ms + 999) / 1000;
    snprintf(buf, len, "%lu:%02lu", (unsigned long)(s / 60), (unsigned long)(s % 60));
  } else if (ms >= 10000) {
    snprintf(buf, len, "%lu", (unsigned long)((ms + 999) / 1000));
  } else {
    snprintf(buf, len, "%lu.%lu", (unsigned long)(ms / 1000),
             (unsigned long)((ms % 1000) / 100));
  }
}

void drawHeader(const char* title) {
  tft.fillRect(0, 0, SCREEN_W, 26, TFT_NAVY);
  tft.setTextDatum(ML_DATUM);
  tft.setTextPadding(0);
  tft.setTextColor(TFT_WHITE, TFT_NAVY);
  drawText(title, 6, 13, 2);
  tft.setTextDatum(MR_DATUM);
  if (connected()) {
    char buf[24];
    snprintf(buf, sizeof(buf), "Serier: %u", status.seriesDone);
    tft.setTextColor(TFT_GREEN, TFT_NAVY);
    drawText(buf, SCREEN_W - 6, 13, 2);
  } else {
    tft.setTextColor(TFT_ORANGE, TFT_NAVY);
    drawText("Ingen kontakt", SCREEN_W - 6, 13, 2);
  }
}

void drawProgram() {
  bool canChange = connected() && !status.running;
  tft.fillRect(50, 28, 220, 50, TFT_BLACK);
  drawButton(BTN_PREV, "<", TFT_BLUE, canChange);
  drawButton(BTN_NEXT, ">", TFT_BLUE, canChange);
  if (!haveStatus) {
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    drawText("Venter pa kontroller...", 160, 53, 2);
    return;
  }
  uint8_t p = status.program < PROGRAM_COUNT ? status.program : 0;
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  drawText(PROGRAMS[p].name, 160, 43, 4);
  char desc[48];
  describeProgram(p, statusSettings(), desc, sizeof(desc));
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  drawText(desc, 160, 68, 2);
}

void drawLamp() {
  uint16_t c = TFT_DARKGREY;
  if (connected()) {
    if (status.light == L_RED) c = TFT_RED;
    else if (status.light == L_GREEN) c = TFT_GREEN;
  }
  tft.fillCircle(50, 130, 42, c);
  tft.drawCircle(50, 130, 43, TFT_WHITE);
}

void drawPhase() {
  tft.fillRect(100, 150, 216, 32, TFT_BLACK);
  const char* text = "KLAR";
  uint16_t color = TFT_WHITE;
  switch (status.phase) {
    case PH_LOAD: text = "LAD!"; color = TFT_YELLOW; break;
    case PH_WAIT: text = "VENT"; color = TFT_RED; break;
    case PH_FIRE: text = "SKYT!"; color = TFT_GREEN; break;
    case PH_DONE: text = "FERDIG"; color = TFT_CYAN; break;
  }
  if (!connected()) {
    text = "--";
    color = TFT_DARKGREY;
  }
  tft.setTextDatum(ML_DATUM);
  tft.setTextColor(color, TFT_BLACK);
  drawText(text, 104, 166, 4);
  if (connected() && status.shot > 0) {
    char buf[16];
    snprintf(buf, sizeof(buf), "Skudd %u/%u", status.shot, status.shots);
    tft.setTextDatum(MR_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    drawText(buf, 314, 166, 4);
  }
}

void drawTime(const char* text) {
  tft.setTextDatum(MC_DATUM);
  tft.setTextPadding(210);
  uint16_t color = TFT_WHITE;
  if (connected() && status.running) {
    if (status.light == L_GREEN) color = TFT_GREEN;
    else if (status.phase == PH_LOAD) color = TFT_YELLOW;
    else color = TFT_RED;
  }
  tft.setTextColor(color, TFT_BLACK);
  drawText(text, 208, 112, 7);  // font 7 = 7-segment, 48 px
  tft.setTextPadding(0);
}

void drawMainButtons() {
  bool on = connected();
  bool run = on && status.running;
  drawButton(BTN_START, "START", TFT_GREEN, on && !run);
  drawButton(BTN_STOP, "STOPP", TFT_RED, on);
  drawButton(BTN_LUFT, on && status.luft ? "LUFT" : "25m",
             on && status.luft ? TFT_PURPLE : TFT_BLUE, on && !run);
  drawButton(BTN_MENU, "MENY", TFT_BLUE, on && !run);
}

void drawSettings() {
  tft.fillScreen(TFT_BLACK);
  drawHeader("INNSTILLINGER");
  Settings s = statusSettings();
  for (int r = 0; r < SETTING_ROWS; r++) {
    int y = ROW_Y0 + r * ROW_H + 21;
    uint8_t p = SETTING_PARAMS[r];
    tft.setTextDatum(ML_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    drawText(SETTING_LABELS[r], 6, y, 2);
    drawButton(minusBtn(r), "-", TFT_BLUE, connected());
    drawButton(plusBtn(r), "+", TFT_BLUE, connected());
    char buf[12];
    int16_t v = getParam(s, p);
    if (p == P_DUEL_GREEN_DS) snprintf(buf, sizeof(buf), "%d.%ds", v / 10, v % 10);
    else snprintf(buf, sizeof(buf), "%ds", v);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_YELLOW, TFT_BLACK);
    drawText(buf, 243, y, 2);
  }
  tft.setTextDatum(ML_DATUM);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  drawText("Luft-pausen brukes i duell nar LUFT er valgt.", 6, 183, 1);
  drawButton(BTN_BACK, "TILBAKE", TFT_BLUE, true);
}

void render() {
  bool on = connected();
  Settings s = statusSettings();
  bool settingsChanged =
      memcmp(&s, &drawn.settings, sizeof(Settings)) != 0;

  if (screen == SCR_SETTINGS) {
    if (!drawn.valid || settingsChanged || on != drawn.connected) {
      drawSettings();
      drawn.valid = true;
      drawn.connected = on;
      drawn.settings = s;
    }
    return;
  }

  bool full = !drawn.valid;
  if (full) {
    tft.fillScreen(TFT_BLACK);
    drawn.time[0] = 0;
  }
  bool connChanged = full || on != drawn.connected;
  bool runChanged = full || status.running != drawn.running;

  if (connChanged || status.seriesDone != drawn.series) drawHeader("SKYTEPROGRAM");
  if (connChanged || runChanged || status.program != drawn.program || settingsChanged)
    drawProgram();
  if (connChanged || status.light != drawn.light) drawLamp();
  if (connChanged || status.phase != drawn.phase || status.shot != drawn.shot) drawPhase();
  if (connChanged || runChanged || settingsChanged) drawMainButtons();

  char t[12];
  if (on && status.running) {
    uint32_t since = millis() - statusAt;
    uint32_t rem = status.remainingMs > since ? status.remainingMs - since : 0;
    formatTime(rem, t, sizeof(t));
  } else {
    strcpy(t, "--");
  }
  if (connChanged || strcmp(t, drawn.time) != 0) {
    drawTime(t);
    strcpy(drawn.time, t);
  }

  drawn.valid = true;
  drawn.connected = on;
  drawn.running = status.running;
  drawn.program = status.program;
  drawn.phase = status.phase;
  drawn.light = status.light;
  drawn.shot = status.shot;
  drawn.series = status.seriesDone;
  drawn.settings = s;
}

// ---------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------
bool readTouch(int16_t& x, int16_t& y) {
  int32_t tx, ty;
  if (!tft.getTouch(&tx, &ty)) return false;
  x = tx;
  y = ty;
  return true;
}

void onTap(int16_t x, int16_t y) {
  bool on = connected();
  bool run = on && status.running;

  if (screen == SCR_SETTINGS) {
    if (hit(BTN_BACK, x, y)) {
      screen = SCR_MAIN;
      invalidate();
      return;
    }
    if (!on) return;
    Settings s = statusSettings();
    for (int r = 0; r < SETTING_ROWS; r++) {
      uint8_t p = SETTING_PARAMS[r];
      int16_t step = PARAM_LIMITS[p].step;
      if (hit(minusBtn(r), x, y)) sendCommand(CMD_SET, p, clampParam(p, getParam(s, p) - step));
      if (hit(plusBtn(r), x, y)) sendCommand(CMD_SET, p, clampParam(p, getParam(s, p) + step));
    }
    return;
  }

  if (!on) return;
  if (hit(BTN_STOP, x, y)) {
    sendCommand(CMD_STOP);
  } else if (run) {
    return;  // alt annet er låst mens serien går
  } else if (hit(BTN_START, x, y)) {
    sendCommand(CMD_START);
  } else if (hit(BTN_PREV, x, y)) {
    sendCommand(CMD_SELECT, (status.program + PROGRAM_COUNT - 1) % PROGRAM_COUNT);
  } else if (hit(BTN_NEXT, x, y)) {
    sendCommand(CMD_SELECT, (status.program + 1) % PROGRAM_COUNT);
  } else if (hit(BTN_LUFT, x, y)) {
    sendCommand(CMD_SET, P_LUFT, status.luft ? 0 : 1);
  } else if (hit(BTN_MENU, x, y)) {
    screen = SCR_SETTINGS;
    invalidate();
  }
}

void pollTouch() {
  static bool wasDown = false;
  static uint32_t lastTap = 0;
  int16_t x, y;
  bool down = readTouch(x, y);
  if (down && !wasDown && millis() - lastTap > 250) {
    lastTap = millis();
    onTap(x, y);
  }
  wasDown = down;
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  tft.init();
  tft.setRotation(1);  // liggende, samme som garasjepanelet
  tft.setBrightness(200);
  tft.fillScreen(TFT_BLACK);

  memset(&status, 0, sizeof(status));
  cmdSeq = esp_random();  // ny sekvens etter omstart, så kontrolleren ikke ignorerer oss
  setupRadio();
  Serial.print("Skjerm MAC: ");
  Serial.println(WiFi.macAddress());
  invalidate();
}

void loop() {
  if (statusFresh) {
    portENTER_CRITICAL(&statusMux);
    memcpy(&status, &rxStatus, sizeof(StatusMsg));
    statusFresh = false;
    portEXIT_CRITICAL(&statusMux);
    haveStatus = true;
    statusAt = millis();
  }

  pollTouch();
  render();
  delay(10);
}
