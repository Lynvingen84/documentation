# Skyteprogram – lysstyring for pistolskyting (ESP32-C6 + touch-skjerm)

Lysanlegg med rødt og grønt lys som kjører VM-/ISSF-programmer for pistol.
Anlegget har to deler:

| Enhet | Oppgave |
|---|---|
| **ESP32-C6** (`skyte_kontroller/`) | Styrer rødt og grønt lys (og en summer) med nøyaktig timing. Husker innstillingene. |
| **ESP32 med touch-skjerm** (`skyte_skjerm/`) | Fjernkontroll: velg program, START/STOPP, bytt mellom 25m og luftpistol, juster tider. |

De to snakker trådløst med **ESP-NOW**. Det trengs ingen ruter eller WiFi-nett,
og rekkevidden er typisk 50–100 m innendørs.

## Programmer

| Program | Forløp (etter ladetid) |
|---|---|
| **Duell** | 5 × (rødt 7 s → grønt 3 s), ett skudd per grønt lys |
| **Duell med LUFT** | 5 × (rødt **15 s** → grønt 3 s), så du rekker å lade luftpistolen mellom skuddene |
| Presisjon 5 min | rødt 7 s → grønt 300 s |
| Standard 150 / 20 / 10 s | rødt 7 s → grønt 150 / 20 / 10 s |
| Silhuett 8 / 6 / 4 s | rødt 7 s → grønt 8 / 6 / 4 s |

Før hver serie kommer en **ladetid** (LAD!, rødt lys), som er 60 s med mindre du endrer den.
Rødt lys betyr at du ikke får skyte. Grønt lys betyr skyt. Rødt lys står på også når anlegget venter.

### Luftpistol
Trykk **25m/LUFT**-knappen på skjermen for å bytte modus. I LUFT-modus bruker duellen
en lengre rød pause mellom skuddene. Den er 15 s med mindre du endrer den, og under **MENY** kan du stille den fra 5 til 60 s.

### Innstillinger (MENY)
| Innstilling | Område | Standard |
|---|---|---|
| Luft: rød pause | 5–60 s | 15 s |
| Ladetid | 0–120 s (0 = ingen) | 60 s |
| Duell: grønt | 1,0–10,0 s | 3,0 s |

Innstillingene lagres i ESP32-C6 og blir husket etter strømbrudd.

## Maskinvare

- ESP32-C6-DevKitC-1 (eller annet C6-kort)
- ESP32-2432S028R, "Cheap Yellow Display" (2,8" ILI9341 med touch). Andre skjermer går også, men da må du endre pinner og driver.
- Rød og grønn lampe (f.eks. 12 V LED-lamper)
- 2 × logic-level MOSFET (f.eks. IRLZ44N / AO3400) **eller** en 2-kanals relémodul
- Valgfritt: aktiv summer (5 V/3,3 V) for pip ved grønt lys og når serien er ferdig

### Kobling ESP32-C6

| C6-pinne | Til |
|---|---|
| GPIO 4 | Rød lampe (via MOSFET/relé) |
| GPIO 5 | Grønn lampe (via MOSFET/relé) |
| GPIO 6 | Summer (+), via transistor hvis summeren trekker mer enn ~20 mA |
| GPIO 9 | BOOT-knappen på kortet: start/stopp uten skjerm |
| GND | Felles jord med lampe-strømforsyningen (gjelder MOSFET) |

```
 12V+ ──── Lampe ────┐
                     D
 GPIO4 ── 220Ω ──── G   MOSFET (IRLZ44N)
          10kΩ til GND  S
                     │
 GND (C6) ───────────┴──── 12V-
```

> ⚠️ Lamper skal **aldri** kobles rett på GPIO-pinnene. Bruker du lamper på 230 V,
> må du ha en ferdig relémodul med godkjent isolasjon, og arbeidet bør gjøres av en fagperson.

Relémoduler er ofte *aktiv lav*. I så fall setter du `OUTPUT_ACTIVE_HIGH = false`
i `skyte_kontroller.ino`.

Den innebygde RGB-LED-en på C6-kortet lyser i samme farge som lampene, så du kan teste uten lamper.

## Installering

### Med PlatformIO (anbefalt)
```bash
cd skyte_kontroller && pio run -t upload && pio device monitor
cd skyte_skjerm     && pio run -t upload
```
Alt oppsett ligger i `platformio.ini`, også TFT-oppsettet for skjermen.

### Med Arduino IDE
1. Kopier mappen `libraries/SkyteProtokoll` til `Dokumenter/Arduino/libraries/`.
2. **Kontroller:** installer *esp32 by Espressif* **versjon 3.x** under Boards Manager.
   Velg kortet *ESP32C6 Dev Module* og last opp `skyte_kontroller/skyte_kontroller.ino`.
3. **Skjerm:** installer bibliotekene *TFT_eSPI* (Bodmer) og *XPT2046_Touchscreen* (Paul Stoffregen).
   Erstatt innholdet i `Arduino/libraries/TFT_eSPI/User_Setup.h` med `skyte_skjerm/User_Setup_CYD.h`.
   Velg kortet *ESP32 Dev Module* og last opp `skyte_skjerm/skyte_skjerm.ino`.

## Bruk
1. Slå på begge enhetene. Øverst til høyre på skjermen står antall serier når den har kontakt med kontrolleren.
2. Velg program med **<** og **>**.
3. Trykk **25m/LUFT** for å velge våpen.
4. Trykk **START**. Skjermen viser fase (LAD! / VENT / SKYT! / FERDIG), nedtelling og skuddnummer.
5. **STOPP** avbryter serien med en gang. De andre knappene er låst mens en serie går.

## Feilsøking

| Problem | Løsning |
|---|---|
| "Ingen kontakt" | Sjekk at begge enhetene har samme `ESPNOW_CHANNEL` og `SKYTE_GROUP` i `SkyteProtokoll.h`. |
| To anlegg i samme hall forstyrrer hverandre | Gi hvert anlegg sin egen `SKYTE_GROUP`. |
| Skjermen er hvit eller viser feil farger | Bytt `ILI9341_2_DRIVER` til `ILI9341_DRIVER` eller `ST7789_DRIVER`. Noen CYD-varianter trenger også `tft.invertDisplay(true)`. |
| Touch treffer feil sted | Juster `TOUCH_X_MIN/MAX` og `TOUCH_Y_MIN/MAX` i `skyte_skjerm.ino`. Er aksene speilvendt, bytter du min og max. |
| Lampene er "omvendt" | Sett `OUTPUT_ACTIVE_HIGH = false`. |

## Test av tidsmotoren på PC
```bash
cd test
g++ -std=c++17 -I../libraries/SkyteProtokoll/src -I../skyte_kontroller test_engine.cpp && ./a.out
```

## Nye programmer
Programmer legges til i tabellen `PROGRAMS[]` i
`libraries/SkyteProtokoll/src/SkyteProtokoll.h`. Begge enhetene må lastes opp på nytt etterpå.
