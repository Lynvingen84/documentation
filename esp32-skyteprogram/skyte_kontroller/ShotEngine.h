// Tidsmotor for lysprogrammene. Ren C++ uten Arduino-avhengigheter,
// slik at den kan testes på PC (se test/test_engine.cpp).
#pragma once

#include <stdint.h>

#include <SkyteProtokoll.h>

enum EngineEvent : uint8_t {
  EV_NONE = 0,
  EV_STEP,   // ny fase (rødt/lad)
  EV_GREEN,  // grønt lys tent
  EV_DONE,   // serien er ferdig
};

class ShotEngine {
 public:
  static const int MAX_STEPS = 2 * MAX_SHOTS + 2;

  void start(uint8_t program, const Settings& s, uint32_t now) {
    if (program >= PROGRAM_COUNT) program = 0;
    const ProgramDef& p = PROGRAMS[program];
    count_ = 0;
    if (s.loadS > 0) add(PH_LOAD, L_RED, 0, s.loadS * 1000UL);
    if (p.kind == PK_DUEL) {
      for (uint8_t i = 1; i <= p.shots && i <= MAX_SHOTS; i++) {
        add(PH_WAIT, L_RED, i, duelRedMs(s));
        add(PH_FIRE, L_GREEN, i, duelGreenMs(s));
      }
    } else {
      add(PH_WAIT, L_RED, 0, ATTENTION_MS);
      add(PH_FIRE, L_GREEN, 0, p.greenMs);
    }
    program_ = program;
    shots_ = p.shots;
    index_ = 0;
    stepStart_ = now;
    running_ = true;
    finished_ = false;
  }

  void stop() {
    running_ = false;
    finished_ = false;
  }

  // Kalles ofte fra loop(). Stegene kjedes på stepStart_ (ikke "now"),
  // så små forsinkelser i loop() ikke summeres opp over serien.
  EngineEvent update(uint32_t now) {
    EngineEvent ev = EV_NONE;
    while (running_ && (uint32_t)(now - stepStart_) >= steps_[index_].ms) {
      stepStart_ += steps_[index_].ms;
      index_++;
      if (index_ >= count_) {
        running_ = false;
        finished_ = true;
        seriesDone_++;
        ev = EV_DONE;
      } else {
        ev = steps_[index_].phase == PH_FIRE ? EV_GREEN : EV_STEP;
      }
    }
    return ev;
  }

  bool running() const { return running_; }
  uint8_t program() const { return program_; }
  uint8_t shots() const { return shots_; }
  uint16_t seriesDone() const { return seriesDone_; }

  uint8_t phase() const {
    if (running_) return steps_[index_].phase;
    return finished_ ? PH_DONE : PH_IDLE;
  }

  // Rødt lys når det ikke er lov å skyte.
  uint8_t light() const { return running_ ? steps_[index_].light : (uint8_t)L_RED; }

  uint8_t shot() const { return running_ ? steps_[index_].shot : 0; }

  uint32_t remainingMs(uint32_t now) const {
    if (!running_) return 0;
    uint32_t elapsed = now - stepStart_;
    return elapsed >= steps_[index_].ms ? 0 : steps_[index_].ms - elapsed;
  }

 private:
  struct Step {
    uint8_t phase;
    uint8_t light;
    uint8_t shot;
    uint32_t ms;
  };

  void add(uint8_t phase, uint8_t light, uint8_t shot, uint32_t ms) {
    if (count_ < MAX_STEPS) steps_[count_++] = {phase, light, shot, ms};
  }

  Step steps_[MAX_STEPS];
  int count_ = 0;
  int index_ = 0;
  uint32_t stepStart_ = 0;
  bool running_ = false;
  bool finished_ = false;
  uint8_t program_ = 0;
  uint8_t shots_ = 0;
  uint16_t seriesDone_ = 0;
};
