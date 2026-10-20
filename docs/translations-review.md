# Translations to review: Afrikaans and Setswana

AgroFlow's app and its most frequent Telegram messages now come in English, Afrikaans and
Setswana. **English is the source and is complete.** The Afrikaans and Setswana text is a
**first draft** and is marked `"needs_review": true` in the app; the language picker shows
both as "(beta)" until a first-language speaker has checked them.

## How to review

1. Read each row. Fix the wording in your column so a farmer would say it that way. Keep
   words in `{curly brackets}` exactly as they are: the app puts a number or name there.
2. Keep it short and plain. These are buttons and phone messages, not documents.
3. Leave technical words that farmers already use as they are (pH, Telegram, L, mm, C).
   Tab bar words (`tabs.*`) must fit about 9 letters at phone width, or the word is cut
   off ("Besproeii…"). The Afrikaans drafts already use short words; "Dithulaganyo"
   (Setswana, Settings) is still cut off and needs a shorter word.
4. Send the corrected table back, or edit the files directly:
   - app: `apps/mobile/src/i18n/af.json`, `apps/mobile/src/i18n/tn.json`
   - Telegram: `backend/AgroFlow.Api/Services/Notifications/BotText.cs`
5. When a language is checked, set `"needs_review": false` in its JSON file. The "(beta)"
   label then disappears by itself.

Tests check that every key exists in all three languages and that the `{placeholders}` match
(`sponsorMobile.test.tsx`, `SponsorMobileApiTests.cs`).

## Not translated yet

- Screens other than Home, a zone's Irrigate panel, Alerts, Settings, the tank and soil pH
  forms, the "I watered" / soil check sheet, the offline banner and the tab bar. They stay
  in English until their text is moved into the dictionaries.
- Telegram: only the zone-needs-water, tank-low and weather (rain, frost, heat) messages
  are translated. The "Why:" summary at the end of each, the day words ("tomorrow",
  "Monday"), sign-in messages, request updates and the bot's commands (/status, /help)
  are still English.
- Text that comes from the server inside the app is English: today’s advice on each
  zone card ("Water about 8 min this morning"), confidence reasons, alert wording, a
  tank-refill comparison, and errors the server explains.
- The raindrop helper’s greetings and the page help (the "?" button) are English.

## App (332 strings)

