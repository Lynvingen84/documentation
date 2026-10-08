// PC-test av tidsmotoren:  g++ -std=c++17 -I../libraries/SkyteProtokoll/src -I../skyte_kontroller test_engine.cpp && ./a.out
#include <cassert>
#include <cstdio>

#include "ShotEngine.h"

static uint32_t greenTotal(ShotEngine& e, uint32_t from, uint32_t to, int* greens) {
  uint32_t total = 0;
  *greens = 0;
  for (uint32_t t = from; t <= to; t++) {
    EngineEvent ev = e.update(t);
    if (ev == EV_GREEN) (*greens)++;
    if (e.light() == L_GREEN) total++;
  }
  return total;
}

int main() {
  Settings s = defaultSettings();
  assert(s.luftRedS == 15 && s.loadS == 60 && s.duelGreenDs == 30 && s.luft == 0);

  // Duell 25m: 60 s lad + 5 x (7 s rødt + 3 s grønt) = 110 s
  ShotEngine e;
  e.start(0, s, 1000);
  assert(e.phase() == PH_LOAD && e.light() == L_RED);
  int greens;
  uint32_t g = greenTotal(e, 1000, 1000 + 110000, &greens);
  assert(greens == 5);
  assert(g == 5 * 3000);
  assert(!e.running() && e.phase() == PH_DONE && e.seriesDone() == 1);

  // Duell luftpistol: 15 s rødt, ingen ladetid
  s.luft = 1;
  s.loadS = 0;
  e.start(0, s, 0);
  assert(e.phase() == PH_WAIT && e.shot() == 1);
  e.update(14999);
  assert(e.light() == L_RED);
  assert(e.update(15000) == EV_GREEN && e.light() == L_GREEN);
  assert(e.remainingMs(15000) == 3000);
  e.update(18000);
  assert(e.light() == L_RED && e.shot() == 2);
  assert(e.update(5 * 18000) == EV_DONE);

  // Standard 20 s: 7 s rødt, 20 s grønt
  e.start(3, s, 0);
  e.update(6999);
  assert(e.light() == L_RED);
  e.update(7000);
  assert(e.light() == L_GREEN && e.remainingMs(7000) == 20000);
  e.update(27000);
  assert(e.phase() == PH_DONE);

  // Stopp midt i serien
  e.start(1, s, 0);
  e.update(10000);
  e.stop();
  assert(!e.running() && e.phase() == PH_IDLE && e.light() == L_RED);

  // Grenser
  assert(clampParam(P_LUFT_RED_S, 100) == 60);
  assert(clampParam(P_DUEL_GREEN_DS, 0) == 10);

  char buf[48];
  describeProgram(0, s, buf, sizeof(buf));
  printf("%s\n", buf);
  printf("Alle tester OK\n");
  return 0;
}
