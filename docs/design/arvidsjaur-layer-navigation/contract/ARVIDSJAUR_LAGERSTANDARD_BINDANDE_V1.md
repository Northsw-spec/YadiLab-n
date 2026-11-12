# YadiLab · Arvidsjaur-standarden för lagerbaserad topologinavigering

**Bindande arkitektur- och acceptanskontrakt · AV-001 · 12 november 2026**  
**Status:** SPECIFIKATION, **inte implementerad eller visuellt godkänd**.  
**Prioritet:** Slutföra PROJECT-094 i befintlig PR #105 före annan utveckling.  
**Arbetsregel:** Ingen ny PR, ingen ändring av `main`, ingen merge och inget `visualApproved=PASS` utan uttryckligt användargodkännande.

## 0. Den enda normativa bilden

**Normativ fil:** `03_EVIDENS/Arvidsjaur_Standarden_2026-11-12.png`  
**Användarens filnamn:** `Arvidsjaur (Standarden).png`  
**Dimension:** 1920 × 1200  
**SHA-256:** `8eb2417aef038a2c02dc9866f49709874c4e2ded2c88fd5442df98d8bfed834c`

![Användarens uttryckligen fastställda Arvidsjaur-standard. Detta är det faktiska originalet, inte en nygenererad tolkning.](../03_EVIDENS/Arvidsjaur_Standarden_2026-11-12.png)

Den äldre bilden `Perfekt, helt godkänt.png` har **annan SHA-256** och får inte ersätta denna version. I bilden syns ett mörkt, diskret rutnät och många **avgränsade, rubriksatta grupprektanglar** ordnade i en konsekvent läsbar rutnätsrytm. I varje grupp ligger **enskilda ikonförsedda enhetskort** i ordnade korta rader/kolumner, med synliga **horisontella och vertikala** länksegment både inom och mellan grupper. Layouten är luftig på gruppnivå men kompakt inom gruppen. Referensen visar ungefär fem gruppkolumner över tre rader i just denna vy; **exakt antal kolumner och grupper är inte ett krav** för andra faktiska nätverk.

**Kravet är samma visuella grammatik på VARJE lager; inte ett pixelperfekt avtryck, och aldrig identiska påhittade noder/grupper/kablar.**

## 1. Användarens faktiska produktkrav – ingen omtolkning

> ”Varje lager i navigeringen” betyder en **lök som skalas lager för lager**, inspirerad av Blenders Scene Layers i version 2.7: olika objekt/subtopologier kan avgränsas och döljas/visas. **Arvidsjaur-strukturen/layouten gäller på VARJE LAGER.**

### Begrepp som inte får blandas ihop

| Begrepp | Exakt innebörd | Är inte |
|---|---|---|
| **Lager / navigationsscope** | En självständig, begränsad **topologikarta** över en verifierbar delmängd av samma kanoniska nätverk, med egen gruppstruktur, kabelgeometri och navigationsposition. Kan öppnas, stängas, gås tillbaka till och vid behov isoleras. | Zoomnivå, färgfilter, OSI-lager, VLAN eller beskuren skärmbild. |
| **Föräldralager** | Kartan från vilken användaren öppnade en djupare delkarta. Har egen Arvidsjaur-struktur. | En global bakgrundsgraf som bara förstoras. |
| **Barnlager** | En ny, självständig Arvidsjaur-strukturerad karta, där urvalet består av dokumenterade relevanta resurser och länkar. | En kamera som `setCenter` på samma platta graf. |
| **Presentationsgrupp** | Tydligt markerad visuell gruppering av redan existerande noder. Kan härledas av läsbarhetsskäl och är då *derived-navigation*, inte dokumenterat nätverksfaktum. | Ny enhet, fysisk zon, brygga eller fysisk kabel. |
| **Kameraläge** | `READ` = läsbar, fokuserad detaljvy; `OVERVIEW` = orienterande översikt av **aktuellt** lager. | Byte av lager. |
| **Visa/dölj** | Reversibelt, visningsbundet urval av presentationsgrupper inom lagret. Visas med utelämnade antal och kan återställas. | Radering ur projekt eller ändring av dokumenterad topologi. |

