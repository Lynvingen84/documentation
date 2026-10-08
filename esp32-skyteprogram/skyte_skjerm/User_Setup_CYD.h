// Kun for Arduino IDE: kopier innholdet til
// Arduino/libraries/TFT_eSPI/User_Setup.h (erstatt alt som står der).
// PlatformIO bruker build_flags i platformio.ini i stedet.
#define USER_SETUP_LOADED

#define ILI9341_2_DRIVER   // Prøv ILI9341_DRIVER eller ST7789_DRIVER hvis bildet er feil
#define TFT_WIDTH 240
#define TFT_HEIGHT 320
#define USE_HSPI_PORT

#define TFT_MISO 12
#define TFT_MOSI 13
#define TFT_SCLK 14
#define TFT_CS 15
#define TFT_DC 2
#define TFT_RST -1
#define TFT_BL 21
#define TFT_BACKLIGHT_ON HIGH

#define LOAD_GLCD
#define LOAD_FONT2
#define LOAD_FONT4
#define LOAD_FONT7

#define SPI_FREQUENCY 55000000
#define SPI_READ_FREQUENCY 20000000