| Key | English | Afrikaans (draft) | Setswana (draft) |
|---|---|---|---|
| `common.cancel` | Cancel | Kanselleer | Khansela |
| `common.back` | Go back | Gaan terug | Boela morago |
| `common.saving` | Saving… | Stoor tans… | E a boloka… |
| `common.retry` | Try again | Probeer weer | Leka gape |
| `common.connected` | Connected | Gekoppel | E golagane |
| `common.notConnected` | Not connected | Nie gekoppel nie | Ga e a golagana |
| `offline.banner` | You're offline — showing data from {time} | Jy is vanlyn — wys data van {time} | Ga o mo inthaneteng — go bontshiwa tshedimosetso ya {time} |
| `offline.bannerNoData` | You're offline. Nothing has been saved on this phone yet. | Jy is vanlyn. Niks is nog op hierdie foon gestoor nie. | Ga o mo inthaneteng. Ga go sepe se se bolokilweng mo founung eno. |
| `offline.today` | today {time} | vandag {time} | gompieno {time} |
| `offline.yesterday` | yesterday {time} | gister {time} | maabane {time} |
| `offline.pending` | {count} saved on this phone, will be sent when you're back online | {count} op hierdie foon gestoor, word gestuur sodra jy weer aanlyn is | {count} di bolokilwe mo founung eno, di tla romelwa fa o boela mo inthaneteng |
| `offline.pendingOne` | 1 entry saved on this phone, will be sent when you're back online | 1 inskrywing op hierdie foon gestoor, word gestuur sodra jy weer aanlyn is | Se le sengwe se bolokilwe mo founung eno, se tla romelwa fa o boela mo inthaneteng |
| `offline.problem` | One saved entry could not be sent: {message} | Een gestoorde inskrywing kon nie gestuur word nie: {message} | Se le sengwe se se bolokilweng ga se a kgona go romelwa: {message} |
| `offline.savedForLater` | Saved on this phone. It will be sent when you're back online. | Op hierdie foon gestoor. Dit word gestuur sodra jy weer aanlyn is. | Go bolokilwe mo founung eno. Go tla romelwa fa o boela mo inthaneteng. |
| `offline.needsConnection` | Needs a connection to reach your kit | Het 'n verbinding nodig om jou toestel te bereik | Go tlhokega kgolagano go fitlha sedirisiwa sa gago |
| `offline.readOnly` | You're offline. This needs a connection — try again when you're back online. | Jy is vanlyn. Dit het 'n verbinding nodig — probeer weer wanneer jy aanlyn is. | Ga o mo inthaneteng. Se se tlhoka kgolagano — leka gape fa o boela mo inthaneteng. |
| `tabs.home` | Home | Tuis | Gae |
| `tabs.irrigation` | Irrigation | Water | Nosetso |
| `tabs.alerts` | Alerts | Alarms | Ditemoso |
| `tabs.history` | History | Logboek | Hisetori |
| `tabs.settings` | Settings | Instellings | Dithulaganyo |
| `home.subtitle` | Your farm at a glance. | Jou plaas in een oogopslag. | Polasi ya gago ka bonako. |
| `home.loadingFarm` | Loading farm information | Laai plaasinligting | E laola tshedimosetso ya polasi |
| `home.farmUnavailable` | Farm information unavailable | Plaasinligting nie beskikbaar nie | Tshedimosetso ya polasi ga e yo |
| `home.farmUnavailableBody` | We couldn't load the latest farm details. Your navigation and saved settings are still available. | Ons kon nie die nuutste plaasbesonderhede laai nie. Jou navigasie en gestoorde instellings is steeds beskikbaar. | Ga re a kgona go laola dintlha tsa bosheng tsa polasi. Dithulaganyo tsa gago tse di bolokilweng di sa ntse di le teng. |
| `home.noFarm` | No farm assigned yet | Nog geen plaas toegeken nie | Ga go ise go nne le polasi |
| `home.noFarmBody` | Your farm will appear here once it has been assigned to your account. | Jou plaas sal hier verskyn sodra dit aan jou rekening toegeken is. | Polasi ya gago e tla bonala fano fa e sena go tsenngwa mo akhaonteng ya gago. |
| `home.today` | Today | Vandag | Gompieno |
| `home.todayUnavailable` | Today's advice is unavailable | Vandag se advies is nie beskikbaar nie | Kgakololo ya gompieno ga e yo |
| `home.todayLoading` | Working out today's advice | Werk vandag se advies uit | E bala kgakololo ya gompieno |
| `home.noZones` | No zones set up yet | Nog geen sones opgestel nie | Ga go ise go nne le dikarolo |
| `home.noZonesToday` | Each zone will get its own card here. | Elke sone kry sy eie kaart hier. | Karolo nngwe le nngwe e tla nna le karata ya yone fano. |
| `home.tank` | Water tank | Watertenk | Tanka ya metsi |
| `home.tankUnavailable` | Tank estimate unavailable | Tenkskatting nie beskikbaar nie | Kakanyetso ya tanka ga e yo |
| `home.tankLeft` | About {litres} L left — estimate | Omtrent {litres} L oor — skatting | Go setse e ka nna {litres} L — kakanyetso |
| `home.tankNoRefill` | No refill logged yet | Nog geen hervulling aangeteken nie | Ga go ise go kwalwe go tladiwa |
| `home.tankNotSetUp` | Tank tracking is not set up yet | Tenkopsporing is nog nie opgestel nie | Tlhokomelo ya tanka ga e ise e baakanngwe |
| `home.tankLink` | Tank details and refill | Tenkbesonderhede en hervulling | Dintlha tsa tanka le go tlatsa |
| `home.farmStatus` | Farm status | Plaasstatus | Seemo sa polasi |
| `home.farmStatusLoading` | Loading farm status | Laai plaasstatus | E laola seemo sa polasi |
| `home.farmStatusUnavailable` | Farm status unavailable | Plaasstatus nie beskikbaar nie | Seemo sa polasi ga se yo |
| `home.noZonesStatus` | Sensor readings and irrigation activity will appear when a zone is connected. | Sensorlesings en besproeiing sal verskyn wanneer 'n sone gekoppel is. | Dipalo tsa disensara le nosetso di tla bonala fa karolo e golaganngwa. |
| `home.metricMoisture` | Avg soil moisture | Gem. grondvog | Bongola jwa mmu (palogare) |
| `home.metricIrrigating` | Irrigating | Besproei tans | E a nosetsa |
| `home.metricWater` | Recorded water today | Water vandag aangeteken | Metsi a a kwadilweng gompieno |
| `home.metricAlerts` | Unread alerts | Ongeleesde waarskuwings | Ditemoso tse di sa balwang |
| `home.unknown` | Unknown | Onbekend | Ga go itsiwe |
| `home.noData` | No data | Geen data | Ga go na tshedimosetso |
| `home.commandsAccepted` | {count} manual command(s) accepted.  | {count} handbevel(e) aanvaar.  | Ditaelo di le {count} tsa seatla di amogetswe.  |
| `home.noValveFeedback` | Live valve confirmation is unavailable. | Regstreekse klepbevestiging is nie beskikbaar nie. | Netefatso ya valofo ga e yo. |
| `home.quickActions` | Quick actions | Vinnige aksies | Ditiro tsa ka bonako |
| `home.waterAZone` | Water a zone | Gee water aan 'n sone | Nosetsa karolo |
| `home.weekAhead` | The week ahead | Die week vorentoe | Beke e e tlang |
| `home.viewAlerts` | View alerts | Sien waarskuwings | Bona ditemoso |
| `home.viewHistory` | View history | Sien geskiedenis | Bona hisetori |
| `home.logRefill` | Log a tank refill | Teken 'n tenkhervulling aan | Kwala go tladiwa ga tanka |
| `home.reports` | Reports | Verslae | Dipego |
| `home.settings` | Settings | Instellings | Dithulaganyo |
| `home.unread` | {count} unread | {count} ongelees | {count} tse di sa balwang |
| `zone.irrigationControl` | Irrigation control | Besproeiingsbeheer | Taolo ya nosetso |
| `zone.mode` | MODE | MODUS | MOKGWA |
| `zone.relay` | RELAY | RELAIS | RELEI |
| `zone.health` | HEALTH | TOESTAND | SEEMO |
| `zone.irrigationMode` | Irrigation mode | Besproeiingsmodus | Mokgwa wa nosetso |
| `zone.modeAutomatic` | Automatic | Outomaties | Ka boyona |
| `zone.modeScheduled` | Scheduled | Volgens skedule | Ka thulaganyo |
| `zone.modeManual` | Manual | Met die hand | Ka seatla |
| `zone.manualCommandSent` | Manual command sent | Handbevel gestuur | Taelo ya seatla e rometswe |
| `zone.manualRequest` | Manual request | Handversoek | Kopo ya seatla |
| `zone.duration` | How many minutes? | Hoeveel minute? | Metsotso e le kae? |
| `zone.startRun` | Water now | Gee nou water | Nosetsa jaanong |
| `zone.stopRun` | Stop watering | Stop water | Emisa go nosetsa |
| `zone.startConfirmTitle` | Water {zone} now? | Gee {zone} nou water? | Nosetsa {zone} jaanong? |
| `zone.startConfirmBody` | The pump runs for {minutes} minutes, then stops by itself. | Die pomp loop vir {minutes} minute en stop dan vanself. | Pompo e tla dira metsotso e le {minutes}, morago e ema ka boyona. |
| `zone.start` | Start | Begin | Simolola |
| `zone.stopConfirmTitle` | Stop watering {zone}? | Stop water vir {zone}? | Emisa go nosetsa {zone}? |
| `zone.stopConfirmBody` | The pump stops and the zone goes back to {mode}. | Die pomp stop en die sone gaan terug na {mode}. | Pompo e a ema mme karolo e boela go {mode}. |
| `zone.stop` | Stop | Stop | Emisa |
| `zone.invalidDurationTitle` | Check the minutes | Kyk na die minute | Tlhola metsotso |
| `zone.invalidDuration` | Enter between 1 and {max} minutes. This zone's pump is limited to {max} min per run. | Tik tussen 1 en {max} minute in. Hierdie sone se pomp is beperk tot {max} min per keer. | Kwala magareng ga 1 le metsotso e le {max}. Pompo ya karolo e e lekanyeditswe go metsotso e le {max} ka nako. |
| `zone.startFailed` | Could not start watering | Kon nie begin water gee nie | Ga go a kgonega go simolola go nosetsa |
| `zone.stopFailed` | Could not stop watering | Kon nie die water stop nie | Ga go a kgonega go emisa go nosetsa |
| `zone.commandFailed` | The command could not be sent. Please try again. | Die bevel kon nie gestuur word nie. Probeer asseblief weer. | Taelo ga e a kgona go romelwa. Tswee-tswee leka gape. |
| `zone.editSchedule` | Edit regular schedule | Wysig gereelde skedule | Fetola thulaganyo ya ka metlha |
| `zone.editThresholds` | Edit moisture levels | Wysig vogvlakke | Fetola maemo a bongola |
| `alerts.title` | Alerts | Waarskuwings | Ditemoso |
| `alerts.subtitle` | What needs your attention. | Wat jou aandag nodig het. | Se se tlhokang tlhokomelo ya gago. |
| `alerts.loading` | Loading alerts | Laai waarskuwings | E laola ditemoso |
| `alerts.unavailable` | Unable to load alerts | Kan nie waarskuwings laai nie | Ga go kgonege go laola ditemoso |
| `alerts.none` | No alerts right now | Geen waarskuwings nou nie | Ga go na ditemoso jaanong |
| `alerts.noneBody` | New alerts for this farm will appear here. | Nuwe waarskuwings vir hierdie plaas sal hier verskyn. | Ditemoso tse dintšhwa tsa polasi eno di tla bonala fano. |
| `settings.title` | Settings | Instellings | Dithulaganyo |
| `settings.subtitle` | Manage your AgroFlow preferences. | Bestuur jou AgroFlow-voorkeure. | Laola se o se ratang mo AgroFlow. |
| `settings.language` | Language | Taal | Puo |
| `settings.languageNote` | Afrikaans and Setswana are early translations and are still being checked. Telegram messages use the same language. | Afrikaans en Setswana is vroeë vertalings en word nog nagegaan. Telegram-boodskappe gebruik dieselfde taal. | Seaforikanse le Setswana ke diranolo tsa ntlha mme di sa ntse di tlhatlhobiwa. Melaetsa ya Telegram e dirisa puo e e tshwanang. |
| `settings.beta` | (beta) | (beta) | (beta) |
| `settings.appearance` | Appearance | Voorkoms | Ponalo |
| `settings.light` | Light | Lig | Lesedi |
| `settings.dark` | Dark | Donker | Lefifi |
| `settings.system` | System default | Stelsel se keuse | Ya sesole sa founu |
| `settings.currentTheme` | Currently using {mode} mode | Gebruik tans {mode} modus | Jaanong go dirisiwa mokgwa wa {mode} |
| `settings.themeLight` | light | ligte | lesedi |
| `settings.themeDark` | dark | donker | lefifi |
| `settings.notifications` | Notifications | Kennisgewings | Dikitsiso |
| `settings.notifIrrigation` | Irrigation | Besproeiing | Nosetso |
| `settings.notifIrrigationBody` | Start, stop and schedule updates | Begin, stop en skedule-opdaterings | Go simolola, go emisa le diphetogo tsa thulaganyo |
| `settings.notifMoisture` | Moisture alerts | Vogwaarskuwings | Ditemoso tsa bongola |
| `settings.notifMoistureBody` | Warnings when soil moisture needs attention | Waarskuwings wanneer grondvog aandag nodig het | Ditemoso fa bongola jwa mmu bo tlhoka tlhokomelo |
| `settings.notifWeather` | Weather alerts | Weerwaarskuwings | Ditemoso tsa bosa |
| `settings.notifWeatherBody` | Rain and weather-related irrigation updates | Reën en weerverwante besproeiingsopdaterings | Pula le diphetogo tsa nosetso tse di amanang le bosa |
| `settings.notifDevice` | Kit alerts | Toestelwaarskuwings | Ditemoso tsa sedirisiwa |
| `settings.notifDeviceBody` | Sensor, relay and water pump warnings | Sensor-, relais- en waterpompwaarskuwings | Ditemoso tsa sensara, relei le pompo ya metsi |
| `settings.notifNote` | Notification preferences are saved on this phone. | Kennisgewingvoorkeure word op hierdie foon gestoor. | Dikitsiso tse o di ratang di bolokilwe mo founung eno. |
| `settings.help` | Help | Hulp | Thuso |
| `settings.pageHelp` | Show page help | Wys bladsyhulp | Bontsha thuso ya tsebe |
| `settings.pageHelpBody` | Shows a "?" button on each page that explains what it does. | Wys 'n "?"-knoppie op elke bladsy wat verduidelik wat dit doen. | E bontsha konopo ya "?" mo tsebeng nngwe le nngwe e e tlhalosang se e se dirang. |
| `settings.raindrop` | Raindrop helper | Reëndruppel-helper | Mothusi wa lerothodi |
| `settings.raindropBody` | A friendly raindrop that greets you and points out the one thing that needs you most. | 'n Vriendelike reëndruppel wat jou groet en die een ding uitwys wat jou die meeste nodig het. | Lerothodi le le botsalano le le go dumedisang le go bontsha selo se se go tlhokang thata. |
| `settings.helpNote` | Help settings are saved on this phone. | Hulpinstellings word op hierdie foon gestoor. | Dithulaganyo tsa thuso di bolokilwe mo founung eno. |
| `settings.account` | Account | Rekening | Akhaonto |
| `settings.farmRequests` | Farm requests | Plaasversoeke | Dikopo tsa polasi |
| `settings.reports` | Reports | Verslae | Dipego |
| `settings.connectTelegram` | Connect Telegram | Koppel Telegram | Golaganya Telegram |
| `settings.unlinkTelegram` | Unlink Telegram | Ontkoppel Telegram | Kgaola Telegram |
| `settings.unlinkTitle` | Unlink Telegram? | Ontkoppel Telegram? | Kgaola Telegram? |
| `settings.unlinkBody` | AgroFlow will stop sending messages to the Telegram chat you have now. You can connect again with a new code at any time. | AgroFlow sal ophou om boodskappe na jou huidige Telegram-klets te stuur. Jy kan enige tyd weer met 'n nuwe kode koppel. | AgroFlow e tla emisa go romela melaetsa kwa puisanong ya Telegram e o nang le yone jaanong. O ka golagana gape ka khoutu e ntšhwa nako nngwe le nngwe. |
| `settings.unlinkConfirm` | Unlink | Ontkoppel | Kgaola |
| `settings.unlinked` | Telegram is unlinked. Connect again any time from Profile. | Telegram is ontkoppel. Koppel enige tyd weer vanaf Profiel. | Telegram e kgaotswe. Golagana gape nako nngwe le nngwe go tswa mo Porofaeleng. |
| `settings.unlinkFailed` | Telegram could not be unlinked. | Telegram kon nie ontkoppel word nie. | Telegram ga e a kgona go kgaolwa. |
| `settings.profile` | Profile | Profiel | Porofaele |
| `tank.title` | Water tank | Watertenk | Tanka ya metsi |
| `tank.estimateHelp` | Based on the last refill minus recorded pump time × each zone's flow rate. | Gebaseer op die laaste hervulling minus aangetekende pomptyd × elke sone se vloeitempo. | Go ikaegile ka go tladiwa ga bofelo go tlosiwa nako ya pompo × lebelo la go elela la karolo nngwe le nngwe. |
| `tank.latestPh` | Latest water pH: {ph} | Nuutste water-pH: {ph} | pH ya bosheng ya metsi: {ph} |
| `tank.noRefill` | No refill logged yet. | Nog geen hervulling aangeteken nie. | Ga go ise go kwalwe go tladiwa. |
| `tank.notSetUp` | Tank tracking is not set up yet. | Tenkopsporing is nog nie opgestel nie. | Tlhokomelo ya tanka ga e ise e baakanngwe. |
| `tank.size` | Tank size | Tenkgrootte | Bogolo jwa tanka |
| `tank.sizeLabel` | Tank size in litres | Tenkgrootte in liter | Bogolo jwa tanka ka dilitara |
| `tank.sizePlaceholder` | Size in litres | Grootte in liter | Bogolo ka dilitara |
| `tank.saveSize` | Save tank size | Stoor tenkgrootte | Boloka bogolo jwa tanka |
| `tank.sizeSaved` | Tank size saved. | Tenkgrootte gestoor. | Bogolo jwa tanka bo bolokilwe. |
| `tank.sizeInvalid` | Tank size must be more than 0 litres. | Tenkgrootte moet meer as 0 liter wees. | Bogolo jwa tanka bo tshwanetse go feta dilitara di le 0. |
| `tank.sizeFailed` | Could not save the tank size. | Kon nie die tenkgrootte stoor nie. | Ga go a kgonega go boloka bogolo jwa tanka. |
| `tank.logRefill` | Log a refill | Teken 'n hervulling aan | Kwala go tladiwa |
| `tank.litresAdded` | Litres added | Liter bygevoeg | Dilitara tse di okeditsweng |
| `tank.litresPlaceholder` | e.g. 750 | bv. 750 | sk. 750 |
| `tank.waterPh` | Water pH (optional) | Water-pH (opsioneel) | pH ya metsi (ga go gapeletswe) |
| `tank.phPlaceholder` | 0.0 to 14.0 | 0.0 tot 14.0 | 0.0 go ya go 14.0 |
| `tank.when` | When | Wanneer | Leng |
| `tank.whenNow` | Now | Nou | Jaanong |
| `tank.whenHelp` | Leave as now, or type another date and time. | Los dit as nou, of tik 'n ander datum en tyd in. | Tlogela e le jaanong, kgotsa kwala letlha le nako e nngwe. |
| `tank.save` | Log refill | Teken hervulling aan | Kwala go tladiwa |
| `tank.saved` | Refill logged. | Hervulling aangeteken. | Go tladiwa go kwadilwe. |
| `tank.needSize` | Set the tank size before logging a refill. | Stel die tenkgrootte voordat jy 'n hervulling aanteken. | Baya bogolo jwa tanka pele o kwala go tladiwa. |
| `tank.litresInvalid` | Litres added must be more than 0. | Liter bygevoeg moet meer as 0 wees. | Dilitara tse di okeditsweng di tshwanetse go feta 0. |
| `tank.litresTooMany` | Litres added cannot be more than the tank size. | Liter bygevoeg kan nie meer as die tenkgrootte wees nie. | Dilitara tse di okeditsweng di ka se fete bogolo jwa tanka. |
| `tank.phInvalid` | pH must be between 0 and 14. | pH moet tussen 0 en 14 wees. | pH e tshwanetse go nna magareng ga 0 le 14. |
| `tank.whenInvalid` | Enter a valid date and time. | Tik 'n geldige datum en tyd in. | Tsenya letlha le nako tse di siameng. |
| `tank.loadFailed` | Could not load the tank details. | Kon nie die tenkbesonderhede laai nie. | Ga go a kgonega go laola dintlha tsa tanka. |
| `tank.refillFailed` | Could not log the refill. | Kon nie die hervulling aanteken nie. | Ga go a kgonega go kwala go tladiwa. |
| `ph.title` | Soil pH | Grond-pH | pH ya mmu |
| `ph.measured` | Measured {date} | Gemeet op {date} | E lekantswe ka {date} |
| `ph.none` | No soil pH has been logged for this zone. | Geen grond-pH is nog vir hierdie sone aangeteken nie. | Ga go ise go kwalwe pH ya mmu mo karolong eno. |
| `ph.label` | Soil pH | Grond-pH | pH ya mmu |
| `ph.placeholder` | pH, e.g. 6.8 | pH, bv. 6.8 | pH, sk. 6.8 |
| `ph.note` | Optional note | Opsionele nota | Ntlha (ga e gapeletswe) |
| `ph.save` | Log soil pH | Teken grond-pH aan | Kwala pH ya mmu |
| `ph.saved` | Soil pH saved. | Grond-pH gestoor. | pH ya mmu e bolokilwe. |
| `ph.invalid` | pH must be between 0 and 14. | pH moet tussen 0 en 14 wees. | pH e tshwanetse go nna magareng ga 0 le 14. |
| `ph.failed` | Could not save the soil pH. | Kon nie die grond-pH stoor nie. | Ga go a kgonega go boloka pH ya mmu. |
| `ph.loadFailed` | Could not load the soil pH history. | Kon nie die grond-pH-geskiedenis laai nie. | Ga go a kgonega go laola hisetori ya pH ya mmu. |
| `ph.history` | History | Geskiedenis | Hisetori |
| `log.wateredTitle` | I watered {zone} | Ek het {zone} water gegee | Ke nositse {zone} |
| `log.feelTitle` | How does the soil feel? {zone} | Hoe voel die grond? {zone} | Mmu o ikutlwa jang? {zone} |
| `log.howLong` | About how long did you water? | Omtrent hoe lank het jy water gegee? | O nositse lobaka lo lo kae? |
| `log.minutes` | {minutes} min | {minutes} min | {minutes} mets. |
| `log.wateredFor` | I watered for {minutes} minutes | Ek het vir {minutes} minute water gegee | Ke nositse metsotso e le {minutes} |
| `log.orLitres` | Or roughly how many litres? | Of omtrent hoeveel liter? | Kgotsa dilitara di ka nna kae? |
| `log.litresLabel` | Litres watered | Liter water gegee | Dilitara tse di nositsweng |
| `log.litresPlaceholder` | e.g. 10 | bv. 10 | sk. 10 |
| `log.saveLitres` | Save litres | Stoor liter | Boloka dilitara |
| `log.feelIntro` | Push a finger into the soil, about two knuckles deep. | Druk 'n vinger in die grond, omtrent twee kneukels diep. | Tsenya monwana mo mmung, e ka nna makoko a mabedi a monwana. |
| `log.dry` | Dry | Droog | O omile |
| `log.dryHint` | Crumbles, no dampness on your finger | Verkrummel, geen vog aan jou vinger nie | O a phatlologa, ga go bongola mo monwaneng |
| `log.moist` | Moist | Klam | O bongola |
| `log.moistHint` | Cool and holds together | Koel en hou saam | O tsiditse mme o a kopana |
| `log.wet` | Wet | Nat | O metsi |
| `log.wetHint` | Sticky, water on your finger | Taai, water aan jou vinger | O a kgomarela, go na le metsi mo monwaneng |
| `log.feels` | The soil feels {feel} | Die grond voel {feel} | Mmu o ikutlwa {feel} |
| `log.failed` | Could not save that right now. | Kon dit nie nou stoor nie. | Ga go a kgonega go boloka seo jaanong. |
| `today.confHigh` | High confidence | Hoë vertroue | Boikanyo jo bo kwa godimo |
| `today.confMedium` | Medium confidence | Middelmatige vertroue | Boikanyo jo bo magareng |
| `today.confLow` | Low confidence | Lae vertroue | Boikanyo jo bo kwa tlase |
| `today.confidenceA11y` | Advice confidence: {level}. {reason} | Vertroue in die advies: {level}. {reason} | Boikanyo mo kgakololong: {level}. {reason} |
| `today.iWatered` | I watered | Ek het water gegee | Ke nositse |
| `today.soilFeel` | How does the soil feel? | Hoe voel die grond? | Mmu o ikutlwa jang? |
| `today.finishSetup` | Finish setup | Voltooi opstelling | Fetsa go baakanya |
| `today.finishSetupFor` | Finish setup for {zone} | Voltooi opstelling vir {zone} | Fetsa go baakanya {zone} |
| `farm.current` | CURRENT FARM | HUIDIGE PLAAS | POLASI YA JAANONG |
| `farm.loading` | Loading farm… | Laai plaas… | E laola polasi… |
| `farm.unavailable` | Farm unavailable · Retry | Plaas nie beskikbaar nie · Probeer weer | Polasi ga e yo · Leka gape |
| `farm.none` | No farm assigned | Geen plaas toegeken nie | Ga go na polasi |
| `farm.simulated` | Simulated | Gesimuleer | Ya ketsiso |
| `farm.select` | Select a farm | Kies 'n plaas | Tlhopha polasi |
| `farm.retryA11y` | Retry loading farms | Probeer weer om plase te laai | Leka gape go laola dipolasi |
| `farm.selectA11y` | Select farm, current farm {name} | Kies plaas, huidige plaas {name} | Tlhopha polasi, polasi ya jaanong {name} |
| `zone.manualNote` | Manual: AgroFlow will not water this zone by itself. Use Water now when it needs water. | Met die hand: AgroFlow gee hierdie sone nie self water nie. Gebruik Gee nou water wanneer dit water nodig het. | Ka seatla: AgroFlow ga e nosetse karolo eno ka boyona. Dirisa Nosetsa jaanong fa e tlhoka metsi. |
| `setup.progress` | Step {n} of {of} | Stap {n} van {of} | Kgato {n} ya {of} |
| `setup.back` | Back | Terug | Morago |
| `setup.later` | Do this later | Doen dit later | Dira se moragonyana |
| `setup.continue` | Continue | Gaan voort | Tswelela |
| `setup.tip` | Drip's tip | Drip se wenk | Kgakololo ya Drip |
| `setup.title` | Set up your farm | Stel jou plaas op | Baakanya polasi ya gago |
| `setup.welcome.title` | Welcome to AgroFlow | Welkom by AgroFlow | O amogetswe mo AgroFlow |
| `setup.welcome.body` | Let's get your farm ready. It takes about 10 minutes, and you can stop and carry on later. | Kom ons maak jou plaas gereed. Dit neem omtrent 10 minute, en jy kan stop en later voortgaan. | A re baakanye polasi ya gago. Go tsaya metsotso e ka nna 10, mme o ka emisa wa tswelela moragonyana. |
| `setup.welcome.why` | Choose the language you read best. You can change it any time in Settings. | Kies die taal wat jy die beste lees. Jy kan dit enige tyd in Instellings verander. | Tlhopha puo e o e balang bobotlana. O ka e fetola nako nngwe le nngwe mo Dithulaganyong. |
| `setup.welcome.tip` | Tap a language and the app changes straight away. | Tik op 'n taal en die toep verander dadelik. | Tobetsa puo mme appe e fetoga ka bonako. |
| `setup.password.title` | Set your own password | Stel jou eie wagwoord | Baya lefoko la gago la sephiri |
| `setup.password.why` | Only you should know it. The one you signed in with was a temporary password. | Net jy moet dit ken. Die een waarmee jy aangemeld het, was 'n tydelike wagwoord. | Ke wena fela yo o tshwanetseng go le itse. Le o tsenneng ka lone e ne e le la nakwana. |
| `setup.password.new` | New password | Nuwe wagwoord | Lefoko le lesha la sephiri |
| `setup.password.again` | Type it again | Tik dit weer | Le kwale gape |
| `setup.password.rule` | At least 8 characters. | Ten minste 8 karakters. | Bonnye ditlhaka di le 8. |
| `setup.password.save` | Save my password | Stoor my wagwoord | Boloka lefoko la me la sephiri |
| `setup.password.saved` | Your password is saved. | Jou wagwoord is gestoor. | Lefoko la gago la sephiri le bolokilwe. |
| `setup.password.already` | Your password is already set. You can change it later in Profile. | Jou wagwoord is reeds gestel. Jy kan dit later in Profiel verander. | Lefoko la gago la sephiri le setse le beilwe. O ka le fetola moragonyana mo Porofaeleng. |
| `setup.password.tooShort` | Use at least 8 characters. | Gebruik ten minste 8 karakters. | Dirisa bonnye ditlhaka di le 8. |
| `setup.password.mismatch` | The two passwords are not the same. | Die twee wagwoorde is nie dieselfde nie. | Mafoko a mabedi a sephiri ga a tshwane. |
| `setup.password.failed` | The password could not be saved. Check your connection and try again. | Die wagwoord kon nie gestoor word nie. Kyk na jou verbinding en probeer weer. | Lefoko la sephiri ga le a kgona go bolokwa. Tlhola kgolagano mme o leke gape. |
| `setup.password.tip` | Pick something only you know, with a number in it. | Kies iets wat net jy ken, met 'n syfer daarin. | Tlhopha sengwe se o se itseng o le esi, se se nang le nomoro. |
| `setup.telegram.title` | Link Telegram | Koppel Telegram | Golaganya Telegram |
| `setup.telegram.why` | Telegram is how AgroFlow sends you alerts, and how you get a new password if you forget yours. | Telegram is hoe AgroFlow vir jou waarskuwings stuur, en hoe jy 'n nuwe wagwoord kry as jy joune vergeet. | Telegram ke tsela e AgroFlow e go romelang ditemoso ka yone, le tsela e o bonang lefoko le lesha la sephiri fa o lebetse la gago. |
| `setup.telegram.linked` | Telegram is linked. Alerts will reach you there. | Telegram is gekoppel. Waarskuwings sal jou daar bereik. | Telegram e golagane. Ditemoso di tla go fitlhela koo. |
| `setup.telegram.check` | I've linked it — check again | Ek het dit gekoppel — kyk weer | Ke e golagantse — tlhola gape |
| `setup.telegram.none` | I don't use Telegram | Ek gebruik nie Telegram nie | Ga ke dirise Telegram |
| `setup.telegram.tip` | Keep Telegram notifications on, so a dry-zone alert wakes your phone. | Hou Telegram-kennisgewings aan, sodat 'n droë-sone-waarskuwing jou foon wakker maak. | Tlogela dikitsiso tsa Telegram di dirile, gore temoso ya karolo e e omileng e tsose founu ya gago. |
| `setup.zones.title` | Your zones | Jou sones | Dikarolo tsa gago |
| `setup.zones.why` | AgroFlow works out water for each crop and its age, so check what is growing and when it was planted. | AgroFlow bereken water vir elke gewas en sy ouderdom, so kyk wat groei en wanneer dit geplant is. | AgroFlow e bala metsi go ya ka sejalo sengwe le sengwe le bogolo jwa sone, ka jalo tlhola se se golang le gore se jadilwe leng. |
| `setup.zones.kit` | Kit connected | Toestel gekoppel | Sedirisiwa se golagane |
| `setup.zones.waiting` | Waiting for kit | Wag vir toestel | Go letetswe sedirisiwa |
| `setup.zones.crop` | Crop | Gewas | Sejalo |
| `setup.zones.plantedQ` | About how long ago did you plant? | Omtrent hoe lank gelede het jy geplant? | O jadile e ka nna leng? |
| `setup.zones.planted` | Planted {date} | Geplant {date} | Go jadilwe {date} |
| `setup.zones.weeks` | {n} wk | {n} wk | dib. {n} |
| `setup.zones.thisWeek` | This week | Hierdie week | Beke eno |
| `setup.zones.dayEarlier` | 1 day earlier | 1 dag vroeër | Letsatsi le le 1 pele |
| `setup.zones.dayLater` | 1 day later | 1 dag later | Letsatsi le le 1 morago |
| `setup.zones.confirm` | Confirm {zone} | Bevestig {zone} | Netefatsa {zone} |
| `setup.zones.confirmed` | {zone} is saved. | {zone} is gestoor. | {zone} e bolokilwe. |
| `setup.zones.needCrop` | Choose the crop first. | Kies eers die gewas. | Tlhopha sejalo pele. |
| `setup.zones.none` | No zones yet. Your AgroFlow field officer adds them. | Nog geen sones nie. Jou AgroFlow-veldbeampte voeg hulle by. | Ga go ise go nne le dikarolo. Motlhokomedi wa tshimo wa AgroFlow o a di oketsa. |
| `setup.zones.tip` | Not sure of the date? A rough guess is fine; you can fix it later. | Nie seker van die datum nie? 'n Rowwe skatting is goed; jy kan dit later regmaak. | Ga o tlhomamise letlha? Kakanyetso e siame; o ka e baakanya moragonyana. |
| `setup.flow.title` | Measure your water flow | Meet jou watervloei | Lekanya go elela ga metsi a gago |
| `setup.flow.why` | AgroFlow needs to know how fast water comes out, to tell you how many minutes to water. | AgroFlow moet weet hoe vinnig water uitkom, om vir jou te sê hoeveel minute om water te gee. | AgroFlow e tlhoka go itse gore metsi a tswa ka bonako bo kae, go go bolelela gore o nosetse metsotso e le kae. |
| `setup.flow.how` | Hold a container under the tap or hose. Press Start as the water goes in, and Stop when it is full. | Hou 'n houer onder die kraan of pyp. Druk Begin wanneer die water ingaan, en Stop wanneer dit vol is. | Tshwara sejana ka fa tlase ga pompo kgotsa phaephe. Tobetsa Simolola fa metsi a tsena, le Emisa fa se tletse. |
| `setup.flow.size` | How much does the container hold? | Hoeveel hou die houer? | Sejana se tshola bokae? |
| `setup.flow.litres` | Litres | Liter | Dilitara |
| `setup.flow.ml` | ml | ml | ml |
| `setup.flow.start` | Start | Begin | Simolola |
| `setup.flow.stop` | Stop | Stop | Emisa |
| `setup.flow.again` | Measure again | Meet weer | Lekanya gape |
| `setup.flow.seconds` | {s} seconds | {s} sekondes | metsotswana e le {s} |
| `setup.flow.result` | {lpm} litres a minute | {lpm} liter per minuut | dilitara di le {lpm} ka motsotso |
| `setup.flow.save` | Save for {zone} | Stoor vir {zone} | Boloka bakeng sa {zone} |
| `setup.flow.saved` | Saved for {zone}: {lpm} L/min. | Gestoor vir {zone}: {lpm} L/min. | E bolokilwe bakeng sa {zone}: {lpm} L/mots. |
| `setup.flow.sizeInvalid` | Enter how much the container holds (more than 0). | Tik in hoeveel die houer hou (meer as 0). | Tsenya gore sejana se tshola bokae (go feta 0). |
| `setup.flow.timeInvalid` | Time it for more than 2 seconds. Use a bigger container if it fills too fast. | Meet langer as 2 sekondes. Gebruik 'n groter houer as dit te vinnig vol word. | Lekanya go feta metsotswana e le 2. Dirisa sejana se segolo fa se tlala ka bonako thata. |
| `setup.flow.done` | Flow saved | Vloei gestoor | Go elela go bolokilwe |
| `setup.flow.tip` | Use any bucket or container. Fill it to a line you know, and type how many litres that is. | Gebruik enige emmer of houer. Vul dit tot by 'n lyn wat jy ken, en tik in hoeveel liter dit is. | Dirisa pakete kgotsa sejana sefe kapa sefe. Se tlatse go fitlha kwa mothalong o o o itseng, mme o kwale gore ke dilitara di le kae. |
| `setup.soil.title` | Teach AgroFlow your soil | Leer AgroFlow jou grond ken | Ruta AgroFlow ka mmu wa gago |
| `setup.soil.why` | Every soil holds water differently. Two readings show AgroFlow what dry and wet look like in yours. | Elke grond hou water anders. Twee lesings wys vir AgroFlow hoe droog en nat in joune lyk. | Mmu mongwe le mongwe o tshola metsi ka tsela e e farologaneng. Dipalo di le pedi di bontsha AgroFlow gore mmu wa gago o lebega jang fa o omile le fa o le metsi. |
| `setup.soil.noKit` | {zone}: waiting for kit. This opens once the kit is connected. | {zone}: wag vir toestel. Dit maak oop sodra die toestel gekoppel is. | {zone}: go letetswe sedirisiwa. Se se tla bulega fa sedirisiwa se golagane. |
| `setup.soil.noKits` | None of your zones has a kit yet, so there is nothing to do here for now. | Nog geen sone het 'n toestel nie, so daar is nou niks om hier te doen nie. | Ga go na karolo epe e e nang le sedirisiwa, ka jalo ga go na sepe sa go dira fano jaanong. |
| `setup.soil.dryHow` | When the soil is dry, as it is before you water: | Wanneer die grond droog is, soos voor jy water gee: | Fa mmu o omile, jaaka pele o nosetsa: |
| `setup.soil.dry` | Save dry reading now | Stoor droë lesing nou | Boloka palo ya mmu o omileng jaanong |
| `setup.soil.wetHow` | Water well, wait until tomorrow, then: | Gee goed water, wag tot môre, dan: | Nosetsa sentle, leta go fitlha ka moso, morago: |
| `setup.soil.wet` | Save wet reading | Stoor nat lesing | Boloka palo ya mmu o metsi |
| `setup.soil.reminder` | We'll remind you on Home to save the wet reading. | Ons sal jou op Tuis herinner om die nat lesing te stoor. | Re tla go gakolola mo Gae go boloka palo ya mmu o metsi. |
| `setup.soil.confidence` | How sure AgroFlow is: {level} | Hoe seker AgroFlow is: {level} | AgroFlow e tlhomamisa jang: {level} |
| `setup.soil.low` | Low | Laag | Kwa tlase |
| `setup.soil.medium` | Medium | Medium | Magareng |
| `setup.soil.high` | High | Hoog | Kwa godimo |
| `setup.soil.saved` | Saved. | Gestoor. | E bolokilwe. |
| `setup.soil.kitOffline` | The kit did not answer. You can carry on and do this later. | Die toestel het nie geantwoord nie. Jy kan voortgaan en dit later doen. | Sedirisiwa ga se a araba. O ka tswelela mme o dire se moragonyana. |
| `setup.soil.tip` | Do the dry reading before you water. | Doen die droë lesing voor jy water gee. | Dira palo ya mmu o omileng pele o nosetsa. |
| `setup.done.title` | All set | Alles gereed | Go siame |
| `setup.done.partTitle` | Nearly there | Amper klaar | Go setse go le gonnye |
| `setup.done.why` | Here is what is done and what is still to do. | Hier is wat klaar is en wat nog gedoen moet word. | Se se dirilweng le se se santseng se tshwanetse go dirwa ke se. |
| `setup.done.done` | Done | Klaar | Go dirilwe |
| `setup.done.todo` | Still to do | Nog te doen | Go santse go tshwanetse go dirwa |
| `setup.done.preview` | Today for {zone} | Vandag vir {zone} | Gompieno bakeng sa {zone} |
| `setup.done.go` | Go to my farm | Gaan na my plaas | Ya kwa polasing ya me |
| `setup.task.welcome` | Language | Taal | Puo |
| `setup.task.password` | Your password | Jou wagwoord | Lefoko la gago la sephiri |
| `setup.task.telegram` | Telegram | Telegram | Telegram |
| `setup.task.zones` | Crops and planting dates | Gewasse en plantdatums | Dijalo le malatsi a go jala |
| `setup.task.flow` | Water flow | Watervloei | Go elela ga metsi |
| `setup.task.soil` | Soil readings | Grondlesings | Dipalo tsa mmu |
| `setup.card.title` | Setup {done}/{total} done | Opstelling {done}/{total} klaar | Thulaganyo {done}/{total} e dirilwe |
| `setup.card.continue` | Continue | Gaan voort | Tswelela |
| `setup.card.next` | Next: {task} | Volgende: {task} | Se se latelang: {task} |
| `setup.card.wet` | Soil: save the wet reading for {zone} | Grond: stoor die nat lesing vir {zone} | Mmu: boloka palo ya mmu o metsi bakeng sa {zone} |
| `settings.redoSetup` | Redo setup | Doen opstelling weer | Dira thulaganyo gape |
| `forgot.title` | Forgot password | Wagwoord vergeet | O lebetse lefoko la sephiri |
| `forgot.intro` | Enter the email you sign in with. We send a 6-digit code to your AgroFlow Telegram. | Tik die e-pos in waarmee jy aanmeld. Ons stuur 'n 6-syfer-kode na jou AgroFlow-Telegram. | Kwala imeile e o tsenang ka yone. Re romela khoutu ya dinomoro di le 6 kwa Telegram ya gago ya AgroFlow. |
| `forgot.email` | Email address | E-posadres | Aterese ya imeile |
| `forgot.send` | Send code | Stuur kode | Romela khoutu |
| `forgot.sending` | Sending… | Stuur tans… | E a romelwa… |
| `forgot.resend` | Send a new code | Stuur 'n nuwe kode | Romela khoutu e ntšha |
| `forgot.badEmail` | Enter the email address you sign in with. | Tik die e-posadres in waarmee jy aanmeld. | Kwala aterese ya imeile e o tsenang ka yone. |
| `forgot.sent` | If this account has Telegram linked, we've sent a code. It works for 10 minutes. | As hierdie rekening aan Telegram gekoppel is, het ons 'n kode gestuur. Dit werk vir 10 minute. | Fa akhaonto e e golaganngwe le Telegram, re rometse khoutu. E dira metsotso e le 10. |
| `forgot.noTelegram` | No Telegram? Ask your AgroFlow field officer to reset it. | Geen Telegram nie? Vra jou AgroFlow-veldbeampte om dit terug te stel. | Ga o na Telegram? Kopa motlhankedi wa gago wa AgroFlow go le baakanya. |
| `forgot.code` | 6-digit code from Telegram | 6-syfer-kode van Telegram | Khoutu ya dinomoro di le 6 go tswa kwa Telegram |
| `forgot.badCode` | Enter the 6-digit code from Telegram. | Tik die 6-syfer-kode van Telegram in. | Kwala khoutu ya dinomoro di le 6 go tswa kwa Telegram. |
| `forgot.newPassword` | New password | Nuwe wagwoord | Lefoko le lesha la sephiri |
| `forgot.again` | Type it again | Tik dit weer | Le kwale gape |
| `forgot.tooShort` | Use at least 8 characters. | Gebruik ten minste 8 karakters. | Dirisa ditlhaka di le 8 kgotsa go feta. |
| `forgot.mismatch` | The two passwords are not the same. | Die twee wagwoorde is nie dieselfde nie. | Mafoko a mabedi a sephiri ga a tshwane. |
| `forgot.change` | Change password | Verander wagwoord | Fetola lefoko la sephiri |
| `forgot.changing` | Changing… | Verander tans… | E a fetolwa… |
| `forgot.done` | Your password was changed. Sign in with your new password. | Jou wagwoord is verander. Meld aan met jou nuwe wagwoord. | Lefoko la gago la sephiri le fetotswe. Tsena ka lefoko le lesha. |
| `forgot.back` | Back to sign in | Terug na aanmeld | Boela kwa go tsena |
| `signin.tempHint` | Temporary passwords are 8 letters and numbers, like KX7P 4MRT. Spaces and small letters are fine. After 72 hours one stops working: use Forgot password, or ask your field officer. | Tydelike wagwoorde is 8 letters en syfers, soos KX7P 4MRT. Spasies en klein letters is reg. Na 72 uur werk een nie meer nie: gebruik Wagwoord vergeet, of vra jou veldbeampte. | Mafoko a sephiri a nakwana ke ditlhaka le dinomoro di le 8, jaaka KX7P 4MRT. Dikgala le ditlhaka tse dinnye di siame. Morago ga diura di le 72 ga le sa dire: dirisa O lebetse lefoko la sephiri, kgotsa kopa motlhankedi wa gago. |
| `onetap.signingIn` | Signing you in… | Meld jou aan… | Re a go tsenya… |
| `onetap.failed` | This sign-in link has expired or was already used. Sign in with your temporary password instead. | Hierdie aanmeldskakel het verval of is reeds gebruik. Meld eerder aan met jou tydelike wagwoord. | Kgolagano e ya go tsena e fetile kgotsa e setse e dirisitswe. Tsena ka lefoko la sephiri la nakwana. |
| `onetap.toLogin` | Go to sign in | Gaan na aanmeld | Ya kwa go tsena |
| `zone.noKit` | No kit connected to this zone | Geen kit aan hierdie sone gekoppel nie | Ga go na kite e e golaganeng le karolo e |
| `zone.kitOffline` | No kit connected to this zone: its kit has not been heard from in the last 5 minutes. Check it has power and WiFi. | Geen kit aan hierdie sone gekoppel nie: ons het die afgelope 5 minute niks van sy kit gehoor nie. Kyk of dit krag en WiFi het. | Ga go na kite e e golaganeng le karolo e: kite ya yone ga e a utlwala mo metsotsong e le 5. Tlhola gore e na le motlakase le WiFi. |
| `run.sent` | Sending… | Stuur tans… | E a romelwa… |
| `run.started` | Kit started watering | Kit het begin water gee | Kite e simolotse go nosetsa |
| `run.finished` | Finished | Klaar | Go fedile |
| `run.noResponse` | Kit didn't respond — check it's online | Kit het nie geantwoord nie — kyk of dit aanlyn is | Kite ga e a araba — tlhola gore e mo inthaneteng |
| `run.failed` | Could not reach the kit | Kon nie die kit bereik nie | Ga re a kgona go fitlhelela kite |
| `today.overLimit` | Recommended {recommended} min — your pump is limited to {max} min per run; run it again after it finishes | Aanbeveel {recommended} min — jou pomp is beperk tot {max} min per keer; laat dit weer loop wanneer dit klaar is | Go atlenegisiwa metsotso e le {recommended} — pompo ya gago e lekanyeditswe go metsotso e le {max} ka nako; e tsamaise gape fa e fetsa |