### Ett korrekt navigationsförlopp

1. Öppna nätverk: **Lager 0 / global topologikarta** i Arvidsjaur-grammatik.
2. Välj en dokumenterad eller tydligt märkt presentationsgrupp/ankarnod: öppna **Lager 1** – en **ny** karta, uppställd enligt samma Arvidsjaur-grammatik.
3. Fortsätt till **Lager 2, 3 ...** så långt den verkliga topologin och den verifierade navigationsrelationen tillåter. Inga falska extra lager fabriceras.
4. Breadcrumbs, Tillbaka och eventuellt Framåt återställer rätt scope, sida, markering och rimlig kamerakontext. Att växla READ/OVERVIEW ändrar **aldrig** lagrets identitet.
5. Visa/dölj eller isolera grupper inom lagret är endast ett presentationsurval. Dokumenterade noder/länkar finns kvar i källmodellen, och UI redovisar tydligt vad som är dolt/utanför scope.

**Samma Arvidsjaur-grammatik gäller varje verklig toppologikarta, oavsett om den nås från Excelimport, annan befintlig dokumentimport eller ett befintligt `.yadilab`-projekt.** Där ingen tillräcklig nätverksmodell finns ska YadiLab inte konstruera en artificiell hierarki.

## 2. Fem icke förhandlingsbara konstruktionsregler

**R1 – Struktur före optimeringspoäng.** Först bevaras den källhärledda scope-/gruppstrukturen och läsordningen, sedan optimerar ELK placering och ortogonala rutter **inom dessa begränsningar**. ELK får inte fritt placera samtliga resursnoder och rita grupprektanglar retroaktivt, om det förstör Arvidsjaurs sammanhållna grupper. Kortare kabel är aldrig ensam acceptansgrund.

**R2 – Enhetskort inne i rätt grupp.** Varje synlig nod tillhör högst en synlig presentationsgrupp inom aktuellt lager. Gruppbehållaren omsluter medlemmarna med ett **separat reserverat rubrikband**. Enhetskort får inte överlappa någon annan grupps rubrik, andra kort eller gruppens ram. Gruppetiketter får aldrig täcka kabeländpunkter eller enhetsnamn. Grupper med 1–2 noder ska fortfarande vara tydliga, inte försvinna.

**R3 – Läsbar ordning.** Gruppbehållare bildar en begriplig läsriktning (vänster→höger och uppifrån→ned) och ett konsekvent rutnät eller välordnade rader med luckor; korten inom grupper ligger i små sammanhållna rader/kolumner. En root/ankarnod får en igenkännbar, synlig plats. Inga extrema långsträckta ”linjer med objekt”, inga grupper i godtyckliga höjder som enbart optimerar kabellängd. Responsivt mobilformat kan gå till färre gruppkolumner men **inte** överge grammatiken.

**R4 – Kablar visar endast källa.** En riktig ritad fysisk länk måste motsvara ett verkligt, känt kanoniskt connection-ID med rätt två endpoints. Orthogonal segments and view-only attachment handles are allowed as rendering geometry; they **do not create physical ports**. Ingen inferred VLAN, port, route, switch, device, segment eller falsk relation. Ett scope-filter får inte tyst slänga kablar: intern/boundary/external redovisas med korrekta antal, och gränser visualiseras som navigationsinformation, inte falska kabelanslutningar.

**R5 – Kamera hör till korrektheten.** Användarens första läsvy i varje nytt scope måste visa aktiv ankarnod och tillräckligt med närliggande gruppkontext för att orientera sig. Scope-byte får inte lämna en resttransform från förra grafen. READ får rullas/panoreras, men får inte börja med fokusswitchen avskuren. OVERVIEW ska visa begriplig lagernivå och möjlighet att gå till READ; för täta lager används en verklig nivå/urval, inte oläsbar mikroskrift som kallas ”läsbar”.

