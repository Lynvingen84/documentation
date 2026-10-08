// Egen fil fordi Arduino lager funksjonsprototyper øverst i .ino-filen,
// før typer som er definert lenger ned.
#pragma once

#include <stdint.h>

struct Button {
  int16_t x, y, w, h;
};