## Telegram (37 strings)

| Key | English | Afrikaans (draft) | Setswana (draft) |
|---|---|---|---|
| `reset.code` | Your AgroFlow code is {code}. It works for 10 minutes.\n\nIf this wasn't you, ignore this and tell AgroFlow. | Jou AgroFlow-kode is {code}. Dit werk vir 10 minute.\n\nAs dit nie jy was nie, ignoreer dit en laat weet AgroFlow. | Khoutu ya gago ya AgroFlow ke {code}. E dira metsotso e le 10.\n\nFa e se wena, e tlogele mme o itsise AgroFlow. |
| `reset.done` | Your password was changed. If this wasn't you, tell AgroFlow straight away. | Jou wagwoord is verander. As dit nie jy was nie, laat weet AgroFlow dadelik. | Lefoko la gago la sephiri le fetotswe. Fa e se wena, itsise AgroFlow ka bonako. |
| `reset.admin` | AgroFlow has given you a new temporary password: {password}\n\nSign in with {email} and this password within 72 hours, then choose your own. | AgroFlow het vir jou 'n nuwe tydelike wagwoord gegee: {password}\n\nMeld binne 72 uur aan met {email} en hierdie wagwoord, en kies dan jou eie. | AgroFlow e go neile lefoko le lesha la sephiri la nakwana: {password}\n\nTsena ka {email} le lefoko le mo diureng di le 72, morago o itlhophele la gago. |
| `welcome.title` | Welcome to AgroFlow, {name}. Your account is ready. | Welkom by AgroFlow, {name}. Jou rekening is gereed. | O amogetswe mo AgroFlow, {name}. Akhaonto ya gago e siametse. |
| `welcome.location` | Location: {location} | Ligging: {location} | Lefelo: {location} |
| `welcome.signin` | Sign in with: | Meld aan met: | Tsena ka: |
| `welcome.email` | Email: {email} | E-pos: {email} | Imeile: {email} |
| `welcome.password` | Temporary password: {password} | Tydelike wagwoord: {password} | Lefoko la sephiri la nakwana: {password} |
| `welcome.change` | It works for 72 hours. You will choose your own password the first time you sign in. | Dit werk vir 72 uur. Jy kies jou eie wagwoord die eerste keer dat jy aanmeld. | Le dira diura di le 72. O tla itlhophela lefoko la gago la sephiri la ntlha fa o tsena. |
| `welcome.app` | The AgroFlow app: {link} | Die AgroFlow-toep: {link} | Appe ya AgroFlow: {link} |
| `welcome.button.hint` | Or tap the button to sign in straight away (it works once, for 24 hours). | Of tik op die knoppie om dadelik aan te meld (dit werk een keer, vir 24 uur). | Kgotsa tobetsa konopo go tsena ka bonako (e dira gangwe fela, mo diureng di le 24). |
| `welcome.button` | Sign in to AgroFlow | Meld aan by AgroFlow | Tsena mo AgroFlow |
| `why` | Why: {summary} | Hoekom: {summary} | Ka ntlha ya eng: {summary} |
| `farm` | Farm: {name} | Plaas: {name} | Polasi: {name} |
| `zone` | Zone: {name} | Sone: {name} | Karolo: {name} |
| `when` | When: {when} | Wanneer: {when} | Leng: {when} |
| `zone.title` | This zone needs water | Hierdie sone het water nodig | Karolo eno e tlhoka metsi |
| `zone.reading` | Soil sensor reading: {value} | Grondsensorlesing: {value} | Palo ya sensara ya mmu: {value} |
| `zone.manual.cause` | This zone is set to manual, so AgroFlow has not watered it. | Hierdie sone is op handbeheer, so AgroFlow het dit nie water gegee nie. | Karolo eno e beilwe go dirisiwa ka seatla, ka jalo AgroFlow ga e a e nosetsa. |
| `zone.manual.action` | Start it from the app, or switch the zone back to automatic. | Begin dit vanuit die toep, of stel die sone terug op outomaties. | E simolole mo appeng, kgotsa o busetse karolo go nosetsa ka boyona. |
| `zone.nodevice.cause` | There is no working device on this zone, so AgroFlow cannot water it. | Daar is geen werkende toestel op hierdie sone nie, so AgroFlow kan dit nie water gee nie. | Ga go na sedirisiwa se se dirang mo karolong eno, ka jalo AgroFlow ga e kgone go e nosetsa. |
| `zone.nodevice.action` | Please water it yourself and tell us the device needs attention. | Gee dit asseblief self water en laat weet ons die toestel het aandag nodig. | Tswee-tswee e nosetse ka bowena mme o re itsise gore sedirisiwa se tlhoka tlhokomelo. |
| `zone.pump.cause` | AgroFlow asked the pump to water this zone and it did not respond. | AgroFlow het die pomp gevra om hierdie sone water te gee en dit het nie gereageer nie. | AgroFlow e kopile pompo go nosetsa karolo eno mme ga e a araba. |
| `zone.pump.action` | Please check the pump, and water the zone yourself if you can. | Kyk asseblief na die pomp, en gee die sone self water as jy kan. | Tswee-tswee tlhola pompo, mme o nosetse karolo ka bowena fa o kgona. |
| `tank.low` | Your tank is getting low — refill and log the reading. | Jou tenk raak leeg — vul dit en teken die lesing aan. | Tanka ya gago e a fela — e tlatse mme o kwale palo. |
| `rain.title` | Heavy rain expected | Swaar reën verwag | Go lebeletswe pula e ntsi |
| `rain.value` | Expected rainfall: {value} mm | Verwagte reënval: {value} mm | Pula e e lebeletsweng: {value} mm |
| `rain.body` | AgroFlow does not pause automatic watering for rain yet, so zones on automatic will still water on their own soil moisture readings. | AgroFlow stel outomatiese besproeiing nog nie uit vir reën nie, so sones op outomaties sal steeds volgens hul eie grondvoglesings water kry. | AgroFlow ga e ise e emise nosetso ka boyona fa go na le pula, ka jalo dikarolo tse di nosetsang ka boyona di tla nna di nosetsa go ya ka bongola jwa mmu. |
| `rain.action` | If you do not want that, switch those zones to manual in the app before then. Check your drainage and anything that could wash away. | As jy dit nie wil hê nie, stel daardie sones voor die tyd op handbeheer in die toep. Kyk na jou dreinering en enigiets wat kan wegspoel. | Fa o sa batle seo, fetola dikarolo tseo go nna tsa seatla mo appeng pele ga nako eo. Tlhola tsamaiso ya metsi le sengwe le sengwe se se ka kgokolosiwang. |
| `frost.title` | Frost expected | Ryp verwag | Go lebeletswe serame |
| `frost.value` | Expected low: {value} C | Verwagte laagste: {value} C | Bokgutshwane jo bo lebeletsweng: {value} C |
| `frost.body` | Frost can damage or kill young plants overnight. | Ryp kan jong plante oornag beskadig of doodmaak. | Serame se ka senya kgotsa sa bolaya dimela tse dinnye bosigo. |
| `frost.action` | Cover what you can, and avoid watering late in the day before it - wet soil overnight makes frost damage worse. | Bedek wat jy kan, en moenie laat in die dag daarvoor water gee nie - nat grond oornag maak rypskade erger. | Khurumetsa se o ka se kgonang, mme o se ka wa nosetsa thapama pele ga sone - mmu o o metsi bosigo o oketsa tshenyo ya serame. |
| `heat.title` | Heat expected | Hitte verwag | Go lebeletswe mogote |
| `heat.value` | Expected high: {value} C | Verwagte hoogste: {value} C | Bogodimo jo bo lebeletsweng: {value} C |
| `heat.body` | Crops lose a lot of water on days like this and can scorch. | Gewasse verloor baie water op dae soos hierdie en kan verskroei. | Dijalo di latlhegelwa ke metsi a mantsi ka malatsi a a ntseng jaana mme di ka fisega. |
| `heat.action` | Water early in the morning rather than in the heat of the day, and check on young or shallow-rooted zones. | Gee vroeg in die oggend water eerder as in die hitte van die dag, en kyk na jong of vlak gewortelde sones. | Nosetsa phakela go na le mo mogoteng wa motshegare, mme o tlhole dikarolo tse dinnye kgotsa tse di nang le medi e e sa tseneng thata. |