## 3. Layoutkontrakt – från modelldata till bild

**3.1 Dataselektion.** Bygg från kanoniska resurs-/länk-ID:n, faktiska zoner och explicita roller. `HierarchicalTopologyView` väljer exakt ett scope och redovisar nod-ID:n, kant-ID:n, gränslänkar och utelämnade antal. Scope-kartan är en **vy/projektion**, inte en mutation av källan.

**3.2 Gruppkontrakt.** Använd deklarerade zoner före presentationsgrupper. Om dokumenterade zoner inte finns, får härledda visningsgrupper baseras på explicit källa, roll/ankarförbindelser eller deterministisk uppdelning av samma kända noder; märk dem `derived-navigation`. Grupperna är visuella behållare, inte Engine-fakta. En nods grupp-ID och medlemslista måste kunna testas mot bildens faktiska DOM-geometri.

**3.3 Geometriskt kontrakt.** Reservutrymme för grupphuvud/rubrik. Definiera gruppens innehållsyta, där **varje medlemskorts hela skärm-/grafrektangel** ligger innanför. Gruppens rektangel får inte omfatta orelaterade kort. Grupper och kort ska ha stabil och deterministisk ordning för identisk input + scope + viewport-klass. ELK får välja väg mellan förankrade grupper, inte omdefiniera dem efteråt utan test.

**3.4 Kabelkontrakt.** Dra ortogonala rutter från faktiska eller uttryckligen view-only anslutningshandtag. Inga diagonala fysiska kabelsegment; ingen nodpenetration; ingen kabel över ordinarie text-/rubrikytor. Mät *separat* verkliga korsningar, samma-linje-kollinjära överlapp, närhet till kort/rubriker och längd. Vid ofrånkomlig täthet: tydlig fokuserad delvy eller deklarerat visualiseringshinder, aldrig automatiskt bortfall/fabricering.

**3.5 Responsiv rendering.** Layoutens visuella grammatik består på 1366×768, 1280×800, 1920×1080 och 390×844. På mobil kan färre gruppkolumner och zoom-/panoreringsflöden användas; alla enheter behöver inte vara textläsbara samtidigt. Aktuellt scope, fokus och tillbaka ska alltid vara synligt/användbart.

**3.6 Kontraktsmässigt läge vid okänt.** Saknas dokumenterad struktur får en neutral visuell grupp skapas som **presentation** men aldrig namnges till exempel ”distribution core”, ”VLAN 10” eller ”fysisk rack” utan källa. ”No documented topology” måste hanteras som sådant – inte en illusorisk fullständig karta.

## 4. Bindande kamera- och läsbarhetsgrindar

| Kontroll | Krav | Vad som inte duger |
|---|---|---|
| READ fokuskort | Hela aktiva nodens skärmrektangel ligger i **topologipanelens rektangel** med ≥16 px fri marginal på desktop. På smal mobil rimlig säker marginal som inte klipper kortet. | Att endast `setCenter(...)` anropats. |
| READ primär etikett | För synliga, avsedda läsbara kort: **faktisk renderad texthöjd/effektiv skärmfont ≥13 px** på desktop. | `getComputedStyle(fontSize)` före ReactFlow-zoom. |
| READ sekundär etikett | För motsvarande synliga sekundärrader: **≥11 px i faktisk skärmstorlek**. | Att en font var 11 px i CSS före transform. |
| OVERVIEW | Grupphelheten orienterbar och zoom-/drill-down till READ möjligt. Inga verkliga kort oavsiktligt beskurna i det valda översiktsurvalet; minst 12 px panelmarginal där innehåll fit:as. | Att krympa 40+ kort till mikroskopisk text och kalla det READ. |
| Grupphuvud | Rubrikband separat, inte i medlemskortens yta; varje rubrik läsbar i avsett READ-läge. | Header som läggs ovanpå root/kablar. |
| Navigation | Efter drill, back, breadcrumb, byte READ↔OVERVIEW, resize, remount: rätt scope och fokus; ingen äldre asynkron ELK-layout får skriva över aktuell karta. | Att knapparnas `aria-pressed` stämmer men bilden visar ett annat scope. |

