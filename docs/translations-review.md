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

## App (522 strings)

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
| `home.community` | Farmers nearby | Boere naby | Balemi ba ba gaufi |
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
| `setup.looksRight` | Looks right | Lyk reg | Go siame |
| `setup.sameAsFirst` | Same as {zone} | Dieselfde as {zone} | Go tshwana le {zone} |
| `setup.section.you` | You | Jy | Wena |
| `setup.section.farm` | Your farm | Jou plaas | Polase ya gago |
| `setup.section.zones` | Each zone | Elke sone | Sone nngwe le nngwe |
| `setup.section.alerts` | Alerts & help | Waarskuwings en hulp | Ditlhagiso le thuso |
| `setup.location.title` | Is this your farm? | Is dit jou plaas? | A e ke polase ya gago? |
| `setup.location.why` | Your field officer saved where your farm is. AgroFlow uses it for the weather and for alerts from farmers nearby. | Jou veldbeampte het gestoor waar jou plaas is. AgroFlow gebruik dit vir die weer en vir waarskuwings van boere naby. | Motlhankedi wa gago wa masimo o bolokile fa polase ya gago e leng teng. AgroFlow e e dirisetsa maemo a bosa le ditlhagiso go tswa go balemi ba ba gaufi. |
| `setup.location.unknown` | No place saved yet | Nog geen plek gestoor nie | Ga go na lefelo le le bolokilweng |
| `setup.location.noPoint` | There is no map point for your farm yet. Your field officer can add it. | Daar is nog geen kaartpunt vir jou plaas nie. Jou veldbeampte kan dit byvoeg. | Ga go ise go nne le ntlha ya mmapa ya polase ya gago. Motlhankedi wa gago a ka e tsenya. |
| `setup.location.coords` | Map point: {lat}, {lon} | Kaartpunt: {lat}, {lon} | Ntlha ya mmapa: {lat}, {lon} |
| `setup.location.mapA11y` | Map of your farm near {place} | Kaart van jou plaas naby {place} | Mmapa wa polase ya gago gaufi le {place} |
| `setup.location.wrong` | Something's wrong - tell my field officer | Iets is verkeerd - sê vir my veldbeampte | Sengwe se phoso - bolelela motlhankedi wa me |
| `setup.location.sent` | Thank you. Your field officer will check your farm's place. | Dankie. Jou veldbeampte sal jou plaas se plek nagaan. | Re a leboga. Motlhankedi wa gago o tla tlhola lefelo la polase ya gago. |
| `setup.water.title` | Where does your water come from? | Waar kom jou water vandaan? | Metsi a gago a tswa kae? |
| `setup.water.why` | If you water from a tank, AgroFlow keeps an eye on how much is left. | As jy uit 'n tenk natlei, hou AgroFlow dop hoeveel oor is. | Fa o nosetsa ka metsi a tanka, AgroFlow e tla ela tlhoko gore go setse a le kae. |
| `setup.water.tank` | A tank | 'n Tenk | Tanka |
| `setup.water.borehole` | A borehole | 'n Boorgat | Sediba se se epilweng |
| `setup.water.municipal` | Municipal tap water | Munisipale kraanwater | Metsi a pompo a masepala |
| `setup.water.river_dam` | A river or dam | 'n Rivier of dam | Noka kgotsa letamo |
| `setup.water.other` | Something else | Iets anders | Sengwe se sele |
| `setup.tank.title` | Your tank | Jou tenk | Tanka ya gago |
| `setup.tank.why` | With the size and how full it is now, AgroFlow can tell you how many days of water you have left. | Met die grootte en hoe vol dit nou is, kan AgroFlow jou sê vir hoeveel dae jy nog water het. | Ka bogolo le gore e tletse go le kae jaanong, AgroFlow e ka go bolelela gore o setse le metsi a malatsi a le kae. |
| `setup.tank.size` | How much does it hold? | Hoeveel hou dit? | E tshwara metsi a le kae? |
| `setup.tank.litres` | {n} L | {n} L | {n} L |
| `setup.tank.custom` | Another size, in litres | 'n Ander grootte, in liter | Bogolo jo bongwe, ka dilitara |
| `setup.tank.howFull` | How full is it now? | Hoe vol is dit nou? | E tletse go le kae jaanong? |
| `setup.tank.full` | Full | Vol | E tletse |
| `setup.tank.threeQuarters` | 3/4 | 3/4 | 3/4 |
| `setup.tank.half` | 1/2 | 1/2 | 1/2 |
| `setup.tank.quarter` | 1/4 | 1/4 | 1/4 |
| `setup.tank.nearlyEmpty` | Nearly empty | Amper leeg | E batla e se na sepe |
| `setup.tank.ph` | Water pH, if you know it (you can leave this) | Water se pH, as jy dit weet (jy kan dit los) | pH ya metsi, fa o e itse (o ka e tlogela) |
| `setup.tank.save` | Save my tank | Stoor my tenk | Boloka tanka ya me |
| `setup.tank.needSize` | Choose how much the tank holds. | Kies hoeveel die tenk hou. | Tlhopha gore tanka e tshwara metsi a le kae. |
| `setup.tank.needLevel` | Choose how full it is now. | Kies hoe vol dit nou is. | Tlhopha gore e tletse go le kae jaanong. |
| `setup.tank.badPh` | pH is a number from 0 to 14. | pH is 'n getal van 0 tot 14. | pH ke palo go tloga go 0 go ya go 14. |
| `setup.irrigation.title` | How is {zone} watered? | Hoe word {zone} natgelei? | {zone} e nosediwa jang? |
| `setup.irrigation.why` | Some water is lost on the way to the roots. Drip loses little, a hose or furrow loses more, so AgroFlow adds a little to the amount for the way you water. | Van die water gaan verlore op pad na die wortels. Drup verloor min, 'n voor verloor meer, dus voeg AgroFlow 'n bietjie by vir die manier waarop jy natlei. | Metsi mangwe a latlhega pele a fitlha kwa medung. Go conta go latlha a mannye, mosele o latlha a mantsi, ka jalo AgroFlow e oketsa go le gonnye go ya ka tsela e o nosetsang ka yone. |
| `setup.irrigation.drip` | Drip | Drup | Go conta |
| `setup.irrigation.sprinkler` | Sprinkler | Sproeier | Sefafatsi |
| `setup.irrigation.micro_sprinkler` | Micro-sprinkler | Mikrosproeier | Sefafatsi se sennye |
| `setup.irrigation.centre_pivot` | Centre pivot | Spilpunt | Sefafatsi se se dikologang |
| `setup.irrigation.surface` | Furrow or flood | Voor of vloed | Mosele kgotsa go elela |
| `setup.irrigation.hand` | By hand (hose or can) | Met die hand (pyp of kan) | Ka seatla (phaephe kgotsa kane) |
| `setup.soilType.title` | What is the soil like in {zone}? | Hoe lyk die grond in {zone}? | Mmu wa {zone} o ntse jang? |
| `setup.soilType.why` | Sandy soil dries out fast and clay holds water long, so AgroFlow waters each a little differently. | Sandgrond droog vinnig uit en klei hou water lank, dus lei AgroFlow elkeen 'n bietjie anders nat. | Mmu wa motlhaba o oma ka bonako mme letsopa le tshwara metsi lobaka lo loleele, ka jalo AgroFlow e nosetsa mongwe le mongwe ka tsela e e farologanang. |
| `setup.soilType.sandy` | Sandy | Sanderig | Motlhaba |
| `setup.soilType.sandyDesc` | Feels gritty and falls apart in your hand, even when wet. | Voel korrelrig en val uitmekaar in jou hand, selfs as dit nat is. | Go utlwala go le makwata mme o phatlalala mo seatleng, le fa o le metsi. |
| `setup.soilType.loam` | Loam (ordinary garden soil) | Leem (gewone tuingrond) | Mmu o o tlwaelegileng wa tshingwana |
| `setup.soilType.loamDesc` | Dark and crumbly. A wet handful holds together, then breaks. | Donker en krummelrig. 'n Nat handvol hou saam en breek dan. | O lefifi e bile o a phuthologa. Seatla se se metsi se a kgomarela, morago se robege. |
| `setup.soilType.clay` | Clay | Klei | Letsopa |
| `setup.soilType.clayDesc` | Sticky when wet, hard and cracked when dry. | Taai as dit nat is, hard en gekraak as dit droog is. | Le a kgomarela fa le le metsi, le thata e bile le a phatloga fa le omile. |
| `setup.size.title` | How big is {zone}? | Hoe groot is {zone}? | {zone} e kgolo go le kae? |
| `setup.size.why` | The size turns the water the crop needs into litres. | Die grootte verander die water wat die gewas nodig het in liter. | Bogolo bo fetola metsi a sejalo se a tlhokang go nna dilitara. |
| `setup.size.label` | Size | Grootte | Bogolo |
| `setup.size.m2` | {n} m² | {n} m² | {n} m² |
| `setup.size.m2Unit` | Square metres (m²) | Vierkante meter (m²) | Dimetara tse di sekwere (m²) |
| `setup.size.haUnit` | Hectares (ha) | Hektaar (ha) | Dihekethara (ha) |
| `setup.size.save` | Save the size | Stoor die grootte | Boloka bogolo |
| `setup.size.invalid` | Enter a size bigger than 0. | Tik 'n grootte groter as 0. | Tsenya bogolo jo bo fetang 0. |
| `setup.maxRun.title` | Longest watering at a time | Langste natlei op 'n slag | Nako e telele ya go nosetsa ka nako nngwe |
| `setup.maxRun.why` | The pump never runs longer than this in one go, to keep it safe and stop water running away. | Die pomp loop nooit langer as dit op een slag nie, om dit veilig te hou en te keer dat water wegloop. | Pompo ga e ke e bereka go feta fa ka nako nngwe, go e sireletsa le go thibela metsi go elela. |
| `setup.maxRun.minutes` | {n} min | {n} min | {n} metsotso |
| `setup.maxRun.ask` | Ask your field officer to change this. | Vra jou veldbeampte om dit te verander. | Kopa motlhankedi wa gago go fetola se. |
| `setup.maxRun.ok` | OK | Reg | Go siame |
| `setup.alerts.title` | Which alerts do you want? | Watter waarskuwings wil jy hê? | O batla ditlhagiso dife? |
| `setup.alerts.why` | Every alert shows in the app. Choose which ones also come to Telegram. | Elke waarskuwing wys in die app. Kies watter ook na Telegram kom. | Tlhagiso nngwe le nngwe e bonala mo appeng. Tlhopha tse di tla tlang gape kwa Telegram. |
| `setup.alerts.watering` | Time to water | Tyd om nat te lei | Nako ya go nosetsa |
| `setup.alerts.lowTank` | Tank running low | Tenk raak leeg | Tanka e a fela |
| `setup.alerts.drought` | Drought mode | Droogtemodus | Mokgwa wa leuba |
| `setup.alerts.community` | Reports from farmers nearby | Verslae van boere naby | Dipego go tswa go balemi ba ba gaufi |
| `setup.alerts.weather` | Weather warnings | Weerwaarskuwings | Ditlhagiso tsa bosa |
| `setup.alerts.telegramFor` | Send {what} to Telegram | Stuur {what} na Telegram | Romela {what} kwa Telegram |
| `setup.alerts.inApp` | In the app | In die app | Mo appeng |
| `setup.alerts.noTelegram` | Link Telegram to get these on your phone too. | Koppel Telegram om dit ook op jou foon te kry. | Golaganya Telegram go di amogela gape mo founung ya gago. |
| `setup.alerts.quiet` | Quiet at night | Stil in die nag | Go didimala bosigo |
| `setup.alerts.quietHours` | No Telegram messages from {start} to {end}, except a fire heading your way. | Geen Telegram-boodskappe van {start} tot {end} nie, behalwe 'n brand wat na jou kant toe kom. | Ga go melaetsa ya Telegram go tloga {start} go ya {end}, fa e se molelo o o tlang kwa go wena. |
| `setup.community.title` | Alerts from farmers nearby | Waarskuwings van boere naby | Ditlhagiso go tswa go balemi ba ba gaufi |
| `setup.community.why` | Farmers can warn each other about pests, crop disease, fire, water problems and bad weather. Your name is never shown. | Boere kan mekaar waarsku oor plae, gewassiektes, brand, waterprobleme en slegte weer. Jou naam word nooit gewys nie. | Balemi ba ka tlhagisana ka disenyi, malwetse a dijalo, molelo, mathata a metsi le bosa jo bo maswe. Leina la gago ga le ke le bontshiwa. |
| `setup.community.limit` | Each farm can add up to 2 reports every 36 hours, so alerts stay useful. Saying "I'm seeing this too" does not count. | Elke plaas kan tot 2 verslae elke 36 uur byvoeg, sodat waarskuwings nuttig bly. "Ek sien dit ook" tel nie. | Polase nngwe le nngwe e ka tsenya dipego di le 2 mo diureng dingwe le dingwe di le 36, gore ditlhagiso di nne mosola. Go re "Le nna ke a se bona" ga go balwe. |
| `setup.community.unverified` | These are community reports and have not been independently checked. | Dit is gemeenskapsverslae en is nie onafhanklik nagegaan nie. | Tse ke dipego tsa setšhaba mme ga di a tlhatlhobiwa ka boikemelo. |
| `setup.community.on` | Yes, send me these alerts | Ja, stuur vir my hierdie waarskuwings | Ee, nthomelela ditlhagiso tse |
| `setup.community.off` | No thanks | Nee dankie | Nnyaa ke a leboga |
| `setup.help.title` | Help while you learn | Hulp terwyl jy leer | Thuso fa o ntse o ithuta |
| `setup.help.why` | Drip and the "?" buttons explain things as you go. Switch them off once you know your way around. | Drup en die "?"-knoppies verduidelik dinge soos jy gaan. Skakel hulle af sodra jy jou pad ken. | Drip le dikonopo tsa "?" di tlhalosa dilo fa o ntse o tsamaya. Di time fa o setse o itse tsela. |
| `setup.help.drip` | Show Drip's tips | Wys Drup se wenke | Bontsha dikgakololo tsa Drip |
| `setup.help.icons` | Show "?" help buttons | Wys "?"-hulpknoppies | Bontsha dikonopo tsa thuso tsa "?" |
| `setup.done.pending` | Still to do | Nog om te doen | Tse di saleng go dirwa |
| `setup.done.tank` | Tank {litres} L, about {level} | Tenk {litres} L, omtrent {level} | Tanka {litres} L, e ka nna {level} |
| `setup.done.levelUnknown` | level not known yet | vlak nog nie bekend nie | boemo ga bo ise bo itsiwe |
| `setup.done.level.full` | full | vol | e tletse |
| `setup.done.level.threeQuarters` | three-quarters full | driekwart vol | e tletse dikarolo tse tharo tsa bone |
| `setup.done.level.half` | half full | half vol | e tletse sephatlo |
| `setup.done.level.quarter` | a quarter full | 'n kwart vol | e tletse karolo ya bone |
| `setup.done.level.nearlyEmpty` | nearly empty | amper leeg | e batla e se na sepe |
| `setup.task.location` | Your farm's place | Jou plaas se plek | Lefelo la polase ya gago |
| `setup.task.water` | Where water comes from | Waar water vandaan kom | Kwa metsi a tswang teng |
| `setup.task.tank` | Your tank | Jou tenk | Tanka ya gago |
| `setup.task.crop` | Crops and planting dates | Gewasse en plantdatums | Dijalo le malatsi a go jala |
| `setup.task.irrigation` | How each zone is watered | Hoe elke sone natgelei word | Tsela e sone nngwe le nngwe e nosediwang ka yone |
| `setup.task.soilType` | Soil type | Grondsoort | Mofuta wa mmu |
| `setup.task.size` | Zone sizes | Sonegroottes | Bogolo jwa disone |
| `setup.task.maxRun` | Longest watering | Langste natlei | Go nosetsa go go leele |
| `setup.task.alerts` | Alerts | Waarskuwings | Ditlhagiso |
| `setup.task.community` | Alerts from farmers nearby | Waarskuwings van boere naby | Ditlhagiso tsa balemi ba ba gaufi |
| `setup.task.help` | Help buttons | Hulpknoppies | Dikonopo tsa thuso |
| `setup.task.done` | All set | Alles gereed | Tsotlhe di siame |
| `settings.redoSetup` | Redo setup | Doen opstelling weer | Dira thulaganyo gape |
| `settings.alertChoices` | Alert choices and quiet hours | Waarskuwingkeuses en stil ure | Ditlhopho tsa ditlhagiso le diura tsa go didimala |
| `settings.communityChoice` | Alerts from farmers nearby | Waarskuwings van boere naby | Ditlhagiso go tswa go balemi ba ba gaufi |
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
| `drought.on` | Drought mode is on | Droogtemodus is aan | Mokgwa wa leuba o butswe |
| `drought.budget` | Your water budget | Jou waterbegroting | Tekanyetso ya gago ya metsi |
| `drought.noBudget` | Set up your tank to see how many days of water you have. | Stel jou tenk op om te sien vir hoeveel dae jy water het. | Baakanya tanka ya gago go bona gore o na le metsi a malatsi a le kae. |
| `drought.modeLabel` | Drought mode | Droogtemodus | Mokgwa wa leuba |
| `drought.mode.auto` | Automatic | Outomaties | Ka bogone |
| `drought.mode.on` | On | Aan | Butswe |
| `drought.mode.off` | Off | Af | Tswetswe |
| `drought.priority.full` | Water fully | Lei ten volle nat | Nosetsa ka botlalo |
| `drought.priority.reduced` | Water at {pct}% | Lei {pct}% nat | Nosetsa ka {pct}% |
| `drought.priority.skip` | Skip today | Slaan vandag oor | Tlola gompieno |
| `drought.litres` | About {litres} L today | Omtrent {litres} L vandag | E ka nna {litres} L gompieno |
| `community.title` | Farmers nearby | Boere naby | Balemi ba ba gaufi |
| `community.subtitle` | Warn each other about pests, disease, fire, water and weather | Waarsku mekaar oor plae, siektes, brand, water en weer | Tlhagisanang ka disenyi, malwetse, molelo, metsi le bosa |
| `community.add` | Report something | Rapporteer iets | Bega sengwe |
| `community.nearby` | Reported near your farm | Naby jou plaas gerapporteer | Tse di begilweng gaufi le polase ya gago |
| `community.none` | Nothing reported near your farm right now. | Niks naby jou plaas gerapporteer nie. | Ga go sepe se se begilweng gaufi le polase ya gago jaanong. |
| `community.downwind` | The wind may be blowing this fire towards your farm. This is an estimate from the wind, not a prediction. | Die wind waai dalk hierdie brand na jou plaas toe. Dit is 'n skatting uit die wind, nie 'n voorspelling nie. | Phefo e ka tswa e foka molelo o kwa polaseng ya gago. Se ke kakanyo go tswa mo phefong, e seng ponelopele. |
| `community.similar` | {n} nearby farms have reported something similar. | {n} plase naby het iets soortgelyks gerapporteer. | Dipolase di le {n} tse di gaufi di begile sengwe se se tshwanang. |
| `community.confirmations` | {n} farmers are seeing this too. | {n} boere sien dit ook. | Balemi ba le {n} ba a se bona le bone. |
| `community.yours` | You reported this. | Jy het dit gerapporteer. | O begile se. |
| `community.alsoSeen` | You said you are seeing this too. | Jy het gesê jy sien dit ook. | O buile gore le wena o a se bona. |
| `community.seeingToo` | I'm seeing this too | Ek sien dit ook | Le nna ke a se bona |
| `community.severity.low` | Low | Laag | Kwa tlase |
| `community.severity.moderate` | Moderate | Matig | Magareng |
| `community.severity.high` | High | Hoog | Kwa godimo |
| `community.cat.pest` | Pests | Plae | Disenyi |
| `community.cat.disease` | Crop disease | Gewassiekte | Bolwetse jwa dijalo |
| `community.cat.fire` | Fire | Brand | Molelo |
| `community.cat.water` | Water problem | Waterprobleem | Bothata jwa metsi |
| `community.cat.weather` | Bad weather | Slegte weer | Bosa jo bo maswe |
| `community.sub.locusts` | Locusts | Sprinkane | Tsie |
| `community.sub.fall_armyworm` | Fall armyworm | Herfskommandowurm | Seboko sa fall armyworm |
| `community.sub.aphids` | Aphids | Plantluise | Dinta tsa dimela |
| `community.sub.unusual_insects` | Unusual insects | Ongewone insekte | Dikhukhwane tse di sa tlwaelegang |
| `community.sub.suspected_crop_disease` | Suspected crop disease | Vermoedelike gewassiekte | Go belaelwa bolwetse jwa dijalo |
| `community.sub.veld_fire` | Veld fire | Veldbrand | Molelo wa naga |
| `community.sub.smoke_nearby` | Smoke nearby | Rook naby | Mosi gaufi |
| `community.sub.canal_not_flowing` | Canal not flowing | Kanaal vloei nie | Kanele ga e elele |
| `community.sub.borehole_dry` | Borehole dry | Boorgat droog | Sediba se omile |
| `community.sub.low_water` | Low water | Min water | Metsi a mannye |
| `community.sub.burst_pipe` | Burst pipe | Gebarste pyp | Phaephe e thubegile |
| `community.sub.possible_contamination` | Water may be dirty or unsafe | Water is dalk vuil of onveilig | Metsi a ka tswa a leswe kgotsa a sa babalesega |
| `community.sub.hail` | Hail | Hael | Sefako |
| `community.sub.flooding` | Flooding | Oorstroming | Merwalela |
| `community.sub.frost` | Frost | Ryp | Serame |
| `community.sub.extreme_wind` | Very strong wind | Baie sterk wind | Phefo e e maatla thata |
| `community.sub.very_heavy_rain` | Very heavy rain | Baie swaar reën | Pula e e thata thata |
| `community.dir.N` | North | Noord | Bokone |
| `community.dir.NE` | North-east | Noordoos | Bokone-botlhaba |
| `community.dir.E` | East | Oos | Botlhaba |
| `community.dir.SE` | South-east | Suidoos | Borwa-botlhaba |
| `community.dir.S` | South | Suid | Borwa |
| `community.dir.SW` | South-west | Suidwes | Borwa-bophirima |
| `community.dir.W` | West | Wes | Bophirima |
| `community.dir.NW` | North-west | Noordwes | Bokone-bophirima |
| `community.fire.update` | Update this fire | Werk hierdie brand by | Tlhabolola molelo o |
| `community.fire.still_burning` | Still burning | Brand nog | O sa ntse o tuka |
| `community.fire.under_control` | Under control | Onder beheer | O laolwa |
| `community.fire.out` | Out | Uit | O timile |
| `community.fire.spreadingTowards` | Or: spreading towards | Of: versprei na | Kgotsa: o anamela kwa |
| `community.fire.spreading` | Send: spreading that way | Stuur: versprei soontoe | Romela: o anamela kwa teng |
| `community.fire.pickDirection` | Choose which way it is spreading. | Kies in watter rigting dit versprei. | Tlhopha gore o anamela kwa kae. |
| `community.fire.sent` | Update sent to {n} farms nearby. | Bywerking na {n} plase naby gestuur. | Tlhabololo e rometswe kwa dipolaseng di le {n} tse di gaufi. |
| `community.fire.closed` | Thank you. The fire is marked as out and the report is closed. | Dankie. Die brand is as uit gemerk en die verslag is gesluit. | Re a leboga. Molelo o tshwailwe o timile mme pego e tswetswe. |
| `community.form.title` | Report something near your farm | Rapporteer iets naby jou plaas | Bega sengwe gaufi le polase ya gago |
| `community.form.what` | What are you seeing? | Wat sien jy? | O bona eng? |
| `community.form.which` | Which one? | Watter een? | Efe? |
| `community.form.howSerious` | How serious is it? | Hoe ernstig is dit? | Go masisi go le kae? |
| `community.form.note` | A short note (you can leave this) | 'n Kort nota (jy kan dit los) | Molaetsa o mokhutshwane (o ka o tlogela) |
| `community.form.count` | {n} of {max} letters | {n} van {max} letters | Ditlhaka di le {n} go tse {max} |
| `community.form.place` | The report uses your farm's saved place. Your phone's location is never used, and your name is never shown. | Die verslag gebruik jou plaas se gestoorde plek. Jou foon se ligging word nooit gebruik nie, en jou naam word nooit gewys nie. | Pego e dirisa lefelo le le bolokilweng la polase ya gago. Lefelo la founu ya gago ga le ke le dirisiwa, mme leina la gago ga le ke le bontshiwa. |
| `community.form.fireDanger` | If you're in danger, leave and call {call}. | As jy in gevaar is, gaan weg en bel {call}. | Fa o le mo kotsing, tsamaya mme o leletse {call}. |
| `community.form.similar` | Already reported nearby. If it is the same, say you are seeing it too (this does not use up a report): | Reeds naby gerapporteer. As dit dieselfde is, sê jy sien dit ook (dit gebruik nie 'n verslag op nie): | Go setse go begilwe gaufi. Fa e le sone, bolela gore le wena o a se bona (se ga se dirise pego): |
| `community.form.seeingTooThis` | I'm seeing this too: {what}, about {km} km away | Ek sien dit ook: {what}, omtrent {km} km ver | Le nna ke a se bona: {what}, e ka nna {km} km kgakala |
| `community.form.send` | Send the report | Stuur die verslag | Romela pego |
| `community.form.sent` | Thank you. Your report went to {n} farms nearby. | Dankie. Jou verslag is na {n} plase naby. | Re a leboga. Pego ya gago e ile kwa dipolaseng di le {n} tse di gaufi. |
| `community.form.needCategory` | Choose what you are seeing. | Kies wat jy sien. | Tlhopha se o se bonang. |
| `community.form.needSubtype` | Choose which one. | Kies watter een. | Tlhopha efe. |
| `community.form.needSeverity` | Choose how serious it is. | Kies hoe ernstig dit is. | Tlhopha gore go masisi go le kae. |

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

## Audit fixes, 23 October 2026 (fix/audit-oct22)

353 new strings: the Part A trust fixes, the four farmer tasks, "Where you are now", the draft terms screen, Service & support, the advice sentences (built from the server's codes) and the farmer screens that were still English. The Afrikaans and Setswana are **drafts** written without a first-language speaker; please check that each says the same thing as the English, in words a farmer uses. Watch especially: the advice sentences (`advice.*`), the terms screen (`terms.*`) and anything about watering safety (`run.capped`, `auto.*`).

Still English on purpose: the draft terms and privacy notice themselves (translated once approved; the screen says so), the "© OpenStreetMap contributors" credit, and three screens translated on `fix/i18n-remaining` (forgot password, set password, kit), listed in `apps/mobile/src/lib/__tests__/hardcodedEnglish.test.ts`.

| Key | English | Afrikaans (draft) | Setswana (draft) |
|---|---|---|---|
| `advice.day.friday` | Friday | Vrydag | Labotlhano |
| `advice.day.monday` | Monday | Maandag | Mosupologo |
| `advice.day.saturday` | Saturday | Saterdag | Lamatlhatso |
| `advice.day.sunday` | Sunday | Sondag | Tshipi |
| `advice.day.thursday` | Thursday | Donderdag | Labone |
| `advice.day.tuesday` | Tuesday | Dinsdag | Labobedi |
| `advice.day.wednesday` | Wednesday | Woensdag | Laboraro |
| `advice.englishOnly` | Shown in English: this message has no translation yet. | In Engels gewys: hierdie boodskap het nog nie 'n vertaling nie. | E bontshiwa ka Seesemane: molaetsa o ga o ise o fetolelwe. |
| `advice.kit.check_field` | Check the field by hand before watering | Kyk met die hand na die veld voordat jy natlei | Tlhatlhoba tshimo ka seatla pele o nosetsa |
| `advice.kit.check_sensor` | Check the soil sensor before relying on today's advice | Kyk na die grondsensor voordat jy op vandag se advies staatmaak | Tlhatlhoba sesupo sa mmu pele o ikaega ka kgakololo ya gompieno |
| `advice.kit.check_system` | Check the pump and pipes before watering | Kyk na die pomp en pype voordat jy natlei | Tlhatlhoba pompo le diphaephe pele o nosetsa |
| `advice.kit.offline` | Check the kit: it has stopped sending readings | Kyk na die toerusting: dit stuur nie meer lesings nie | Tlhatlhoba sedirisiwa: se emisitse go romela dipalo |
| `advice.kit.pump_failed` | Check the pump: it ran but the soil did not get wetter | Kyk na die pomp: dit het geloop, maar die grond het nie natter geword nie | Tlhatlhoba pompo: e dirile mme mmu ga o a nna metsi go feta |
| `advice.kit.sensor_stuck` | Check the soil sensor: its reading has not moved | Kyk na die grondsensor: sy lesing het nie verander nie | Tlhatlhoba sesupo sa mmu: palo ya sone ga e a fetoga |
| `advice.none.not_needed` | No watering needed today | Geen natlei vandag nodig nie | Ga go tlhokege go nosetsa gompieno |
| `advice.none.not_planted` | No crop irrigation yet: the crop has not been planted | Nog geen gewasnatlei nie: die gewas is nog nie geplant nie | Ga go ise go nosediwe: thobo ga e ise e jwalwe |
| `advice.none.season_complete` | Crop cycle complete; start a new crop cycle if this field was replanted | Gewassiklus voltooi; begin 'n nuwe siklus as hierdie veld weer geplant is | Paka ya thobo e fedile; simolola paka e ntšha fa tshimo e jwalwa gape |
| `advice.setup.area` | Finish setup: add the size of this zone to get litres | Voltooi opstelling: voeg die grootte van hierdie sone by om liters te kry | Fetsa go baakanya: tsenya bogolo jwa karolo e go bona dilitara |
| `advice.setup.calibration` | Your installer will set up the soil sensor (wet and dry) so its readings can be used | Jou installeerder sal die grondsensor opstel (nat en droog) sodat sy lesings gebruik kan word | Mointshi wa gago o tla baakanya sesupo sa mmu (metsi le go oma) gore dipalo tsa sone di dirisiwe |
| `advice.setup.crop` | Finish setup: choose the crop for this zone so we can work out how much water it needs | Voltooi opstelling: kies die gewas vir hierdie sone sodat ons kan uitwerk hoeveel water dit nodig het | Fetsa go baakanya: tlhopha thobo ya karolo e gore re bone gore e tlhoka metsi a le kae |
| `advice.setup.flow_rate` | Your installer will measure the water flow to give watering times in minutes | Jou installeerder sal die watervloei meet om natleityd in minute te gee | Mointshi wa gago o tla lekanya kelelo ya metsi go fa nako ya go nosetsa ka metsotso |
| `advice.setup.kit` | Check the kit has power and WiFi: it has not sent readings lately | Kyk of die toerusting krag en WiFi het: dit het onlangs nie lesings gestuur nie | Tlhatlhoba gore sedirisiwa se na le motlakase le WiFi: ga se a romela dipalo bosheng |
| `advice.setup.no_weather` | No advice yet: there is no weather for this farm | Nog geen advies nie: daar is geen weer vir hierdie plaas nie | Ga go ise go nne le kgakololo: ga go na maemo a loapi a polase e |
| `advice.setup.planting_date` | Finish setup: add the planting date for advice that follows your crop's growth | Voltooi opstelling: voeg die plantdatum by vir advies wat jou gewas se groei volg | Fetsa go baakanya: tsenya letlha la go jala gore kgakololo e latele kgolo ya thobo |
| `advice.setup.soil` | Finish setup: choose the soil type (sandy, loam or clay) for a closer estimate | Voltooi opstelling: kies die grondsoort (sanderig, leem of klei) vir 'n nouer skatting | Fetsa go baakanya: tlhopha mofuta wa mmu (motlhaba, o o tlwaelegileng kgotsa letsopa) go bona tekanyetso e e gaufi |
| `advice.setup.weather_today` | No advice yet: there is not enough weather data for today | Nog geen advies nie: daar is nie genoeg weerdata vir vandag nie | Ga go ise go nne le kgakololo: ga go na tshedimosetso e e lekaneng ya maemo a loapi a gompieno |
| `advice.skip.rain` | No watering today: rain is expected to cover it. | Geen natlei vandag nie: reën behoort dit te dek. | Ga go nosetsiwe gompieno: pula e solofetswe go lekana. |
| `advice.soon.days` | No watering today; water is likely needed in the next few days | Geen natlei vandag nie; water is waarskynlik in die volgende paar dae nodig | Ga go nosetsiwe gompieno; metsi a ka tlhokega mo malatsing a a tlang |
| `advice.soon.on` | No watering today; next on {day} | Geen natlei vandag nie; volgende op {day} | Ga go nosetsiwe gompieno; go latelang ka {day} |
| `advice.water.now.litres` | Water about {litres} L this morning | Lei omtrent {litres} L vanoggend water | Nosetsa e ka nna {litres} L mo mosong ono |
| `advice.water.now.minutes` | Water about {minutes} min this morning (about {litres} L) | Lei omtrent {minutes} min vanoggend water (omtrent {litres} L) | Nosetsa metsotso e ka nna {minutes} mo mosong ono (e ka nna {litres} L) |
| `advice.water.now.mm` | Water about {mm} mm this morning | Lei omtrent {mm} mm vanoggend water | Nosetsa e ka nna {mm} mm mo mosong ono |
| `advice.water.now.per_m2` | Water about {minutes} min for each square metre this morning | Lei omtrent {minutes} min per vierkante meter vanoggend water | Nosetsa metsotso e ka nna {minutes} mo metareng-sekwere nngwe le nngwe mo mosong ono |
| `advice.water.now.seconds` | Water about {seconds} sec this morning (about {litres} L) | Lei omtrent {seconds} sek vanoggend water (omtrent {litres} L) | Nosetsa metsotswana e ka nna {seconds} mo mosong ono (e ka nna {litres} L) |
| `advice.water.now.usual` | Water as usual this morning | Lei vanoggend soos gewoonlik water | Nosetsa jaaka ka gale mo mosong ono |
| `advice.water.reduced.litres` | Rain helps, but water about {litres} L this morning | Reën help, maar lei omtrent {litres} L vanoggend water | Pula e a thusa, mme nosetsa e ka nna {litres} L mo mosong ono |
| `advice.water.reduced.minutes` | Rain helps, but water about {minutes} min this morning (about {litres} L) | Reën help, maar lei omtrent {minutes} min vanoggend water (omtrent {litres} L) | Pula e a thusa, mme nosetsa metsotso e ka nna {minutes} mo mosong ono (e ka nna {litres} L) |
| `advice.water.reduced.mm` | Rain helps, but water about {mm} mm this morning | Reën help, maar lei omtrent {mm} mm vanoggend water | Pula e a thusa, mme nosetsa e ka nna {mm} mm mo mosong ono |
| `advice.water.reduced.per_m2` | Rain helps, but water about {minutes} min for each square metre this morning | Reën help, maar lei omtrent {minutes} min per vierkante meter vanoggend water | Pula e a thusa, mme nosetsa metsotso e ka nna {minutes} mo metareng-sekwere nngwe le nngwe mo mosong ono |
| `advice.water.reduced.seconds` | Rain helps, but water about {seconds} sec this morning (about {litres} L) | Reën help, maar lei omtrent {seconds} sek vanoggend water (omtrent {litres} L) | Pula e a thusa, mme nosetsa metsotswana e ka nna {seconds} mo mosong ono (e ka nna {litres} L) |
| `advice.water.reduced.usual` | Rain helps, but water as usual this morning | Reën help, maar lei vanoggend soos gewoonlik water | Pula e a thusa, mme nosetsa jaaka ka gale mo mosong ono |
| `alerts.readFailed` | Could not save that you read this. It still shows as unread. | Kon nie stoor dat jy dit gelees het nie. Dit wys steeds as ongelees. | Ga go a kgona go boloka gore o badile se. Se sa ntse se bontsha gore ga se a balwa. |
| `alerts.readRetryA11y` | Try again to mark {title} as read | Probeer weer om {title} as gelees te merk | Leka gape go tshwaya {title} jaaka se se badilweng |
| `auto.body` | Your installer has tested this field's kit. With automatic watering, AgroFlow waters when the soil is dry enough, never longer than the field's limit. You can switch back any time. | Jou installeerder het hierdie veld se toerusting getoets. Met outomatiese natlei lei AgroFlow water wanneer die grond droog genoeg is, nooit langer as die veld se limiet nie. Jy kan enige tyd terugskakel. | Mointshi wa gago o lekile sedirisiwa sa tshimo e. Ka go nosetsa ka boitiriso, AgroFlow e nosetsa fa mmu o omile, e seng go feta tekanyetso ya tshimo. O ka busetsa nako nngwe le nngwe. |
| `auto.keepManual` | Keep manual | Hou dit met die hand | Tlogela ka seatla |
| `auto.title` | Turn on automatic watering for {zone}? | Skakel outomatiese natlei vir {zone} aan? | A o batla go simolola go nosetsa ka boitiriso mo {zone}? |
| `auto.yes` | Yes, water automatically | Ja, lei outomaties water | Ee, nosetsa ka boitiriso |
| `avatar.open` | Open profile | Maak profiel oop | Bula porofaele |
| `common.loading` | Loading… | Laai tans… | Go a tsenngwa… |
| `crop.citrus` | Citrus | Sitrus | Dinamune |
| `crop.cucumber` | Cucumber | Komkommer | Kukumara |
| `crop.dry_beans` | Dry beans | Droëbone | Dinawa tse di omileng |
| `crop.leafy_veg` | Leafy vegetables | Blaargroente | Merogo ya matlhare |
| `crop.maize` | Maize | Mielies | Mmidi |
| `crop.potato` | Potato | Aartappel | Potata |
| `crop.spinach` | Spinach | Spinasie | Sepinatšhe |
| `crop.tomato` | Tomato | Tamatie | Tamati |
| `cropScreen.crop` | Crop | Gewas | Thobo |
| `cropScreen.notSure` | Not sure | Nie seker nie | Ga ke tlhomamise |
| `cropScreen.notSureA11y` | Not sure of the planting date | Nie seker van die plantdatum nie | Ga ke tlhomamise letlha la go jala |
| `cropScreen.notSureBody` | Not sure? Leave it: the advice then assumes the crop is at its thirstiest. | Nie seker nie? Los dit: die advies aanvaar dan die gewas is op sy dorstigste. | Ga o tlhomamise? E tlogele: kgakololo e tla tsaya gore thobo e nyorilwe thata. |
| `cropScreen.planted` | Planted on | Geplant op | E jwetswe ka |
| `cropScreen.save` | Save | Stoor | Boloka |
| `cropScreen.saveA11y` | Save crop and planting date | Stoor gewas en plantdatum | Boloka thobo le letlha la go jala |
| `cropScreen.title` | Crop and planting date | Gewas en plantdatum | Thobo le letlha la go jala |
| `dismiss.confirm` | Dismiss | Maak weg | Tlosa |
| `dismiss.confirmA11y` | Confirm dismiss | Bevestig wegmaak | Netefatsa go tlosa |
| `dismiss.important` | It is important. It will come back if it happens again. | Dit is belangrik. Dit sal terugkom as dit weer gebeur. | Se botlhokwa. Se tla boa fa se direga gape. |
| `dismiss.note` | Note (optional) | Nota (opsioneel) | Ntlha (ga go tlamege) |
| `dismiss.show` | Show | Wys | Bontsha |
| `dismiss.title` | Dismiss this? | Maak dit weg? | Tlosa se? |
| `dismiss.undo` | Undo | Ontdoen | Busetsa |
| `drought.noBudget.level` | Your {capacity} L tank is saved. Log how full it is (Log a refill) to see how many days of water you have. | Jou tenk van {capacity} L is gestoor. Teken aan hoe vol dit is (Teken 'n hervulling aan) om te sien vir hoeveel dae jy water het. | Tanka ya gago ya {capacity} L e bolokilwe. Kwala gore e tletse go le kae (Kwala go tlatsa) go bona gore o na le metsi a malatsi a le kae. |
| `drought.noBudget.notTank` | Your water does not come from a tank, so there is no tank budget. Drought mode uses your soil readings and the forecast. | Jou water kom nie uit 'n tenk nie, dus is daar geen tenkbegroting nie. Droogtemodus gebruik jou grondlesings en die voorspelling. | Metsi a gago ga a tswe mo tankeng, ka jalo ga go na tekanyetso ya tanka. Mokgwa wa leuba o dirisa dipalo tsa mmu le kitsiso ya loapi. |
| `drought.noBudget.use` | Your tank has about {litres} L. How many days it lasts shows once AgroFlow has watering records or today's advice for your zones. | Jou tenk het omtrent {litres} L. Hoeveel dae dit hou, wys sodra AgroFlow natleiingsrekords of vandag se advies vir jou sones het. | Tanka ya gago e na le metsi a ka nna {litres} L. Gore a tla fela morago ga malatsi a le kae go tla bontshiwa fa AgroFlow e na le dirikoto tsa go nosetsa kgotsa kgakololo ya gompieno ya dikarolo tsa gago. |
| `enquiry.bestTime` | Best time to call * | Beste tyd om te bel * | Nako e e siameng ya go leletsa * |
| `enquiry.crops` | What do you grow, or want to grow? * | Wat kweek jy, of wil jy kweek? * | O jala eng, kgotsa o batla go jala eng? * |
| `enquiry.notes` | Anything else? (optional) | Enigiets anders? (opsioneel) | Sengwe gape? (ga go tlamege) |
| `enquiry.notesA11y` | Anything else? | Enigiets anders? | Sengwe gape? |
| `enquiry.otherCrop` | Which other crop? | Watter ander gewas? | Thobo efe e nngwe? |
| `enquiry.province` | Province * | Provinsie * | Porofense * |
| `enquiry.send` | Send | Stuur | Romela |
| `enquiry.sendA11y` | Send enquiry | Stuur navraag | Romela kopo |
| `enquiry.sizeA11y` | Farm size in hectares | Plaasgrootte in hektaar | Bogolo jwa polase ka diheketara |
| `enquiry.subtitle` | A representative will phone you about AgroFlow. | 'n Verteenwoordiger sal jou oor AgroFlow bel. | Moemedi o tla go leletsa ka AgroFlow. |
| `enquiry.title` | Ask for a call | Vra vir 'n oproep | Kopa mogala |
| `forecast.showingOld` | Showing the forecast loaded at {time}. It may be out of date. | Wys die voorspelling wat om {time} gelaai is. Dit kan verouderd wees. | Go bontshiwa kitsiso e e tsentsweng ka {time}. E ka nna ya bo e le kgologolo. |
| `helpButton.hint` | Opens a short explanation of this page | Maak 'n kort verduideliking van hierdie bladsy oop | E bula tlhaloso e khutshwane ya tsebe e |
| `helpButton.label` | Help for this page | Hulp vir hierdie bladsy | Thuso ya tsebe e |
| `history.loading` | Loading activity | Laai aktiwiteit | Go tsenngwa ditiro |
| `history.loadingAlerts` | Loading alerts | Laai waarskuwings | Go tsenngwa ditemoso |
| `history.noAlerts` | No alerts yet. | Nog geen waarskuwings nie. | Ga go ise go nne le ditemoso. |
| `history.none` | No recent activity | Geen onlangse aktiwiteit nie | Ga go na ditiro tsa bosheng |
| `history.noneBody` | Irrigation actions and system events will appear here. | Natleiaksies en stelselgebeure sal hier verskyn. | Ditiro tsa go nosetsa le ditiragalo tsa thulaganyo di tla bonala fa. |
| `history.recent` | Recent activity | Onlangse aktiwiteit | Ditiro tsa bosheng |
| `history.recorded` | Recorded events | Aangetekende gebeure | Ditiragalo tse di kwadilweng |
| `history.title` | History | Geskiedenis | Hisitori |
| `history.type` | Type | Soort | Mofuta |
| `history.unavailable` | Unable to load activity | Kon nie aktiwiteit laai nie | Ga go a kgonega go tsenya ditiro |
| `history.when` | When | Wanneer | Leng |
| `history.zone` | Zone | Sone | Karolo |
| `insights.advice` | Advice | Advies | Kgakololo |
| `insights.dismissed` | Dismissed | Weggemaak | Tse di tlositsweng |
| `insights.improve` | Improve your advice | Verbeter jou advies | Tokafatsa kgakololo ya gago |
| `insights.noneDismissed` | No advice has been dismissed for this zone. | Geen advies is vir hierdie sone weggemaak nie. | Ga go na kgakololo e e tlositsweng ya karolo e. |
| `insights.restore` | Restore | Herstel | Busetsa |
| `journey.continue` | Continue your details | Gaan voort met jou besonderhede | Tswelela ka dintlha tsa gago |
| `journey.date.account_active` | Whenever you are ready | Wanneer jy gereed is | Fa o siametse |
| `journey.date.commissioned` | Live | Aktief | E a dira |
| `journey.date.details` | Waiting for AgroFlow staff | Wag vir AgroFlow-personeel | Go emetswe badiri ba AgroFlow |
| `journey.date.enquiry` | Waiting for a call | Wag vir 'n oproep | Go emetswe mogala |
| `journey.date.installing` | Installation under way | Installering is aan die gang | Go tsenya go a tswelela |
| `journey.date.ready_for_installation` | Waiting for booking | Wag vir bespreking | Go emetswe go bukiwa |
| `journey.date.service_agreed` | Whenever you are ready | Wanneer jy gereed is | Fa o siametse |
| `journey.date.visit_booked` | Visit booked | Besoek bespreek | Ketelo e bukilwe |
| `journey.details` | Your details: {done} of {total} | Jou besonderhede: {done} van {total} | Dintlha tsa gago: {done} go {total} |
| `journey.helpOpen` | AgroFlow staff are helping with {count} of your questions. | AgroFlow-personeel help met {count} van jou vrae. | Badiri ba AgroFlow ba thusa ka dipotso di le {count} tsa gago. |
| `journey.installation` | Installation: {stage} | Installering: {stage} | Go tsenya: {stage} |
| `journey.loading` | Loading where you are… | Laai waar jy is… | Go tsenngwa gore o fa kae… |
| `journey.next.account_active` | Finish your details: {done} of {total} done. | Voltooi jou besonderhede: {done} van {total} klaar. | Fetsa dintlha tsa gago: {done} go {total} di weditswe. |
| `journey.next.commissioned` | Your kit is connected. Check your fields, water and stop from the app, and ask for help any time. | Jou toerusting is gekoppel. Kyk na jou velde, lei water en stop in die toep, en vra enige tyd hulp. | Sedirisiwa sa gago se kopantswe. Leba ditshimo, nosetsa o bo o emise mo appeng, o bo o kope thuso nako nngwe le nngwe. |
| `journey.next.details` | AgroFlow staff will agree the service and its cost with you. | AgroFlow-personeel sal die diens en die koste met jou ooreenkom. | Badiri ba AgroFlow ba tla dumalana le wena ka tirelo le tlhwatlhwa ya yone. |
| `journey.next.enquiry` | AgroFlow staff will call you to talk about your farm. | AgroFlow-personeel sal jou bel om oor jou plaas te praat. | Badiri ba AgroFlow ba tla go leletsa go bua ka polase ya gago. |
| `journey.next.installing` | Your installer is setting up and testing your kit. | Jou installeerder stel jou toerusting op en toets dit. | Mointshi wa gago o baakanya e bile o leka sedirisiwa sa gago. |
| `journey.next.ready_for_installation` | AgroFlow staff will book your installation visit. | AgroFlow-personeel sal jou installeringsbesoek bespreek. | Badiri ba AgroFlow ba tla buka ketelo ya go tsenya. |
| `journey.next.service_agreed` | Sign in, choose your own password and accept the terms. | Teken in, kies jou eie wagwoord en aanvaar die bepalings. | Tsena, itlhophele lefoko la sephiri mme o amogele melawana. |
| `journey.next.visit_booked` | Your installer will visit to install and test your kit. | Jou installeerder sal kom om jou toerusting te installeer en te toets. | Mointshi wa gago o tla etela go tsenya le go leka sedirisiwa sa gago. |
| `journey.stage.account_active` | account active | rekening aktief | akhaonto e a dira |
| `journey.stage.commissioned` | connected and tested | gekoppel en getoets | e kopantswe e bile e lekilwe |
| `journey.stage.details` | details being checked | besonderhede word nagegaan | dintlha di a sekasekwa |
| `journey.stage.enquiry` | enquiry received | navraag ontvang | kopo e amogetswe |
| `journey.stage.installing` | installing | word geïnstalleer | go a tsenngwa |
| `journey.stage.ready_for_installation` | waiting for booking | wag vir bespreking | go emetswe go bukiwa |
| `journey.stage.service_agreed` | service agreed | diens ooreengekom | tirelo e dumalanwe |
| `journey.stage.visit_booked` | visit booked | besoek bespreek | ketelo e bukilwe |
| `journey.title` | Where you are now | Waar jy nou is | O fa kae jaanong |
| `journey.unavailable` | Your progress could not be loaded. Pull down to try again. | Jou vordering kon nie gelaai word nie. Trek af om weer te probeer. | Tswelelopele ya gago ga e a kgona go tsenngwa. Gogela tlase go leka gape. |
| `journey.when` | When: {date} | Wanneer: {date} | Leng: {date} |
| `journey.who.agroflow_staff` | AgroFlow staff | AgroFlow-personeel | Badiri ba AgroFlow |
| `journey.who.installer` | Your installer | Jou installeerder | Mointshi wa gago |
| `journey.who.you` | You | Jy | Wena |
| `journey.whoNext` | Who acts next: {who} | Wie volgende optree: {who} | Yo o latelang: {who} |
| `loading.skip` | Skip the opening animation | Slaan die openingsanimasie oor | Tlola setshwantsho se se tsamayang sa go bula |
| `loading.starting` | AgroFlow is starting | AgroFlow begin | AgroFlow e a simolola |
| `login.emailExample` | farmer@example.com | boer@voorbeeld.co.za | molemi@sekao.co.za |
| `map.a11y` | Farm location map. Use the zoom buttons to change scale. | Kaart van die plaasligging. Gebruik die zoemknoppies om die skaal te verander. | Mmapa wa lefelo la polase. Dirisa dikonopo tsa go godisa go fetola selekanyo. |
| `map.unavailable` | Map unavailable. Farm location is shown above. | Kaart nie beskikbaar nie. Die plaasligging word bo gewys. | Mmapa ga o bonale. Lefelo la polase le bontshitswe fa godimo. |
| `recommended.keep` | Keep my own | Hou my eie | Tlogela tsa me |
| `recommended.reset` | Reset to recommended | Herstel na aanbeveel | Busetsa go tse di akantshiwang |
| `recommended.resetA11y` | Reset watering levels to recommended | Herstel natleivlakke na die aanbevole | Busetsa maemo a go nosetsa go a a akantshiwang |
| `recommended.title` | Recommended for you | Aanbeveel vir jou | E akantshiwa mo go wena |
| `recommended.use` | Use these settings | Gebruik hierdie instellings | Dirisa dipeakanyo tse |
| `request.crop` | Crop | Gewas | Thobo |
| `request.cropRequired` | Please select the main crop for this request. | Kies asseblief die hoofgewas vir hierdie versoek. | Tsweetswee tlhopha thobo e kgolo ya kopo e. |
| `request.cropRequiredTitle` | Crop required | Gewas nodig | Thobo e a tlhokega |
| `request.existingFarm` | Existing farm | Bestaande plaas | Polase e e leng teng |
| `request.failedTitle` | Request failed | Versoek het misluk | Kopo e paletswe |
| `request.farmRequired` | Please select the farm where the new zone should be created. | Kies asseblief die plaas waar die nuwe sone moet kom. | Tsweetswee tlhopha polase e karolo e ntšha e tshwanetseng go dirwa mo go yone. |
| `request.farmRequiredTitle` | Farm required | Plaas nodig | Polase e a tlhokega |
| `request.invalidSize` | Rough size must be a number greater than zero. | Die grootte moet 'n getal groter as nul wees. | Bogolo bo tshwanetse go nna palo e e fetang lefela. |
| `request.invalidSizeTitle` | Invalid size | Ongeldige grootte | Bogolo jo bo sa siamang |
| `request.loadingFarms` | Loading your farms... | Laai jou plase… | Go tsenngwa dipolase tsa gago… |
| `request.location` | Farm location | Plaasligging | Lefelo la polase |
| `request.locationPlaceholder` | Enter the farm location | Voer die plaas se ligging in | Kwala lefelo la polase |
| `request.locationRequired` | Please enter the location of the new farm. | Voer asseblief die ligging van die nuwe plaas in. | Tsweetswee kwala lefelo la polase e ntšha. |
| `request.locationRequiredTitle` | Location required | Ligging nodig | Lefelo le a tlhokega |
| `request.newFarm` | New farm | Nuwe plaas | Polase e ntšha |
| `request.newFarmBody` | Request installation for a new farm. | Vra vir installering op 'n nuwe plaas. | Kopa go tsenngwa mo polaseng e ntšha. |
| `request.newZone` | New zone | Nuwe sone | Karolo e ntšha |
| `request.newZoneBody` | Request an additional zone on an existing farm. | Vra vir 'n ekstra sone op 'n bestaande plaas. | Kopa karolo e nngwe mo polaseng e e leng teng. |
| `request.noFarms` | No existing farms are available for a new-zone request. | Geen bestaande plase is beskikbaar vir 'n nuwe sone nie. | Ga go na dipolase tse di leng teng tsa kopo ya karolo e ntšha. |
| `request.notesLabel` | Notes | Notas | Dintlha |
| `request.notesPlaceholder` | Optional additional information | Opsionele ekstra inligting | Tshedimosetso e nngwe (ga go tlamege) |
| `request.pendingNote` | Your request will remain pending until it is reviewed by an AgroFlow administrator. | Jou versoek bly hangende totdat 'n AgroFlow-administrateur dit nagaan. | Kopo ya gago e tla nna e emetse go fitlha motsamaisi wa AgroFlow a e sekaseka. |
| `request.sizeHelp` | An approximate size is fine. 1 hectare is 10 000 m², about the size of a rugby field. A 10 m by 20 m plot is 200 m². | 'n Benaderde grootte is goed. 1 hektaar is 10 000 m², omtrent so groot soos 'n rugbyveld. 'n Stuk van 10 m by 20 m is 200 m². | Bogolo jo bo ka fa godimo bo siame. Heketara e le 1 ke 10 000 m², e ka nna bogolo jwa lebala la rakabi. Tshimo ya 10 m ka 20 m ke 200 m². |
| `request.sizeLabel` | Rough size | Rowwe grootte | Bogolo jo bo ka fa godimo |
| `request.sizePlaceholder` | e.g. 200 | bv. 200 | sk. 200 |
| `request.sizeUnit.ha` | Hectares (ha) | Hektaar (ha) | Diheketara (ha) |
| `request.sizeUnit.m2` | Square metres (m²) | Vierkante meter (m²) | Dimetara-sekwere (m²) |
| `request.sizeUnit.unknown` | I don't know – help me measure | Ek weet nie – help my meet | Ga ke itse – nthuse go lekanya |
| `request.sizeUnitLabel` | Size unit | Eenheid van grootte | Selekanyo sa bogolo |
| `request.sizeUnitNeeded` | Choose square metres or hectares for the size, or I don't know. | Kies vierkante meter of hektaar vir die grootte, of Ek weet nie. | Tlhopha dimetara-sekwere kgotsa diheketara go bogolo, kgotsa Ga ke itse. |
| `request.sizeUnitTitle` | Which unit? | Watter eenheid? | Selekanyo sefe? |
| `request.sizeUnknownHelp` | That's fine. Staff will help you measure it at the visit. | Dis reg. Personeel sal jou help om dit by die besoek te meet. | Go siame. Badiri ba tla go thusa go e lekanya ka nako ya ketelo. |
| `request.submit` | Submit request | Dien versoek in | Romela kopo |
| `request.submitted` | Your request has been submitted and is now pending admin review. | Jou versoek is ingedien en wag nou vir die administrateur. | Kopo ya gago e romeletswe mme jaanong e emetse motsamaisi. |
| `request.submittedTitle` | Request submitted | Versoek ingedien | Kopo e romeletswe |
| `request.subtitle` | Request a new farm or zone from AgroFlow. | Vra AgroFlow vir 'n nuwe plaas of sone. | Kopa AgroFlow polase kgotsa karolo e ntšha. |
| `request.title` | Farm request | Plaasversoek | Kopo ya polase |
| `request.type` | Request type | Soort versoek | Mofuta wa kopo |
| `run.capped` | Capped to {max} min (this zone's limit) | Beperk tot {max} min (hierdie sone se limiet) | E lekanyeditswe go {max} metsotso (tekanyetso ya karolo e) |
| `service.contact` | Your contact at AgroFlow: {name} | Jou kontakpersoon by AgroFlow: {name} | Motho wa gago kwa AgroFlow: {name} |
| `service.example` | Example price: {install} installation (hardware included) and {monthly} a month, for a {zones}-zone farm. Your final quote follows a site visit. | Voorbeeldprys: {install} installering (toerusting ingesluit) en {monthly} per maand, vir 'n plaas met {zones} sones. Jou finale kwotasie volg op 'n besoek. | Sekao sa tlhwatlhwa: {install} go tsenya (le sedirisiwa) le {monthly} ka kgwedi, mo polaseng ya dikarolo di le {zones}. Tlhwatlhwa ya bofelo e tla morago ga ketelo. |
| `service.helpInApp` | Open Help in the app, or tap I don't know – help me on any setup question. | Maak Hulp in die toep oop, of tik Ek weet nie – help my by enige opstelvraag. | Bula Thuso mo appeng, kgotsa tobetsa Ga ke itse – nthuse mo potsong nngwe le nngwe ya go baakanya. |
| `service.helpTelegram` | If you linked Telegram, message the AgroFlow bot. | As jy Telegram gekoppel het, stuur 'n boodskap aan die AgroFlow-bot. | Fa o golagantse Telegram, romela molaetsa go bot ya AgroFlow. |
| `service.helpTitle` | How to get help | Hoe om hulp te kry | Go bona thuso jang |
| `service.noPayments` | AgroFlow does not take payments in the app. | AgroFlow neem nie betalings in die toep nie. | AgroFlow ga e amogele dituelo mo appeng. |
| `service.payer` | Paid by: {payer} | Betaal deur: {payer} | E duelwa ke: {payer} |
| `service.plan` | Plan: {plan} | Plan: {plan} | Leano: {plan} |
| `service.status` | Service: {status} | Diens: {status} | Tirelo: {status} |
| `service.status.ended` | ended | beëindig | e fedile |
| `service.status.not_agreed` | not agreed yet | nog nie ooreengekom nie | ga e ise e dumalanwe |
| `service.status.paused` | paused | onderbreek | e emisitswe nakwana |
| `service.status.paying` | active (paid service) | aktief (betaalde diens) | e a dira (tirelo e e duelwang) |
| `service.status.sponsored` | sponsored | geborg | e duelelwa ke motshegetsi |
| `service.status.trial` | trial | proeftydperk | teko |
| `service.title` | Service & support | Diens en ondersteuning | Tirelo le thuso |
| `service.unavailable` | Service details could not be loaded. | Diensbesonderhede kon nie gelaai word nie. | Dintlha tsa tirelo ga di a kgona go tsenngwa. |
| `sheet.close` | Close | Sluit | Tswala |
| `sheet.dismiss` | Dismiss | Maak toe | Tswala |
| `soilScreen.loam` | Loam | Leem | Mmu o o tlwaelegileng |
| `soilScreen.notSure` | Not sure? Pick | Nie seker nie? Kies | Ga o tlhomamise? Tlhopha |
| `soilScreen.save` | Save soil type | Stoor grondsoort | Boloka mofuta wa mmu |
| `soilScreen.title` | Soil type | Grondsoort | Mofuta wa mmu |
| `tasks.check.calibration` | Soil sensor set up (wet and dry) | Grondsensor opgestel (nat en droog) | Sesupo sa mmu se baakantswe (metsi le go oma) |
| `tasks.check.flow_measured` | Water flow measured | Watervloei gemeet | Kelelo ya metsi e lekantswe |
| `tasks.check.kit_linked` | Kit linked to this field | Toerusting aan hierdie veld gekoppel | Sedirisiwa se golagantswe le tshimo e |
| `tasks.check.run_limit` | Longest run set | Langste beurt gestel | Nako e telele ya go nosetsa e tlhomilwe |
| `tasks.check.test_start_stop` | Test start and stop | Toets begin en stop | Teko ya go simolola le go emisa |
| `tasks.crop.needBoth` | {zone} needs its crop and about when it was planted, or tap I don't know – help me. | {zone} het sy gewas nodig en omtrent wanneer dit geplant is, of tik Ek weet nie – help my. | {zone} e tlhoka thobo ya yone le gore e jwetswe leng, kgotsa tobetsa Ga ke itse – nthuse. |
| `tasks.crops` | Your crops | Jou gewasse | Dijalo tsa gago |
| `tasks.crops.about` | What grows in each field, when it was planted, and how it is watered. | Wat in elke veld groei, wanneer dit geplant is en hoe dit natgelei word. | Se se golang mo tshimong nngwe le nngwe, leng se jwetswe, le gore se nosediwa jang. |
| `tasks.done` | Done | Klaar | Go weditswe |
| `tasks.farm` | Your farm | Jou plaas | Polase ya gago |
| `tasks.farm.about` | Check where your farm is. | Kyk waar jou plaas is. | Tlhatlhoba gore polase ya gago e kae. |
| `tasks.helpMe` | I don't know – help me | Ek weet nie – help my | Ga ke itse – nthuse |
| `tasks.installer.doneOn` | Done {date} | Klaar {date} | E weditswe {date} |
| `tasks.installer.later` | This shows once your fields are set up. | Dit wys sodra jou velde opgestel is. | Se se tla bontshiwa fa ditshimo tsa gago di setse di baakantswe. |
| `tasks.installer.legacy` | This field was already in use before these checks. Nothing to do. | Hierdie veld was reeds in gebruik voor hierdie kontroles. Niks om te doen nie. | Tshimo e e ne e setse e dirisiwa pele ga ditlhatlhobo tse. Ga go na sepe se se tshwanetseng go dirwa. |
| `tasks.installer.title` | What your installer does | Wat jou installeerder doen | Se mointshi wa gago a se dirang |
| `tasks.installer.why` | These need the kit and tools on site. You do not need to do anything here. | Hierdie het die toerusting en gereedskap op die plaas nodig. Jy hoef niks hier te doen nie. | Tse di tlhoka sedirisiwa le didirisiwa kwa polaseng. Ga o tlhoke go dira sepe fa. |
| `tasks.installer.will` | Your installer will complete this | Jou installeerder sal dit voltooi | Mointshi wa gago o tla e fetsa |
| `tasks.installerNote` | Flow, soil calibration, linking the kit, the longest run and the test run are done by your installer: you do not need to do them. | Vloei, grondkalibrasie, die koppeling van die toerusting, die langste beurt en die toetslopie word deur jou installeerder gedoen: jy hoef dit nie te doen nie. | Kelelo, go lekanya mmu, go golaganya sedirisiwa, nako e telele ya go nosetsa le teko di dirwa ke mointshi wa gago: ga o tlhoke go di dira. |
| `tasks.irrigation.title` | How is each field watered? | Hoe word elke veld natgelei? | Tshimo nngwe le nngwe e nosediwa jang? |
| `tasks.location.choose` | Say whether this is your farm, or tap I don't know – help me. | Sê of dit jou plaas is, of tik Ek weet nie – help my. | Bolela gore a ke polase ya gago, kgotsa tobetsa Ga ke itse – nthuse. |
| `tasks.optional` | Optional: you can leave this as it is. | Opsioneel: jy kan dit so los. | Ga go tlamege: o ka e tlogela jaaka e ntse. |
| `tasks.preferences` | Your preferences | Jou voorkeure | Dikeletso tsa gago |
| `tasks.preferences.about` | Language, your own password, the terms, Telegram and alerts. | Taal, jou eie wagwoord, die bepalings, Telegram en waarskuwings. | Puo, lefoko la gago la sephiri, melawana, Telegram le ditemoso. |
| `tasks.progress` | {task} · screen {n} of {of} | {task} · skerm {n} van {of} | {task} · sekirini {n} go {of} |
| `tasks.saveContinue` | Save and continue | Stoor en gaan voort | Boloka o tswelele |
| `tasks.saveFailed` | We couldn't save your changes. Your entries are still here. Try again. | Ons kon nie jou veranderinge stoor nie. Jou inskrywings is nog hier. Probeer weer. | Ga re a kgona go boloka diphetogo tsa gago. Se o se kwadileng se sa ntse se le fa. Leka gape. |
| `tasks.saveOffline` | No connection, so nothing was saved. Your entries are still here; try again when you have a signal. | Geen verbinding nie, dus is niks gestoor nie. Jou inskrywings is nog hier; probeer weer wanneer jy sein het. | Ga go na kgolagano, ka jalo ga go a bolokwa sepe. Se o se kwadileng se sa ntse se le fa; leka gape fa o na le kgolagano. |
| `tasks.saveReturn` | Save and go back | Stoor en gaan terug | Boloka o boele morago |
| `tasks.size.notSaved` | Not saved yet | Nog nie gestoor nie | Ga e ise e bolokwe |
| `tasks.size.optional` | Optional: leave it empty to keep what is saved, or let your installer measure it. | Opsioneel: los dit leeg om te hou wat gestoor is, of laat jou installeerder dit meet. | Ga go tlamege: e tlogele e se na sepe go boloka se se bolokilweng, kgotsa letla mointshi a e lekanye. |
| `tasks.size.saved` | Saved: {area} | Gestoor: {area} | E bolokilwe: {area} |
| `tasks.size.title` | How big is each field? | Hoe groot is elke veld? | Tshimo nngwe le nngwe e kana kang? |
| `tasks.soilType.title` | What is the soil like in each field? | Hoe is die grond in elke veld? | Mmu o ntse jang mo tshimong nngwe le nngwe? |
| `tasks.start` | Continue: {task} | Gaan voort: {task} | Tswelela: {task} |
| `tasks.tank.saved` | Saved: a {litres} L tank. Leave it as it is, or choose a new size and level. | Gestoor: 'n tenk van {litres} L. Los dit so, of kies 'n nuwe grootte en vlak. | E bolokilwe: tanka ya {litres} L. E tlogele jaaka e ntse, kgotsa tlhopha bogolo le boemo jo bošwa. |
| `tasks.title` | Your details | Jou besonderhede | Dintlha tsa gago |
| `tasks.toDo` | To do | Nog te doen | Go sa dirwa |
| `tasks.water` | Your water | Jou water | Metsi a gago |
| `tasks.water.about` | Where your water comes from, and your tank if you have one. | Waar jou water vandaan kom, en jou tenk as jy een het. | Kwa metsi a gago a tswang teng, le tanka fa o na le yone. |
| `tasks.water.choose` | Choose where your water comes from, or tap I don't know – help me. | Kies waar jou water vandaan kom, of tik Ek weet nie – help my. | Tlhopha kwa metsi a gago a tswang teng, kgotsa tobetsa Ga ke itse – nthuse. |
| `tasks.why` | Four short tasks. Answer what you know; tap I don't know – help me for the rest, and AgroFlow staff will help. | Vier kort take. Beantwoord wat jy weet; tik Ek weet nie – help my vir die res, en AgroFlow-personeel sal help. | Ditiro di le nne tse dikhutshwane. Araba se o se itseng; tobetsa Ga ke itse – nthuse mo go se se setseng, mme badiri ba AgroFlow ba tla thusa. |
| `telegram.alerts` | Alerts | Waarskuwings | Ditemoso |
| `telegram.disconnectBody` | AgroFlow will stop messaging you about your zones, your irrigation and your requests. | AgroFlow sal ophou om jou boodskappe oor jou sones, natlei en versoeke te stuur. | AgroFlow e tla emisa go go romelela melaetsa ka dikarolo, go nosetsa le dikopo tsa gago. |
| `telegram.disconnectTitle` | Disconnect Telegram? | Ontkoppel Telegram? | Kgaola Telegram? |
| `telegram.finishBody` | Press Start in Telegram, then come back here and pull to refresh. | Druk Start in Telegram, kom dan terug hierheen en trek af om te verfris. | Tobetsa Start mo Telegram, o bo o boele fa o gogele tlase go ntšhafatsa. |
| `telegram.finishTitle` | Finish in Telegram | Voltooi in Telegram | Fetsa mo Telegram |
| `telegram.status` | Status | Status | Maemo |
| `terms.accept` | I have read and accept the terms of service and the privacy notice. | Ek het die diensbepalings en die privaatheidskennisgewing gelees en aanvaar dit. | Ke badile e bile ke amogela melawana ya tirelo le kitsiso ya sephiri. |
| `terms.acceptedOn` | Accepted {date}. | Aanvaar {date}. | E amogetswe {date}. |
| `terms.doc.privacy` | privacy notice | privaatheidskennisgewing | kitsiso ya sephiri |
| `terms.doc.terms` | terms of service | diensbepalings | melawana ya tirelo |
| `terms.draft` | Draft – needs approval | Konsep – benodig goedkeuring | Tshekatsheko – e tlhoka go dumelelwa |
| `terms.englishOnly` | These drafts are in English for now. Translations follow once the documents are approved. | Hierdie konsepte is vir eers in Engels. Vertalings volg sodra die dokumente goedgekeur is. | Ditshekatsheko tse di ka Seesemane ga jaana. Diphetolelo di tla latela fa ditokomane di dumeletswe. |
| `terms.limits` | Watering needs the kit, power and a connection. When the kit does not answer, the app says No response rather than pretending it worked. | Natlei het die toerusting, krag en 'n verbinding nodig. Wanneer die toerusting nie antwoord nie, sê die toep Geen antwoord eerder as om voor te gee dit het gewerk. | Go nosetsa go tlhoka sedirisiwa, motlakase le kgolagano. Fa sedirisiwa se sa arabe, appe e bolela Ga go na karabo go na le go itira e kete go dirile. |
| `terms.loadFailed` | The document could not be loaded. | Die dokument kon nie gelaai word nie. | Tokomane ga e a kgona go tsenngwa. |
| `terms.optionalSeparate` | Telegram, community reports and your phone's location stay separate choices. You can change them any time in Settings. | Telegram, gemeenskapsverslae en jou foon se ligging bly aparte keuses. Jy kan dit enige tyd in Instellings verander. | Telegram, dipego tsa baagisani le lefelo la mogala wa gago di nna ditlhopho tse di farologaneng. O ka di fetola nako nngwe le nngwe mo Dipeakanyong. |
| `terms.read` | Read the {title} | Lees die {title} | Bala {title} |
| `terms.summary` | AgroFlow is a service: a field kit, this app and support from AgroFlow staff. Please read the terms and the privacy notice. Both are drafts that still need approval. | AgroFlow is 'n diens: toerusting op die veld, hierdie toep en ondersteuning van AgroFlow-personeel. Lees asseblief die bepalings en die privaatheidskennisgewing. Albei is konsepte wat nog goedkeuring nodig het. | AgroFlow ke tirelo: sedirisiwa sa kwa tshimong, appe e, le thuso go tswa go badiri ba AgroFlow. Tsweetswee bala melawana le kitsiso ya sephiri. Tsotlhe ke ditokomane tsa tshekatsheko tse di santseng di tlhoka go dumelelwa. |
| `terms.tickFirst` | Tick the box to accept the terms and the privacy notice. | Merk die blokkie om die bepalings en die privaatheidskennisgewing te aanvaar. | Tshwaya lebokose go amogela melawana le kitsiso ya sephiri. |
| `terms.title` | Before you start | Voordat jy begin | Pele o simolola |
| `terms.unavailable` | The terms could not be loaded. Check your connection and try again. | Die bepalings kon nie gelaai word nie. Kyk na jou verbinding en probeer weer. | Melawana ga e a kgona go tsenngwa. Tlhatlhoba kgolagano o bo o leke gape. |
| `terms.version` | Version {version}, {date} | Weergawe {version}, {date} | Kgatiso {version}, {date} |
| `terms.weDo` | AgroFlow installs and tests the kit, keeps the app and advice running, caps every watering run at your field's limit, and helps when you ask. | AgroFlow installeer en toets die toerusting, hou die toep en advies aan die gang, beperk elke natleibeurt tot jou veld se limiet, en help wanneer jy vra. | AgroFlow e tsenya e bile e leka sedirisiwa, e tsamaisa appe le dikgakololo, e lekanyetsa go nosetsa go ya ka tekanyetso ya tshimo, mme e thusa fa o kopa. |
| `terms.youDo` | You keep your password to yourself, keep the kit powered, check your crops and tell AgroFlow when something looks wrong. | Jy hou jou wagwoord vir jouself, hou die toerusting aan, kyk na jou gewasse en sê vir AgroFlow wanneer iets verkeerd lyk. | O boloka lefoko la sephiri e le la gago, o boloka sedirisiwa se na le motlakase, o tlhatlhoba dijalo mme o bolelela AgroFlow fa sengwe se sa siama. |
| `today.provenance.at` | worked out {at} | uitgewerk {at} | e dirilwe {at} |
| `today.provenance.crop` | For {model} | Vir {model} | Ya {model} |
| `today.provenance.cropModel` | Worked out with the {model} model for your crop | Uitgewerk met die {model}-model vir jou gewas | E dirilwe ka sekao sa {model} sa thobo ya gago |
| `today.provenance.missing` | no weather for {days} | geen weer vir {days} nie | ga go na maemo a loapi a {days} |
| `today.provenance.noCrop` | No crop set for this zone | Geen gewas vir hierdie sone gestel nie | Ga go na thobo e e tlhomilweng ya karolo e |
| `today.provenance.noWeather` | no saved weather yet | nog geen gestoorde weer nie | ga go ise go nne le maemo a loapi a a bolokilweng |
| `today.provenance.weather` | weather {from} to {to} | weer {from} tot {to} | maemo a loapi go tloga {from} go fitlha {to} |
| `weather.stale` | Weather out of date | Weer is verouderd | Maemo a loapi a kgologolo |
| `weather.unavailable` | Weather unavailable | Weer nie beskikbaar nie | Maemo a loapi ga a bonale |
| `weather.unavailableBody` | AgroFlow has no up-to-date forecast for this farm, so it cannot say whether it will rain. Check again later. | AgroFlow het geen bygewerkte voorspelling vir hierdie plaas nie, dus kan dit nie sê of dit gaan reën nie. Kyk later weer. | AgroFlow ga e na kitsiso e ntšha ya polase e, ka jalo ga e kgone go bolela gore pula e tla na. Leba gape moragonyana. |
| `weather.unknownShort` | Not known | Nie bekend nie | Ga go itsiwe |
| `weatherCard.failed` | We couldn’t retrieve the latest weather for this farm. | Ons kon nie die nuutste weer vir hierdie plaas kry nie. | Ga re a kgona go bona maemo a loapi a bosheng a polase e. |
| `weatherCard.loading` | Loading weather | Laai weer | Go tsenngwa maemo a loapi |
| `weatherCard.noLocation` | Weather needs a farm location | Weer het 'n plaasligging nodig | Maemo a loapi a tlhoka lefelo la polase |
| `weatherCard.noLocationBody` | Weather will be available once this farm has coordinates. | Weer sal beskikbaar wees sodra hierdie plaas koördinate het. | Maemo a loapi a tla bonala fa polase e na le dikhoorotineite. |
| `why.change` | What would change it | Wat dit sou verander | Se se ka se fetolang |
| `why.rule` | The rule | Die reël | Molao |
| `why.sure` | How sure we are | Hoe seker ons is | Re tlhomamisa go le kae |
| `why.used` | What we used | Wat ons gebruik het | Se re se dirisitseng |
| `zone.cropRow` | Crop and planting date | Gewas en plantdatum | Thobo le letlha la go jala |
| `zone.cropRowBody` | What is growing, and since when | Wat groei, en sedert wanneer | Se se golang, le go tloga leng |
| `zone.edit.crop` | Crop Type | Gewas | Thobo |
| `zone.edit.cropPlaceholder` | Tomatoes | Tamaties | Ditamati |
| `zone.edit.datePlaceholder` | YYYY-MM-DD | JJJJ-MM-DD | NNNN-KK-LL |
| `zone.edit.days` | Irrigation Days | Natleidae | Malatsi a go nosetsa |
| `zone.edit.location` | Location | Ligging | Lefelo |
| `zone.edit.locationPlaceholder` | North Field | Noordveld | Tshimo ya Bokone |
| `zone.edit.name` | Zone Name | Sonenaam | Leina la karolo |
| `zone.edit.namePlaceholder` | Zone 1 | Sone 1 | Karolo 1 |
| `zone.edit.planting` | Planting Date | Plantdatum | Letlha la go jala |
| `zone.edit.scheduleTitle` | Edit Schedule | Wysig skedule | Fetola thulaganyo |
| `zone.edit.start` | Start Time | Begintyd | Nako ya go simolola |
| `zone.edit.title` | Edit Zone & Automation | Wysig sone en outomatisering | Fetola karolo le boitiriso |
| `zone.edit.weather` | Weather Adjustment | Weeraanpassing | Go fetola go ya ka maemo a loapi |
| `zone.edit.weatherBody` | Delay automatic irrigation when rain is expected. | Stel outomatiese natlei uit wanneer reën verwag word. | Diegisa go nosetsa ka boitiriso fa pula e solofetswe. |
| `zone.err.dateFormat` | Enter the planting date in YYYY-MM-DD format. | Voer die plantdatum in as JJJJ-MM-DD. | Kwala letlha la go jala ka sebopego sa NNNN-KK-LL. |
| `zone.err.dateFuture` | Planting date must be a valid date that is not in the future. | Die plantdatum moet 'n geldige datum wees wat nie in die toekoms is nie. | Letlha la go jala le tshwanetse go siama le se nne mo isagong. |
| `zone.err.dateTitle` | Invalid Planting Date | Ongeldige plantdatum | Letlha la go jala le le sa siamang |
| `zone.err.days` | Select at least one irrigation day. | Kies ten minste een natleidag. | Tlhopha bonnye letsatsi le le lengwe la go nosetsa. |
| `zone.err.daysTitle` | Choose Irrigation Days | Kies natleidae | Tlhopha malatsi a go nosetsa |
| `zone.err.duration` | Enter a duration between 1 and 1440 minutes. | Voer 'n duur tussen 1 en 1440 minute in. | Kwala paka fa gare ga metsotso e le 1 le 1440. |
| `zone.err.durationTitle` | Invalid Duration | Ongeldige duur | Paka e e sa siamang |
| `zone.err.missing` | Enter a zone name, location, and crop type. | Voer 'n sonenaam, ligging en gewas in. | Kwala leina la karolo, lefelo le thobo. |
| `zone.err.missingTitle` | Missing Zone Details | Sonebesonderhede ontbreek | Dintlha tsa karolo di a tlhaela |
| `zone.err.modeTitle` | Could Not Change Mode | Kon nie modus verander nie | Ga go a kgonega go fetola mokgwa |
| `zone.err.moisture` | Moisture values must be between 0 and 100. | Vogwaardes moet tussen 0 en 100 wees. | Dipalo tsa bongola di tshwanetse go nna fa gare ga 0 le 100. |
| `zone.err.moistureTitle` | Invalid Moisture Values | Ongeldige vogwaardes | Dipalo tsa bongola tse di sa siamang |
| `zone.err.range` | The start threshold must be lower than the desired moisture level. | Die beginvlak moet laer wees as die gewenste vogvlak. | Boemo jwa go simolola bo tshwanetse go nna kwa tlase ga bongola jo bo batlegang. |
| `zone.err.rangeTitle` | Invalid Automation Range | Ongeldige reeks | Tekanyo e e sa siamang |
| `zone.err.saveTitle` | Could Not Update Zone | Kon nie sone opdateer nie | Ga go a kgonega go fetola karolo |
| `zone.err.scheduleTitle` | Could Not Update Schedule | Kon nie skedule opdateer nie | Ga go a kgonega go fetola thulaganyo |
| `zone.err.start` | Enter the time as HH:MM, for example 05:30. | Voer die tyd in as UU:MM, byvoorbeeld 05:30. | Kwala nako jaaka UU:MM, sekao 05:30. |
| `zone.err.startTitle` | Invalid Start Time | Ongeldige begintyd | Nako ya go simolola e e sa siamang |
| `zone.finishSetup` | Finish setup | Voltooi opstelling | Fetsa go baakanya |
| `zone.finishSetupBody` | Planting date and size, for surer advice | Plantdatum en grootte, vir sekerder advies | Letlha la go jala le bogolo, go bona kgakololo e e tlhomameng |
| `zone.kitRow` | Your kit | Jou toerusting | Sedirisiwa sa gago |
| `zone.kitRowBody` | Is it working, and change its WiFi | Werk dit, en verander sy WiFi | A se a dira, le go fetola WiFi ya sone |
| `zone.row.scheduleState` | Schedule | Skedule | Thulaganyo |
| `zone.saved` | The zone settings were saved to Supabase. | Die sone se instellings is gestoor. | Dipeakanyo tsa karolo di bolokilwe. |
| `zone.savedTitle` | Zone Updated | Sone opgedateer | Karolo e fetotswe |
| `zone.scheduleSavedTitle` | Schedule Updated | Skedule opgedateer | Thulaganyo e fetotswe |
| `zone.simulated` | SIMULATED | GESIMULEER | E ETSISITSWE |
| `zone.soilRow` | Soil type | Grondsoort | Mofuta wa mmu |
| `zone.soilRowBody` | How much water your soil holds | Hoeveel water jou grond hou | Gore mmu wa gago o tshwara metsi a le kae |
| `zone.teachRow` | Teach the sensor your soil | Leer die sensor jou grond | Ruta sesupo mmu wa gago |
| `zone.teachRowBody` | Your installer saves a wet and a dry reading | Jou installeerder stoor 'n nat en 'n droë lesing | Mointshi wa gago o boloka palo ya metsi le ya go oma |
| `zone.val.minutes` | {n} min | {n} min | {n} metsotso |
| `zone.val.rainMm` | Yes, {mm} mm | Ja, {mm} mm | Ee, {mm} mm |
| `zone.val.schedule.active` | Active | Aktief | E a dira |
| `zone.val.schedule.default` | Not saved yet (suggested values only) | Nog nie gestoor nie (net voorgestelde waardes) | Ga e ise e bolokwe (ke ditshitshinyo fela) |
| `zone.val.schedule.inactive` | Inactive (saved, but this zone is not watering by schedule) | Onaktief (gestoor, maar hierdie sone word nie volgens skedule natgelei nie) | Ga e dire (e bolokilwe, mme karolo e ga e nosediwe ka thulaganyo) |
| `zone.val.scheduleCapped` | {minutes} min each run (saved as {saved} min; capped to {max} min, this zone's limit) | {minutes} min per beurt (gestoor as {saved} min; beperk tot {max} min, hierdie sone se limiet) | {minutes} metsotso ka nako nngwe le nngwe (e bolokilwe jaaka {saved} metsotso; e lekanyeditswe go {max} metsotso, tekanyetso ya karolo e) |
| `zone.weekAhead` | The week ahead | Die week wat kom | Beke e e tlang |
| `zone.weekAheadBody` | Weather and watering advice for 7 days | Weer- en natleiadvies vir 7 dae | Maemo a loapi le kgakololo ya go nosetsa ya malatsi a le 7 |

## Release, 23 October 2026 (merge/oct23-release)

New strings from wiring the redesign to the real contracts (Settings → Terms & privacy, and the Help and documents heading). Afrikaans and Setswana are drafts. Codex's own `visual.*` strings (PR #3) are drafts too; Codex lists them in docs/visual-revision.md.

| Key | English | Afrikaans (draft) | Setswana (draft) |
|---|---|---|---|
| `legal.acceptedOn` | You accepted these on {date}. | Jy het dit op {date} aanvaar. | O di amogetse ka {date}. |
| `legal.failed` | Could not load the documents. Check your connection and try again. | Kon nie die dokumente laai nie. Kyk na jou verbinding en probeer weer. | Dikwalo ga di a kgona go laela. Tlhatlhoba kgokagano ya gago o leke gape. |
| `legal.loading` | Loading the documents… | Laai die dokumente… | Go laela dikwalo… |
| `legal.notAccepted` | Not accepted yet. You accept them in Your preferences, under Before you start. | Nog nie aanvaar nie. Jy aanvaar dit in Jou voorkeure, onder Voor jy begin. | Ga di ise di amogelwe. O di amogela mo Dikeletso tsa gago, ka fa tlase ga Pele o simolola. |
| `legal.read` | Read {title} | Lees {title} | Bala {title} |
| `legal.version` | Version {version}, {date} | Weergawe {version}, {date} | Kgatiso {version}, {date} |
| `settings.helpDocs` | Help and documents | Hulp en dokumente | Thuso le dikwalo |
