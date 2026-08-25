# Garasjeport-kontroller (ESPHome)

En liten ESPHome-node på en **Seeed Studio XIAO ESP32C6** som gir garasjeporten
en fysisk knapp og en RGB status-LED. Selve porten styres av
**Dexxo Smart io 800**, som allerede finnes som en `cover`-entitet i Home
Assistant. Noden sender kommandoer til Home Assistant og speiler tilstanden
tilbake på LEDen.

Konfigurasjonen ligger i [`garasjeport.yaml`](garasjeport.yaml).

## Maskinvare

| Funksjon    | XIAO-pin | GPIO   | Kobling                                  |
| ----------- | -------- | ------ | ---------------------------------------- |
| Knapp       | D1       | GPIO1  | Bryter mellom D1 og GND (intern pullup)  |
| LED rød     | D4       | GPIO22 | Anode -> D4                              |
| LED grønn   | D5       | GPIO23 | Anode -> D5                              |
| LED blå     | D6       | GPIO16 | Anode -> D6                              |

LEDen er en **common cathode** RGB-LED: den lengste pinnen går via motstand
til GND. Kun én farge er tent om gangen, så én motstand på felles katode er
nok.

> **Merk om D6/GPIO16:** på ESP32-C6 er GPIO16 også UART0 TX. ESPHome logger
> som standard over USB (`USB_SERIAL_JTAG`) på denne brikken, så pinnen er
> ledig - men `logger.hardware_uart` er satt eksplisitt i konfigurasjonen slik
> at en senere endring ikke stille stjeler pinnen fra den blå LEDen.

## Slik oppfører den seg

### Status-LED

| Farge | Betydning                                          |
| ----- | -------------------------------------------------- |
| Grønn | Porten er helt lukket                              |
| Rød   | Porten er helt åpen                                |
| Blå   | Porten beveger seg, eller står delvis åpen (f.eks. 50 %) |
| Mørk  | Ukjent tilstand, eller ingen forbindelse til Home Assistant |

Home Assistant rapporterer `open` både for helt åpen og delvis åpen port.
Derfor brukes attributtet `current_position` til å skille: posisjon mellom
1 % og 99 % regnes som delvis åpen og gir blå LED.

### Knapp

| Trykk        | Handling                                                     |
| ------------ | ------------------------------------------------------------ |
| Enkelttrykk  | Lukket port -> åpner helt. Åpen eller delvis åpen -> lukker helt. Beveger porten seg allerede, ignoreres trykket. |
| Dobbelttrykk | Kjører porten til 50 % (`cover.set_cover_position`)           |

Uten wifi- og API-forbindelse gjør knappen ingenting, men skriver en linje i
loggen.

## Oppsett

1. **Lag `secrets.yaml`:**

   ```bash
   cp secrets.yaml.example secrets.yaml
   ```

   Fyll inn wifi-navn og passord, generer en API-nøkkel og velg et
   OTA-passord. `secrets.yaml` er i `.gitignore` og skal aldri committes.

2. **Sjekk entity_id.** Porten er definert ett sted, i `substitutions`
   øverst i `garasjeport.yaml`:

   ```yaml
   substitutions:
     cover_entity: cover.dexxosmartio800
   ```

3. **Juster statisk IP** under `wifi.manual_ip` hvis nettverket ditt bruker et
   annet subnett enn `192.168.68.0/24`.

4. **Bygg og flash:**

   ```bash
   esphome run garasjeport.yaml
   ```

5. **I Home Assistant:** åpne ESPHome-enheten under *Innstillinger ->
   Enheter og tjenester*, og skru på **"Tillat at enheten utfører Home
   Assistant-handlinger"**. Uten dette blir `cover.open_cover`,
   `cover.close_cover` og `cover.set_cover_position` avvist, og knappen gjør
   ingenting selv om LEDen viser riktig status.

## Kjente begrensninger

- Dobbelttrykk krever at porten faktisk støtter posisjonering
  (`cover.set_cover_position`). Gjør den ikke det, avvises kommandoen i Home
  Assistant.
- Blå LED for "delvis åpen" krever at porten rapporterer attributtet
  `current_position`. Mangler attributtet, vises rød for enhver åpen port.
- LEDen speiler tilstanden slik Home Assistant kjenner den. Styres porten fra
  en original fjernkontroll, oppdateres LEDen først når Dexxo-integrasjonen
  har oppdatert entiteten.