Mät i verklig kompilerad Chromium med skärmrektanglar (`getBoundingClientRect`), verklig viewporttransform/DOMMatrix eller motsvarande geometriskt bevis. **Siffergränserna är hårda läsbarhetsgrindar**, inte en ersättning för visuell jämförelse mot originalet.

## 5. Befintlig PR #105: verifierat utgångsläge och orsakshypoteser

**Historisk kontrollerad baslinje vid denna granskning:** PR #105 OPEN, huvud `945465b61b77948764364b5fc61355287f15ca5f`, `main` `8b75e344b702a3ad645759b89ef47720952ec424`; tre obligatoriska CI-kontroller SUCCESS. Alla dessa måste hämtas på nytt av Luna – historiska SHA får aldrig hårdkodas i utvecklingskoden.

**Verifierad kodnivå:** `ui/src/canvas/hierarchical-topology.ts` skapar `NavigationGroup` och `layoutStrategy: "arvidsjaur-grouped-orthogonal"`. `ui/src/canvas/topology-elk-adapter.ts` bygger i dagsläget ELK-graf från **resursnoder** i en platt layout, flyttar dessa enligt ELK och **beräknar gruppoverlay efter placeringen**. Den befintliga `layout/src/types.ts` och `layout/src/elk-backend.ts` har stöd för nästlade `children`, men adaptern nyttjar inte detta för att garantera gruppinnehåll och läsordning. **Arkitektonisk konsekvens:** En gruppetikett + post hoc bounding rectangle är inte samma sak som en grupplåst layout.

**Visuell blockerare:** På en verklig Chromium READ 1366×768 ligger `access-0025` y≈52–107, medan panelens synliga y börjar ≈208. Kameratestet `tests/acceptance/run_project094_topology_engine_real_browser.py` läser endast CSS-fontstorlek (`getComputedStyle(...).fontSize`) och sätter kameragaten till konstant `"PASS"` i rapporten. Därmed är grön CI inte bevis på Arvidsjaur-korrekt layout eller kamera.

**Reproduktionsfil:** `03_EVIDENS/PR105_access25_READ_1366x768_BEFORE.png`.  
**Berörd kod:** `ui/app/main.mjs` (`runInitialFit`, `repairVisualGeometry`, `changeTopologyCameraMode`, `focusTopologyNode`, breadcrumbs), `ui/src/canvas/hierarchical-topology.ts`, `ui/src/canvas/topology-elk-adapter.ts`, `layout/src/types.ts`, `layout/src/elk-backend.ts` (granska före eventuellt ingrepp), tests ovan samt `tests/acceptance/run_project091_arvidsjaur_layout_real_browser.py`.

### Arkitekturval för implementation – ingen fri omtolkning

**Norm:** Använd samma befintliga ELK-backend och verkliga source-derived nodes/edges. Ge de definierade grupperna **layoutmässig auktoritet** före slutlig ELK-placering. Befintligt `LayoutGraphNode.children` är det första tekniska spåret att undersöka och styrka med en isolerad fixture för *grupper med intern och korsgrupps-kabel*; detta är möjligt i datakontraktet men **ännu inte bevisat fungera korrekt för dagens adapter/world-space routes**. Prototypen måste bevisa giltiga endpoints/sektioner och innehållande grupprektanglar.

Om den vägen inte kan uppfylla kontraktet utan att förstöra gamla tester får Luna **inte** byta till en annan fri grafmotor, manuell påhittad kabeldragning eller tyst sämre fallback. Rapportera exakt blockerare, minimal alternativ design och nödvändigt arkitekturbeslut **före** produktpatch. Användaren äger godkännandet av visuella avsteg.

