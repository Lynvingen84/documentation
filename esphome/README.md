# Garasjeport – ESPHome

Styring av Somfy Dexxo Smart io via Home Assistant, med fysisk knapp
og RGB-statuslampe på en Seeed XIAO ESP32-C6.

## Filer

| Fil | Innhold |
| --- | --- |
| `garasjeport.yaml` | Selve ESPHome-konfigurasjonen |
| `secrets.yaml.example` | Mal for hemmeligheter – kopier til `secrets.yaml` |

`secrets.yaml` er gitignorert og skal aldri committes.

## Kom i gang

```bash
cp secrets.yaml.example secrets.yaml   # fyll inn ekte verdier
esphome config garasjeport.yaml        # valider uten aa bygge
esphome run garasjeport.yaml           # bygg og flash
```

Første flashing må gå over USB. API-kryptering og OTA-passord gjør at
Home Assistant vil be om den nye nøkkelen når enheten kommer opp igjen.

## Maskinvare

| Funksjon | Pinne | XIAO-merking |
| --- | --- | --- |
| Knapp (mot GND) | GPIO1 | D1 |
| LED rød | GPIO16 | D6 |
| LED grønn | GPIO23 | D5 |
| LED blå | GPIO22 | D4 |

LED-en er common cathode: felles pinne går via motstand til GND.

`logger` kjører med `baud_rate: 0`. GPIO16 er UART0 TX på ESP32-C6, og
uten dette blafrer rød LED i takt med loggutskrift. Loggen er fortsatt
tilgjengelig over API med `esphome logs garasjeport.yaml`.

### Avstøying av GPIO1 – ikke valgfritt

GPIO1 er en høyohmig inngang med bare intern pull-up på rundt 45 kΩ.
Med en lang ledning ut til bryteren blir den en antenne, og radiostøy
fra WiFi kan utløse falske trykk som åpner porten.

* 10 kΩ fra GPIO1 til 3V3 (ekstern pull-up)
* 100 nF fra GPIO1 til GND, så nær kortet som mulig
* Tvunnet par eller skjermet kabel ut til bryteren, GND som retur

Filtrene i konfigurasjonen (`delayed_on: 100ms`) og armeringslogikken
demper symptomet, men erstatter ikke dette.

## Betjening

| Handling | Resultat |
| --- | --- |
| Ett trykk, port lukket | Åpner helt |
| Ett trykk, port åpen | Lukker helt |
| Ett trykk mens porten kjører | Stopper umiddelbart |
| Ett trykk etter stopp | Reverserer forrige retning |
| Dobbelttrykk | Kjører til 50 % |

### Statuslampe

| Farge | Betydning |
| --- | --- |
| Grønn | Helt lukket |
| Rød | Helt åpen |
| Blå | Kjører, eller står delvis åpen |
| Blinkende rød | Systemet er ikke armert – knappen er sperret |

## Armering

Portkommandoer er sperret til systemet er armert. Armering krever at
WiFi er oppe, at en API-klient er tilkoblet, at Home Assistant har sendt
gyldig portstatus, og at knappen har vært sluppet i tre sammenhengende
sekunder. Slår sjekken feil, prøver den på nytt i stedet for å gi opp.

Formålet er at en omstart, et strømbrudd eller en WiFi-reconnect ikke
skal kunne åpne porten. En enkelt stikkprøve av inngangen er ikke nok –
en ustabil inngang treffer lett et rolig øyeblikk og slipper gjennom.
