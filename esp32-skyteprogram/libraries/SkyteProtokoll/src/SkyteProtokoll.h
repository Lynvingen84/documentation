// Felles protokoll, programliste og innstillinger for skyteanlegget.
// Brukes av både kontrolleren (ESP32-C6) og skjermen (ESP32 med touch).
#pragma once

#include <stdint.h>
#include <stdio.h>

// ---------------------------------------------------------------------------
// Radio (ESP-NOW)
// ---------------------------------------------------------------------------
#define SKYTE_MAGIC 0x5348    // "SH"
#define SKYTE_VERSION 1
#define ESPNOW_CHANNEL 1      // Begge enhetene må bruke samme kanal
#define SKYTE_GROUP 1         // Endre (1-255) hvis flere anlegg står i samme hall

enum MsgType : uint8_t { MSG_STATUS = 1, MSG_CMD = 2 };

enum Command : uint8_t {
  CMD_START = 1,
  CMD_STOP = 2,
  CMD_SELECT = 3,  // arg = programnummer
  CMD_SET = 4,     // arg = Param, value = ny verdi
};

enum Param : uint8_t {
  P_LUFT = 0,          // 0 = 25m (7 s rødt), 1 = luftpistol (lang rød pause)
  P_LUFT_RED_S = 1,    // rød pause i duell når luftpistol er valgt (sekunder)
  P_LOAD_S = 2,        // ladetid før serien (sekunder, 0 = ingen)
  P_DUEL_GREEN_DS = 3, // grønt lys i duell (tideler sekund)
  P_COUNT
};

enum Light : uint8_t { L_OFF = 0, L_RED = 1, L_GREEN = 2 };

enum Phase : uint8_t {
  PH_IDLE = 0,  // venter på start
  PH_LOAD = 1,  // "LAD" - ladetid
  PH_WAIT = 2,  // rødt lys - "ATTENTION" / pause mellom skudd
  PH_FIRE = 3,  // grønt lys - skyt
  PH_DONE = 4,  // serie ferdig
};

struct __attribute__((packed)) MsgHeader {
  uint16_t magic;
  uint8_t version;
  uint8_t type;
  uint8_t group;
};

struct __attribute__((packed)) StatusMsg {
  MsgHeader h;
  uint8_t running;
  uint8_t program;
  uint8_t phase;
  uint8_t light;
  uint8_t shot;          // gjeldende skudd (1..shots), 0 = ikke aktuelt
  uint8_t shots;
  uint32_t remainingMs;  // tid igjen av gjeldende fase
  uint16_t seriesDone;   // antall fullførte serier siden oppstart
  uint8_t luft;
  uint8_t luftRedS;
  uint8_t loadS;
  uint8_t duelGreenDs;
};

struct __attribute__((packed)) CmdMsg {
  MsgHeader h;
  uint8_t cmd;
  uint8_t arg;
  int16_t value;
  uint32_t seq;  // samme seq sendes flere ganger for sikkerhets skyld
};

inline void fillHeader(MsgHeader& h, uint8_t type) {
  h.magic = SKYTE_MAGIC;
  h.version = SKYTE_VERSION;
  h.type = type;
  h.group = SKYTE_GROUP;
}

inline bool headerValid(const MsgHeader& h, uint8_t type) {
  return h.magic == SKYTE_MAGIC && h.version == SKYTE_VERSION &&
         h.type == type && h.group == SKYTE_GROUP;
}

// ---------------------------------------------------------------------------
// Innstillinger
// ---------------------------------------------------------------------------
struct Settings {
  uint8_t luft;
  uint8_t luftRedS;
  uint8_t loadS;
  uint8_t duelGreenDs;
};

struct ParamLimits {
  int16_t min, max, step, def;
};

static const ParamLimits PARAM_LIMITS[P_COUNT] = {
    {0, 1, 1, 0},       // P_LUFT
    {5, 60, 1, 15},     // P_LUFT_RED_S
    {0, 120, 10, 60},   // P_LOAD_S
    {10, 100, 5, 30},   // P_DUEL_GREEN_DS (1,0 - 10,0 s)
};