Bevara `C-role-aware-fanout` och tidigare numeriska förbättringar som jämförbar baslinje där samma fixture/scope mäts; ett eventuellt annorlunda gruppbegränsat kandidatalternativ måste jämföras och förklaras, inte döljas under en ny kvalitetspoäng. Ingen kravbild på att strikt kortare kablar alltid vinner över gruppdisciplin.

## 6. Automatisk acceptans – AV-P0

Följande är **minimikrav**. En obligatorisk rad som saknar test/evidens är **PENDING**, inte PASS.

| ID | Test med bevis | Stoppvillkor |
|---|---|---|
| AV-01 | SHA-256 för exakt originalbild följer rapport och versionshanteras med kontraktet. | Fel/äldre referens. |
| AV-02 | Topologiscopes har entydiga ID:n; `READ`/`OVERVIEW` är kamera, inte scope. | Zoom används som navigationslager. |
| AV-03 | Globalt lager: grupper, rubricerade containrar, ordnade medlemskort; manuell Arvidsjaur-jämförelse. | Endast platt graf. |
| AV-04 | Distribution-/mellanlager: egen karta med samma visuell grammatik. | Bara `setCenter` på global graf. |
| AV-05 | Access-/detaljlager: egen karta med samma grammatik, root synlig. | Access25 som befintlig READ-bild. |
| AV-06 | Ännu ett faktiskt existerande djupsteg eller visad saklig terminalnivå; ingen fabricerad hierarki. | Hittar på ett extra lager. |
| AV-07 | Grupper har stabilt medlemskap/ID och deklarerad/deriverad proveniens. | Byter källzon eller roller. |
| AV-08 | Alla verkliga gruppmedlemskort ligger helt i sin grupps innehållsyta. | Post-hoc overlay som skär genom kort. |
| AV-09 | Grupphuvuden skär inte kort, länkändpunkter eller etiketter. | Rubriker maskerar data. |
| AV-10 | Ordning och mellanspacing återger Arvidsjaurs visuella grammatik i varje scope; är deterministisk. | En lång, diffus kabel-/nodlinje. |
| AV-11 | READ root-kort helt inne i panel, ≥16 px margin desktop. | Root utanför ytan. |
| AV-12 | Faktisk primär etikett ≥13 skärmpixlar på läsbara READ-kort. | Endast CSS-font PASS. |
| AV-13 | Faktisk sekundär etikett ≥11 skärmpixlar på läsbara READ-kort. | Endast CSS-font PASS. |
| AV-14 | OVERVIEW innehåller rimlig gruppläsbar översikt och klar READ-ingång. | Oläsbar overview kallas READ. |
| AV-15 | Breadcrumb/back/drill visar rätt lager och återställer dess relevanta state. | Fel fokus/scope/historik. |
| AV-16 | Visa/dölj/isolation av presentationsgrupper ändrar aldrig kanoniskt nätverk och visar utelämnade antal. | Källa eller fysiska länkar raderas tyst. |
| AV-17 | Snabba scopebyten och ELK-async race ger aldrig äldre bild med ny breadcrumb. | Stale layout committad. |
| AV-18 | 1366×768, 1280×800, 1920×1080, 390×844 verifieras med verkliga screenshots. | Endast en desktopbild. |
| AV-19 | Resource-ID:n, connection-ID:n och endpoints i projektion är exakt källhärledda; inga dubletter. | Tillverkad/försvunnen fysisk länk. |
| AV-20 | Håll isär interna, boundary och externa länkar, samt alla utelämnade antal. | Tysta bortfall. |
| AV-21 | Ortogonala kabelsträckor, inga kortpenetrationer; separat metrics för crossings och collinear overlaps. | Metrik döljer kablar ovanpå varandra. |
| AV-22 | Riktiga källportar vs view-only handles hålls åtskilda; inga fabrikationer av VLAN, switchport, route eller Engine TRUE. | Källa förfalskad för estetiken. |
| AV-23 | Röd regression reproducerar y≈52–107 vs panel från y≈208 före fix; grön efter i exakt samma scen. | Test tillagt först efter patch och är falskt positivt. |
| AV-24 | `.yadilab`, Builder/Runtime, import och 10k/10k canonical fixture fortsätter fungera. | Navigationsfix sabbar kärnflöden. |
| AV-25 | Access25 40 resurser, 39 källbaserade länkar, 38 klienter; befintlig PROJECT-094-mätning redovisas före/efter. | Förlorade kort/kablar, falska vinstpåståenden. |
| AV-26 | Källa kontra layout: deklarerade och härledda presentationsgrupper inte likställs med fysisk topologi. | Gruppen betraktas som verifierad zon. |
| AV-27 | Ingen visuellt osynlig eller utanför scope associerad nod kan markeras av misstag. | Fel canvas-/inspectorval. |
| AV-28 | Verklig Chromium evidence innehåller per-lager READ och OVERVIEW, med DOM-geometri och kamera-state. | Endast JSON-layoutpoäng. |
| AV-29 | `source-and-security`, `compiled-chromium` och `yadilab-required-ci` SUCCESS på **exakt slutlig PR HEAD**. | Test på gammal SHA. |
| AV-30 | Resultatet jämförs sida-vid-sida med **nya** Arvidsjaur-originalet; användarens visuella beslut `PENDING_USER` tills explicit godkänt. | AI markerar själv `visualApproved: PASS`. |

