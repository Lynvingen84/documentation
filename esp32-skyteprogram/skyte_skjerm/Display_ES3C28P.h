// LovyanGFX-oppsett for LCDWIKI ES3C28P
// ESP32-S3, 2,8" 240x320 ILI9341V (SPI) + FT6336 kapasitiv touch (I2C).
// Pinnene er de samme som i garasjepanelet.
#pragma once

#define LGFX_USE_V1
#include <LovyanGFX.hpp>

class LGFX_ES3C28P : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9341 panel_;
  lgfx::Bus_SPI bus_;
  lgfx::Light_PWM light_;
  lgfx::Touch_FT5x06 touch_;  // FT6336 bruker samme protokoll

 public:
  LGFX_ES3C28P() {
    {
      auto cfg = bus_.config();
      cfg.spi_host = SPI2_HOST;
      cfg.spi_mode = 0;
      cfg.freq_write = 40000000;
      cfg.freq_read = 16000000;
      cfg.spi_3wire = false;
      cfg.use_lock = true;
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk = 12;
      cfg.pin_mosi = 11;
      cfg.pin_miso = 13;
      cfg.pin_dc = 46;
      bus_.config(cfg);
      panel_.setBus(&bus_);
    }
    {
      auto cfg = panel_.config();
      cfg.pin_cs = 10;
      cfg.pin_rst = -1;
      cfg.pin_busy = -1;
      cfg.panel_width = 240;
      cfg.panel_height = 320;
      cfg.offset_x = 0;
      cfg.offset_y = 0;
      cfg.offset_rotation = 0;
      cfg.readable = true;
      cfg.invert = true;      // som invert_colors: true i garasjepanelet
      cfg.rgb_order = false;  // sett true hvis rødt og blått er byttet om
      cfg.dlen_16bit = false;
      cfg.bus_shared = false;
      panel_.config(cfg);
    }
    {
      auto cfg = light_.config();
      cfg.pin_bl = 45;
      cfg.invert = false;
      cfg.freq = 12000;
      cfg.pwm_channel = 7;
      light_.config(cfg);
      panel_.setLight(&light_);
    }
    {
      auto cfg = touch_.config();
      cfg.x_min = 0;
      cfg.x_max = 239;
      cfg.y_min = 0;
      cfg.y_max = 319;
      cfg.pin_int = 17;
      cfg.bus_shared = false;
      cfg.offset_rotation = 0;  // juster (0-7) hvis trykk havner feil sted
      cfg.i2c_port = 1;
      cfg.i2c_addr = 0x38;
      cfg.pin_sda = 16;
      cfg.pin_scl = 15;
      cfg.freq = 400000;
      touch_.config(cfg);
      panel_.setTouch(&touch_);
    }
    setPanel(&panel_);
  }
};
