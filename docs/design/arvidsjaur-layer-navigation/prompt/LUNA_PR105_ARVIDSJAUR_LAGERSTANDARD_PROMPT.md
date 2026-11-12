# Till Luna / Codex – AV-001 · Arvidsjaur på VARJE navigationslager

**Arbeta endast i befintliga PR #105 (`Northsw-spec/YadiLab-n`). Ingen ny PR. Ändra inte `main`. MERGA INTE. Behåll `visualApproved: PENDING_USER`. Inga addons, GNS3, Bridge eller framtida Förberedelse-arbeten.**

## Obligatorisk läsordning

1. Läs huvudkontraktet `01_DESIGNKONTRAKT/ARVIDSJAUR_LAGERSTANDARD_BINDANDE_V1.md` ordagrant och referensbilden `03_EVIDENS/Arvidsjaur_Standarden_2026-11-12.png`. Verifiera SHA-256 `8eb2417aef038a2c02dc9866f49709874c4e2ded2c88fd5442df98d8bfed834c`. Detta är **NYA** standardbilden; äldre `Perfekt, helt godkänt.png` är en annan fil.
2. Läs `AGENTS.md` och `README.md` på **aktuell main**, lista **alla öppna PR:er**, aktuell PR HEAD, befintliga tester och exakta CI-checks. Checka om annan författare arbetar innan kodändring.
3. Läs i repo: `ui/src/canvas/hierarchical-topology.ts`, `ui/src/canvas/topology-elk-adapter.ts`, `ui/src/canvas/topology-navigation.ts`, `layout/src/types.ts`, `layout/src/elk-backend.ts`, `ui/app/main.mjs`, `tests/acceptance/run_project091_arvidsjaur_layout_real_browser.py`, `tests/acceptance/run_project094_topology_engine_real_browser.py` och existerande source/provenance/projekttester.
4. Läs befintlig Chromium-evidens i `03_EVIDENS/` och skapa en ny **före-fix RED-rapport** mot aktuell PR HEAD. Sluta om historiska bilder inte matchar dagens kod och samla ny evidens.

## Ingen tolkning av ”lager” är tillåten

- Navigationslager = **en egen, källbaserad topologikarta med egen gruppstruktur**, inte kamera, zoom eller filter.
- Lökmodell: Global → mellanlager → access/detalj → ytterligare nivå om faktiska data stödjer den; Back/Breadcrumb fungerar i motsatt riktning.
- Varje scope och varje visningsläge måste återge **samma Arvidsjaur-visuella grammatik**: mörk yta, rubriksatta containment-grupper, kort i ordnade små rader/kolumner, läsordning och ortogonala källbaserade kablar.
- Om data innehåller för få enheter för flera grupper: gruppera naturligt utan att fabricera något. Ingen tvingad 5×3-layout eller uppfunnen nätverkshierarki.
- Visa/dölj av visningsgrupper ändrar **aldrig** källan; rapportera dolda boundary/externa länkar och antal. Det är inte samma sak som att navigera till nytt scope.

## Rotproblemet att rätta, inte maskera

På aktuell historisk PR HEAD `945465b` såg Access25 READ-kortet `access-0025` utanför panelen (y≈52–107, panel börjar y≈208), trots grön Chromium CI. Nuvarande `topology-elk-adapter.ts` placerar **platta resursnoder** och gör en gruppoverlay i efterhand. Denna teknik kan bryta gruppcontainment och referensens ordning. `runInitialFit` + kameraknappar har konflikt mellan fokuscenter/fit/resize. `read_camera_gate` mäter bara computedStyle font före zoom. Detta ska **reproduceras som röd regression** före någon fix.

## Föreskriven arbetstakt, utan fri motorrenovering