## 7. Föreskriven implementationsordning i SAMMA PR #105

**W0 / Fryst fakta:** Läs aktuellt `AGENTS.md` på main, återhämta levande `main`, alla öppna PR:er, exakt PR HEAD och check runs. Arkivera riktiga 094-skärmbilder/JSON och nya Arvidsjaur-bilden med SHA. Granska faktiskt programflöde innan patch.

**W1 / RÖDA bevis:** Utöka Chromiumtestet så att READ failar med offscreen root och skalfel; tillför DOM-gruppcontainment-kontroll. Gör isolerad ELK-fixture för nästlade grupper och cross-group cables; dokumentera om backend levererar användbara sektioner/world-space koordinater.

**W2 / Lagerdefinition:** Gör scope, markering, breadcrumb och kamera till separata, versionsidentifierade tillstånd. Värden som `rootId`, `page`, presentation visibility och `geometryGeneration` får inte sammanblandas. Definiera scope och relation till parent utifrån verkliga canonical connections/zones; ingen mutation av källan.

**W3 / Arvidsjaur-gruppering:** Låt verifierade grupper styra topologins geometri före placering. Kort och grupphuvud måste vara rätt avgränsade. Ordnade kluster ersätter flat ELK + efterhandsramar där detta bryter standarden. Behåll existerande ELK-engine/sections.

**W4 / Kamera och navigation:** Reparera pre- och post-layout fit med rätt panelrektangel, scopeidentitet och zoom; eliminera viewportRef/resize-konflikt. Säkerställ drill/back/breadcrumb och visa/dölj med reversible view-only state.

**W5 / Stil och läsbarhet:** Jämför varje verkligt scope med referensen. Förbättra kortpresentation, rubriker, gruppplacering och ortogonala rutter; inga designalternativ utan användargodkännande. Testa både deklarerade och derived groups och mobil.

**W6 / Regressionsgrind:** Kör fulla befintliga tester + ny P0-matris, sammanfatta riktiga numeriska resultat. Bevara hela import-/YadiLab-projektmotorn, 10k/10k-inventering och source-of-truth.

**W7 / Exakt SHA + mänsklig acceptans:** Publicera screenshots och maskinläsbar kvalitetsrapport på sista HEAD; invänta användarens **uttryckliga visuella godkännande**. PR fortsatt OPEN, **MERGE EJ UTFÖRD**. Den framtida *Förberedelse*/addonplaneringen fortsätter först efter avklarad PR, inte som del av denna kodpatch.