inline int16_t clampParam(uint8_t p, int16_t v) {
  if (p >= P_COUNT) return 0;
  if (v < PARAM_LIMITS[p].min) return PARAM_LIMITS[p].min;
  if (v > PARAM_LIMITS[p].max) return PARAM_LIMITS[p].max;
  return v;
}

inline int16_t getParam(const Settings& s, uint8_t p) {
  switch (p) {
    case P_LUFT: return s.luft;
    case P_LUFT_RED_S: return s.luftRedS;
    case P_LOAD_S: return s.loadS;
    case P_DUEL_GREEN_DS: return s.duelGreenDs;
  }
  return 0;
}

inline void setParam(Settings& s, uint8_t p, int16_t v) {
  v = clampParam(p, v);
  switch (p) {
    case P_LUFT: s.luft = (uint8_t)v; break;
    case P_LUFT_RED_S: s.luftRedS = (uint8_t)v; break;
    case P_LOAD_S: s.loadS = (uint8_t)v; break;
    case P_DUEL_GREEN_DS: s.duelGreenDs = (uint8_t)v; break;
  }
}

inline Settings defaultSettings() {
  Settings s;
  for (uint8_t p = 0; p < P_COUNT; p++) setParam(s, p, PARAM_LIMITS[p].def);
  return s;
}

// ---------------------------------------------------------------------------
// Programmer (ISSF / VM-tider)
// ---------------------------------------------------------------------------
#define MAX_SHOTS 10
#define ATTENTION_MS 7000UL  // rødt lys etter "ATTENTION" (ISSF: 7 s)
#define DUEL_RED_MS 7000UL   // rødt mellom skudd i duell (ISSF: 7 s)

enum ProgramKind : uint8_t {
  PK_DUEL,    // N x (rødt pause + grønt vindu), ett skudd per grønt
  PK_SERIES,  // rødt 7 s, deretter ett grønt vindu for hele serien
};

struct ProgramDef {
  const char* name;
  ProgramKind kind;
  uint32_t greenMs;  // brukes for PK_SERIES (duell bruker innstillingen)
  uint8_t shots;
};

static const ProgramDef PROGRAMS[] = {
    {"Duell", PK_DUEL, 0, 5},                  // 25m pistol / grovpistol, hurtigdel
    {"Presisjon 5 min", PK_SERIES, 300000, 5}, // 25m pistol, presisjonsdel
    {"Standard 150 s", PK_SERIES, 150000, 5},  // standardpistol
    {"Standard 20 s", PK_SERIES, 20000, 5},
    {"Standard 10 s", PK_SERIES, 10000, 5},
    {"Silhuett 8 s", PK_SERIES, 8000, 5},      // 25m hurtigpistol (silhuett)
    {"Silhuett 6 s", PK_SERIES, 6000, 5},
    {"Silhuett 4 s", PK_SERIES, 4000, 5},
};

static const uint8_t PROGRAM_COUNT = sizeof(PROGRAMS) / sizeof(PROGRAMS[0]);

inline uint32_t duelRedMs(const Settings& s) {
  return s.luft ? s.luftRedS * 1000UL : DUEL_RED_MS;
}

inline uint32_t duelGreenMs(const Settings& s) { return s.duelGreenDs * 100UL; }

// Kort beskrivelse av programmet, f.eks. "5 x (15s rodt / 3.0s gront)".
// Skjermfontene har ikke æøå, derfor skrives det uten.
inline void describeProgram(uint8_t prog, const Settings& s, char* buf, size_t len) {
  if (prog >= PROGRAM_COUNT) prog = 0;
  const ProgramDef& p = PROGRAMS[prog];
  if (p.kind == PK_DUEL) {
    snprintf(buf, len, "%u x (%lus rodt / %u.%us gront)", p.shots,
             (unsigned long)(duelRedMs(s) / 1000), s.duelGreenDs / 10,
             s.duelGreenDs % 10);
  } else {
    snprintf(buf, len, "%u skudd, 7s rodt + %lus gront", p.shots,
             (unsigned long)(p.greenMs / 1000));
  }
}