**W0:** Frysta SHA, screenshot, källfakta, tests. **W1:** RÖDA tester för offscreen root, verklig fontskala, header/kort-överlapp samt faktisk grupptillhörighet. Skapa ELK-testfixture med minst två grupper och korsande källbaserade länkar. **W2:** Definiera stabilt view-only scope/parent/child/visibility-state och asynkron generation-guard. **W3:** Respektera grupphierarki i verklig geometri innan slutlig ELK-layout, inte post-hoc bounding boxes utan containment. Utvärdera först existerande `LayoutGraphNode.children`, men hävda inte att stödet fungerar förrän backend-/routetesterna visar det. **W4:** Korrekt kamera och navigering (READ/OVERVIEW, back, breadcrumb, resize). **W5:** Samma Arvidsjaur-struktur på overview, distribution, Access25 och varje ytterligare giltigt lager. **W6:** Exakta source/link-regressioner, alla relevanta gamla tester och verkligt kompilerad Linux Chromium på 1366×768, 1280×800, 1920×1080, 390×844. **W7:** Alla tre obligatoriska checks SUCCESS på sista HEAD, publicera evidens och lämna visuellt godkännande till användaren.

**VIKTIGT:** Om nested ELK inte kan uppfylla kontraktet utan regressionsrisk: pausa, redovisa exakt experiment, failresultat och minimal möjlig design. Ta **inte** eget beslut att ersätta ELK med en ny motor eller offra källidentitet för snygga bilder.

## Minsta accepterade skärmbildsbevis

1. Global översikt READ + OVERVIEW – Arvidsjaur-grupper, inte en stor platt graf.
2. Distribution branch READ + OVERVIEW – ny egen gruppstrukturerad karta, inte zoom.
3. Access25 READ + OVERVIEW – 40 riktiga enheter, 39 riktiga länkar, ankarnod synlig i READ.
4. Giltigt ytterligare djupsteg **om ett sådant finns i faktiska data**. I annat fall tydlig terminalnivå, inga påhittade lager.
5. Mobil + två desktopstorlekar, och navigationssteg inklusive Back/Breadcrumb/READ↔OVERVIEW/visa-dölj.
6. För varje vy: källa/scope-ID, verklig panel och ankarkortrektangel, zoomad skärmtext, gruppmedlemskap, dolda antal, sammanhängande connection-ID:n och länkevidens.
7. Sida-vid-sida-jämförelse mot just `Arvidsjaur_Standarden_2026-11-12.png`; visa avvikelser och vad som korrigerats.

## Gör standarden beständig i källkoden

Lägg in **originalbilden, hela det bindande designkontraktet och de maskinläsbara acceptansgrindarna** i ett sammanhållet versionshanterat `docs/design/...`-område i samma PR. Lägg en kort hänvisning i gällande arkitekturindex eller `AGENTS.md` utan att ändra befintliga utvecklingsregler. De framtida PR:erna ska kunna läsa standarden från GitHub, inte från ett tidigare samtal. Om repo-konventionerna kräver annan dokumentationsplats, anpassa sökvägen men **ändra inte kontraktets innehåll, SHA eller referens** på eget initiativ.

## Hårda stopp

- Ingen fysisk kabelförfalskning, inga nya dokumenterade portar, okända VLAN blir inte kända, inga nya Engine TRUE-resultat.
- Ingen hårdkodad `camera: PASS` eller `readability: PASS`; verkliga skärmkoordinater och transformskala krävs.
- Ingen grön CI som tyst döljer avklippt rot, inkompatibla lager, headeröverlapp eller tappade source-ID:n.
- Ingen PR-merge, branchändring till main, extra PR eller status `visualApproved: PASS` utan användarens uttryckliga godkännande.

Rapportera de **30 AV-P0** i huvudkontraktet rad för rad med `PASS`, `FAIL` eller `PENDING` + evidenslänk. Rapportera före/efter-fynd, verkliga kodfiler, ny HEAD, GitHub Actions-länkar och restpunkter. Status för hela PR är **PENDING_USER** tills användaren godkänt de faktiska skärmbilderna.