## 8. Leveransformat och rapportering till användaren

Leverera en tabell **per faktiskt scope** med:

`sourceSha256`, `gitHead`, `scopeKind`, `scopeRoot`, `scopeDepth`, `scopePage`, `parentScope`, `groupIds`, `groupKinds`, `memberCounts`, `visibleDeviceIds`, `visibleConnectionIds`, `hiddenNodeCount`, `hiddenBoundaryConnectionCount`, `cameraMode`, `panelRect`, `anchorRect`, `effectivePrimaryPx`, `effectiveSecondaryPx`, `headerOverlaps`, `cardOverlaps`, `crossings`, `collinearSharedLaneOverlaps`, `layoutCandidate`, `screenshots`, `reviewStatus`.

Mätvärden får vara `NOT_APPLICABLE` där de inte kan mätas sakligt; redovisa konkret varför. Får inte markeras `PASS` om de inte prövats. Redovisa verkliga avvikelser mot originalbilden som separata designfrågor.

**Stoppsats:** Om Arvidsjaur-grammatiken inte kan tillämpas på ett verkligt navigationslager utan att bryta source/proveniens, redovisa den exakta konflikten. Luna får inte improvisera en alternativ visuellt ”snygg” graf eller dölja problemet bakom grön CI.

## 9. Långsiktigt skydd mot framtida gissningar

När Luna implementerar AV-001 i samma PR #105 ska **både denna specifikation, den EXAKTA originalbilden och testkontraktet** versionshanteras i `Northsw-spec/YadiLab-n`, under en lämplig samlad katalog såsom `docs/design/arvidsjaur-layer-navigation/` (namnet kan justeras efter befintliga repokonventioner, men dokument och originalbild får inte spridas eller utelämnas). Länka till standarden med en **kort, saklig pekare** i `AGENTS.md` eller relevant giltigt arkitekturindex efter kontroll av hur repot organiseras. Filernas SHA-256 och licens-/källstatus ska bevaras.

Varje framtida ny topologifunktion/PR ska då börja med att läsa den versionshanterade standarden, originalbilden, live-koden och aktiva regressioner; ingen chatthistorik eller sparad assistentmemory behövs. Nya kodändringar får inte upphäva användarens godkända visuell grammatik genom att ersätta testet med en numerisk kabellängd-/korsningsgrind. Ändring av själva standarden kräver ett **nytt uttryckligt designbeslut** från användaren.

## 10. Faktakällor – verifierade, föreslagna och ännu obevisade

**Användarfakta:** Normativ bild och lök-/Blender 2.7-lagermetafor, uttryckligen fastställda i konversationen.  
**GitHub vid revision:** `Northsw-spec/YadiLab-n`, PR #105: `ui/src/canvas/hierarchical-topology.ts`, `ui/src/canvas/topology-elk-adapter.ts`, `layout/src/types.ts`, `layout/src/elk-backend.ts`, `ui/src/canvas/topology-navigation.ts`, `ui/app/main.mjs`, `tests/acceptance/run_project091_arvidsjaur_layout_real_browser.py`, `tests/acceptance/run_project094_topology_engine_real_browser.py`, `AGENTS.md`.  
**Verkliga testrapporter:** `03_EVIDENS/PR105_*_BEFORE.*` på verifierad testad HEAD.  
**Arkitekturbeslut (nytt):** Gruppcontainment före ELK-layout, samma visuella grammatik per scope, reversibel presentation visibility, kamera som hård acceptansgrind.  
**Återstår att bevisa:** Gruppbaserad ELK-geometri genom befintlig nested `children`-struktur och faktisk renderad form för varje navigationslager efter patch; dessa kan **inte** påstås vara implementerade nu.

---

**Godkännande:** AV-001 är en bindande designstandard och implementeringsinstruktion. Användaren beslutar om den faktiska renderade layouten, separat från att denna specifikation är fastställd. PR #105 får inte mergeas automatiskt.
