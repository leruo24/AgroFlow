namespace AgroFlow.Api.Services.Notifications;

// The Telegram messages farmers get most, in the language they chose in the app
// (profile.language, migration 0049): English, Afrikaans and Setswana. English is the
// source; the Afrikaans and Setswana lines are first drafts to be checked by a first-language
// speaker (docs/translations-review.md, "Telegram"). A missing key falls back to English.
//
// Get("af", "zone.title") -> "Hierdie sone het water nodig". {name} placeholders are filled
// from the arguments.
public static class BotText
{
    public static readonly IReadOnlyList<string> Languages = new[] { "en", "af", "tn" };

    public static string Normalise(string? language) =>
        language is not null && Languages.Contains(language) ? language : "en";

    public static string Get(string? language, string key, params (string Name, object Value)[] args)
    {
        var lang = Normalise(language);
        var text = Catalogue.TryGetValue(lang, out var strings) && strings.TryGetValue(key, out var found)
            ? found
            : Catalogue["en"].TryGetValue(key, out var english) ? english : key;

        foreach (var (name, value) in args)
        {
            text = text.Replace("{" + name + "}", Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture));
        }
        return text;
    }

    public static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Catalogue =
        new Dictionary<string, IReadOnlyDictionary<string, string>>
        {
            ["en"] = new Dictionary<string, string>
            {
                ["reset.code"] = "Your AgroFlow code is {code}. It works for 10 minutes.\n\nIf this wasn't you, ignore this and tell AgroFlow.",
                ["reset.done"] = "Your password was changed. If this wasn't you, tell AgroFlow straight away.",
                ["reset.admin"] = "AgroFlow has given you a new temporary password: {password}\n\nSign in with {email} and this password within 72 hours, then choose your own.",
                ["welcome.title"] = "Welcome to AgroFlow, {name}. Your account is ready.",
                ["welcome.location"] = "Location: {location}",
                ["welcome.signin"] = "Sign in with:",
                ["welcome.email"] = "Email: {email}",
                ["welcome.password"] = "Temporary password: {password}",
                ["welcome.change"] = "It works for 72 hours. You will choose your own password the first time you sign in.",
                ["welcome.app"] = "The AgroFlow app: {link}",
                ["welcome.button.hint"] = "Or tap the button to sign in straight away (it works once, for 24 hours).",
                ["welcome.button"] = "Sign in to AgroFlow",
                ["why"] = "Why: {summary}",
                ["farm"] = "Farm: {name}",
                ["zone"] = "Zone: {name}",
                ["when"] = "When: {when}",

                ["zone.title"] = "This zone needs water",
                ["zone.reading"] = "Soil sensor reading: {value}",
                ["zone.manual.cause"] = "This zone is set to manual, so AgroFlow has not watered it.",
                ["zone.manual.action"] = "Start it from the app, or switch the zone back to automatic.",
                ["zone.nodevice.cause"] = "There is no working device on this zone, so AgroFlow cannot water it.",
                ["zone.nodevice.action"] = "Please water it yourself and tell us the device needs attention.",
                ["zone.pump.cause"] = "AgroFlow asked the pump to water this zone and it did not respond.",
                ["zone.pump.action"] = "Please check the pump, and water the zone yourself if you can.",

                ["tank.low"] = "Your tank is getting low — refill and log the reading.",
                ["kit.connected"] = "Your AgroFlow kit for {zone} is connected. If you ever change your Wi-Fi, its setup network is {name}, password {password}. Open the app → Kit for the steps.",

                ["rain.title"] = "Heavy rain expected",
                ["rain.value"] = "Expected rainfall: {value} mm",
                ["rain.body"] = "AgroFlow does not pause automatic watering for rain yet, so zones on automatic will still water on their own soil moisture readings.",
                ["rain.action"] = "If you do not want that, switch those zones to manual in the app before then. Check your drainage and anything that could wash away.",
                ["frost.title"] = "Frost expected",
                ["frost.value"] = "Expected low: {value} C",
                ["frost.body"] = "Frost can damage or kill young plants overnight.",
                ["frost.action"] = "Cover what you can, and avoid watering late in the day before it - wet soil overnight makes frost damage worse.",
                ["heat.title"] = "Heat expected",
                ["heat.value"] = "Expected high: {value} C",
                ["heat.body"] = "Crops lose a lot of water on days like this and can scorch.",
                ["heat.action"] = "Water early in the morning rather than in the heat of the day, and check on young or shallow-rooted zones.",
            },
            ["af"] = new Dictionary<string, string>
            {
                ["reset.code"] = "Jou AgroFlow-kode is {code}. Dit werk vir 10 minute.\n\nAs dit nie jy was nie, ignoreer dit en laat weet AgroFlow.",
                ["reset.done"] = "Jou wagwoord is verander. As dit nie jy was nie, laat weet AgroFlow dadelik.",
                ["reset.admin"] = "AgroFlow het vir jou 'n nuwe tydelike wagwoord gegee: {password}\n\nMeld binne 72 uur aan met {email} en hierdie wagwoord, en kies dan jou eie.",
                ["welcome.title"] = "Welkom by AgroFlow, {name}. Jou rekening is gereed.",
                ["welcome.location"] = "Ligging: {location}",
                ["welcome.signin"] = "Meld aan met:",
                ["welcome.email"] = "E-pos: {email}",
                ["welcome.password"] = "Tydelike wagwoord: {password}",
                ["welcome.change"] = "Dit werk vir 72 uur. Jy kies jou eie wagwoord die eerste keer dat jy aanmeld.",
                ["welcome.app"] = "Die AgroFlow-toep: {link}",
                ["welcome.button.hint"] = "Of tik op die knoppie om dadelik aan te meld (dit werk een keer, vir 24 uur).",
                ["welcome.button"] = "Meld aan by AgroFlow",
                ["why"] = "Hoekom: {summary}",
                ["farm"] = "Plaas: {name}",
                ["zone"] = "Sone: {name}",
                ["when"] = "Wanneer: {when}",

                ["zone.title"] = "Hierdie sone het water nodig",
                ["zone.reading"] = "Grondsensorlesing: {value}",
                ["zone.manual.cause"] = "Hierdie sone is op handbeheer, so AgroFlow het dit nie water gegee nie.",
                ["zone.manual.action"] = "Begin dit vanuit die toep, of stel die sone terug op outomaties.",
                ["zone.nodevice.cause"] = "Daar is geen werkende toestel op hierdie sone nie, so AgroFlow kan dit nie water gee nie.",
                ["zone.nodevice.action"] = "Gee dit asseblief self water en laat weet ons die toestel het aandag nodig.",
                ["zone.pump.cause"] = "AgroFlow het die pomp gevra om hierdie sone water te gee en dit het nie gereageer nie.",
                ["zone.pump.action"] = "Kyk asseblief na die pomp, en gee die sone self water as jy kan.",

                ["tank.low"] = "Jou tenk raak leeg — vul dit en teken die lesing aan.",
                ["kit.connected"] = "Jou AgroFlow-stel vir {zone} is gekoppel. As jy ooit jou Wi-Fi verander, is sy opstelnetwerk {name}, wagwoord {password}. Maak die toepassing oop → Stel vir die stappe.",

                ["rain.title"] = "Swaar reën verwag",
                ["rain.value"] = "Verwagte reënval: {value} mm",
                ["rain.body"] = "AgroFlow stel outomatiese besproeiing nog nie uit vir reën nie, so sones op outomaties sal steeds volgens hul eie grondvoglesings water kry.",
                ["rain.action"] = "As jy dit nie wil hê nie, stel daardie sones voor die tyd op handbeheer in die toep. Kyk na jou dreinering en enigiets wat kan wegspoel.",
                ["frost.title"] = "Ryp verwag",
                ["frost.value"] = "Verwagte laagste: {value} C",
                ["frost.body"] = "Ryp kan jong plante oornag beskadig of doodmaak.",
                ["frost.action"] = "Bedek wat jy kan, en moenie laat in die dag daarvoor water gee nie - nat grond oornag maak rypskade erger.",
                ["heat.title"] = "Hitte verwag",
                ["heat.value"] = "Verwagte hoogste: {value} C",
                ["heat.body"] = "Gewasse verloor baie water op dae soos hierdie en kan verskroei.",
                ["heat.action"] = "Gee vroeg in die oggend water eerder as in die hitte van die dag, en kyk na jong of vlak gewortelde sones.",
            },
            ["tn"] = new Dictionary<string, string>
            {
                ["reset.code"] = "Khoutu ya gago ya AgroFlow ke {code}. E dira metsotso e le 10.\n\nFa e se wena, e tlogele mme o itsise AgroFlow.",
                ["reset.done"] = "Lefoko la gago la sephiri le fetotswe. Fa e se wena, itsise AgroFlow ka bonako.",
                ["reset.admin"] = "AgroFlow e go neile lefoko le lesha la sephiri la nakwana: {password}\n\nTsena ka {email} le lefoko le mo diureng di le 72, morago o itlhophele la gago.",
                ["welcome.title"] = "O amogetswe mo AgroFlow, {name}. Akhaonto ya gago e siametse.",
                ["welcome.location"] = "Lefelo: {location}",
                ["welcome.signin"] = "Tsena ka:",
                ["welcome.email"] = "Imeile: {email}",
                ["welcome.password"] = "Lefoko la sephiri la nakwana: {password}",
                ["welcome.change"] = "Le dira diura di le 72. O tla itlhophela lefoko la gago la sephiri la ntlha fa o tsena.",
                ["welcome.app"] = "Appe ya AgroFlow: {link}",
                ["welcome.button.hint"] = "Kgotsa tobetsa konopo go tsena ka bonako (e dira gangwe fela, mo diureng di le 24).",
                ["welcome.button"] = "Tsena mo AgroFlow",
                ["why"] = "Ka ntlha ya eng: {summary}",
                ["farm"] = "Polasi: {name}",
                ["zone"] = "Karolo: {name}",
                ["when"] = "Leng: {when}",

                ["zone.title"] = "Karolo eno e tlhoka metsi",
                ["zone.reading"] = "Palo ya sensara ya mmu: {value}",
                ["zone.manual.cause"] = "Karolo eno e beilwe go dirisiwa ka seatla, ka jalo AgroFlow ga e a e nosetsa.",
                ["zone.manual.action"] = "E simolole mo appeng, kgotsa o busetse karolo go nosetsa ka boyona.",
                ["zone.nodevice.cause"] = "Ga go na sedirisiwa se se dirang mo karolong eno, ka jalo AgroFlow ga e kgone go e nosetsa.",
                ["zone.nodevice.action"] = "Tswee-tswee e nosetse ka bowena mme o re itsise gore sedirisiwa se tlhoka tlhokomelo.",
                ["zone.pump.cause"] = "AgroFlow e kopile pompo go nosetsa karolo eno mme ga e a araba.",
                ["zone.pump.action"] = "Tswee-tswee tlhola pompo, mme o nosetse karolo ka bowena fa o kgona.",

                ["tank.low"] = "Tanka ya gago e a fela — e tlatse mme o kwale palo.",
                ["kit.connected"] = "Sediriswa sa gago sa AgroFlow sa {zone} se golaganye. Fa o ka fetola Wi-Fi ya gago, neteweke ya sone ya go baakanya ke {name}, lefoko la sephiri {password}. Bula tiriso → Sediriswa go bona dikgato.",

                ["rain.title"] = "Go lebeletswe pula e ntsi",
                ["rain.value"] = "Pula e e lebeletsweng: {value} mm",
                ["rain.body"] = "AgroFlow ga e ise e emise nosetso ka boyona fa go na le pula, ka jalo dikarolo tse di nosetsang ka boyona di tla nna di nosetsa go ya ka bongola jwa mmu.",
                ["rain.action"] = "Fa o sa batle seo, fetola dikarolo tseo go nna tsa seatla mo appeng pele ga nako eo. Tlhola tsamaiso ya metsi le sengwe le sengwe se se ka kgokolosiwang.",
                ["frost.title"] = "Go lebeletswe serame",
                ["frost.value"] = "Bokgutshwane jo bo lebeletsweng: {value} C",
                ["frost.body"] = "Serame se ka senya kgotsa sa bolaya dimela tse dinnye bosigo.",
                ["frost.action"] = "Khurumetsa se o ka se kgonang, mme o se ka wa nosetsa thapama pele ga sone - mmu o o metsi bosigo o oketsa tshenyo ya serame.",
                ["heat.title"] = "Go lebeletswe mogote",
                ["heat.value"] = "Bogodimo jo bo lebeletsweng: {value} C",
                ["heat.body"] = "Dijalo di latlhegelwa ke metsi a mantsi ka malatsi a a ntseng jaana mme di ka fisega.",
                ["heat.action"] = "Nosetsa phakela go na le mo mogoteng wa motshegare, mme o tlhole dikarolo tse dinnye kgotsa tse di nang le medi e e sa tseneng thata.",
            },
        };
}
