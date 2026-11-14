# AV-001 slutrapport — Arvidsjaur-standarden på varje navigationslager

## Beslutsläge

Resultatet är `BLOCKED_BY_OBJECTIVE_VISUAL_GATES`. Den verifierade
produktkandidaten är commit
`414e9fe8ccf36678e2f19a60698502ad1fcca938` i befintlig [PR #105](https://github.com/Northsw-spec/YadiLab-n/pull/105).
PR:en har inte mergats och `visualApproved` är fortsatt `PENDING_USER`.
Den här rapporten ändrar inte källmodellen, lägger inte till en ny
layoutmotor och fabricerar inga länkar, portar, VLAN eller Engine-resultat.

AV-001:s strukturella, källhärledda, kamera- och hårda geometrikontroller är
verifierade. Den objektiva jämförelsen mot den nya Arvidsjaur-originalbilden
visar däremot att global- och distributionsvyn fortfarande blir för långa
vertikala ELK-gruppstråk. Därför markeras AV-03, AV-04, AV-10 och AV-14 som
`FAIL`, och AV-30 förblir `PENDING_USER`. Detta är en blockerande observation,
inte ett visuellt godkännande.

## Oförändrade källor och spårbarhet

| Artefakt | Värde |
| --- | --- |
| Repository / PR | `Northsw-spec/YadiLab-n` / [PR #105](https://github.com/Northsw-spec/YadiLab-n/pull/105) |
| Testad produkt-HEAD | `414e9fe8ccf36678e2f19a60698502ad1fcca938` |
| Canonical fixture | `synthetic-ci-fixture`, 10 000 resurser + 10 000 länkar |
| Fixture SHA-256 | `62da08dec42768fa10ab1937508b044f5a32297812bc5d3d6a51f1076ffc01f7` |
| Arvidsjaur-original | [`Arvidsjaur_Standarden_2026-11-12.png`](../reference/Arvidsjaur_Standarden_2026-11-12.png) |
| Originalbildens SHA-256 | `8eb2417aef038a2c02dc9866f49709874c4e2ded2c88fd5442df98d8bfed834c` |
| Chromium | `/tmp/yadilab-pw-browsers/chromium-1187/chrome-linux/chrome` |
| Visual approval | `PENDING_USER` |
| Merge | `NOT_PERFORMED` |

Kontraktet, prompten, kontrollmatrisen och källspårsrevisionen finns
versionerade i [`docs/design/arvidsjaur-layer-navigation/`](../README.md).

## Verifierade navigationslager

Varje rad är en egen source-derived scope. `READ` och `OVERVIEW` är kameror
för samma scope och räknas inte som nya lager.

| Scope | Djup / parent | Synliga resurser | Interna fysiska länkar | Presentationgrupper | Boundary / external | Utelämnade länkar | Evidens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `overview` | 0 / — | 34 | 34 | 5 | 256 / 9710 | 9966 (256 boundary) | [`READ`](chromium-414e9fe/av001-overview-read-1366x768.png), [`OVERVIEW`](chromium-414e9fe/av001-overview-overview-1366x768.png) |
| `distribution-0004` | 1 / `overview` | 10 | 9 | 3 | 320 / 9671 | 9991 (320 boundary) | [`READ`](chromium-414e9fe/av001-distribution-0004-read-1366x768.png), [`OVERVIEW`](chromium-414e9fe/av001-distribution-0004-overview-1366x768.png) |
| `access-0025` | 2 / `distribution-0004` | 40 | 39 | 7 | 8 / 9953 | 9961 (8 boundary) | [`READ`](chromium-414e9fe/av001-access-0025-read-1366x768.png), [`OVERVIEW`](chromium-414e9fe/av001-access-0025-overview-1366x768.png) |

`Access25` är exakt den sakliga 40/39/38-fixture-nivån. Dess klienter är
bladnoder i den kanoniska grafen; inget ytterligare fysiskt djup hittades och
inget extra lager hittades på. Källhärledda presentationgrupper är markerade
`presentationOnly` och påverkar inte canonical-nätet.

## Chromium- och geometribevis

Den riktiga kompilerade Chromium-körningen är [`project094-topology-engine.json`](chromium-414e9fe/project094-topology-engine.json).
Den innehåller inga sidfel eller externa anrop och verifierar exakta
resurs-/länk-ID:n, endpoints, portsproveniens och VLAN-status. Per-lager
gruppcontainment, header-separation och nested ELK finns i samma körning.

Kamera-/läsbarhetsdata finns i
[`camera-readability.json`](chromium-414e9fe/camera-readability.json):

- READ root-kortet ligger helt i panelen med minst 16 px marginal.
- Primär etikett är 17,28125 skärmpixlar och sekundär etikett 14 skärmpixlar
  på desktop och i 1280×800/1920×1080; mobil 390×844 har ingen horisontell
  overflow.
- OVERVIEW-fit använder scale `0.292966`, vilket gör global- och
  distributionskortens etiketter cirka 5,06/4,10 skärmpixlar. Alla kort får
  plats geometriskt, men presentationen är inte läsbar som Arvidsjaur-översikt.

`route-geometry.json` visar 82 orthogonala ELK-rutter, 0 crossings och 0
kortpenetrationer. Den nuvarande artefakten har dock ingen separat mätare för
collinear kabel-lane-overlap; därför är AV-21 inte fullständigt bevisad trots
att crossings och card-overlaps är noll.

Skärmbilderna finns även för de obligatoriska storlekarna och för länk-
inspektorn: [`1280×800`](chromium-414e9fe/project094-access-0025-1280x800.png),
[`1920×1080`](chromium-414e9fe/project094-access-0025-1920x1080.png),
[`390×844`](chromium-414e9fe/project094-access-0025-mobile-390x844.png) och
[`link-01211`](chromium-414e9fe/project094-access-0025-link-01211-1366x768.png).

## Access25 A/B/C-bakeoff och före/efter

Den obligatoriska jämförelsen kördes på exakt 40 resurser, 39 fysiska länkar
och 38 klienter med befintlig ELK-backend:

| Profil | Total kabellängd | p95 detour | bends | crossings | Hard gate |
| --- | ---: | ---: | ---: | ---: | --- |
| A `A-flat-right` | 119442,00 | 1,327553 | 152 | 0 | PASS |
| B `B-flat-down-high-degree` | 139748,40 | 2,263158 | 170 | 297 | FAIL (`CABLE_CROSSING`) |
| C `C-role-aware-fanout` | 65316,67 | 1,312833 | 262 | 0 | PASS, vald |

Maskinen valde C eftersom den klarar hård geometri och har kortare total
kabellängd än A. Den frysta PROJECT-093-baslinjen var 49206,00 total längd
och p95 1,537736. Den deklarerade optimeringsjämförelsen är därför
`qualityGate: FAIL` (total längd −32,7413 %, p95 +14,6256 %), vilket redovisas
öppet i [`layout-bakeoff.json`](chromium-414e9fe/layout-bakeoff.json) och
[`baseline-project093.json`](chromium-414e9fe/baseline-project093.json).

## Kvarstående blockerare

ELK bevarar nested containment, käll-ID:n, orthogonala routes och noll hårda
geometrifel, men C-profilen placerar global- och distributionsgrupperna som
långsträckta vertikala band. Ett prov med layout-only rad-/parhintar gav 14
verkliga Chromium-kabelkorsningar. Ett DOWN-experiment gav
`CABLE_CROSSING` i Access25. Båda experimenten togs bort; ingen manuell
grid- eller parallell kabelrouter accepterades som workaround. Den säkra
åtgärden är därför att rapportera den objektiva visual-gaten som blockerad,
inte att försvaga testet eller kalla bilden godkänd.

Historisk röd regression och före-bilder finns i [`PR105_final-review_BEFORE.md`](PR105_final-review_BEFORE.md), [`PR105_camera-readability_BEFORE.json`](PR105_camera-readability_BEFORE.json) och de fyra `PR105_*_BEFORE.png`-artefakterna. Den gröna efterkörningen är den kompilerade Chromium-evidensen i `chromium-414e9fe/`.

## AV-P0-kontrollmatris (alla kontroller genomgångna)

`PASS` betyder att kontrollens verifierbara tekniska del är grön. `FAIL`
är en reproducerad objektiv gate-förlust. `PENDING` betyder att evidensen
inte räcker för ett säkert PASS. `PENDING_USER` får endast användas för
användarens visuella beslut.

| ID | Status | Verifiering / evidens |
| --- | --- | --- |
| AV-01 | PASS | Exakt originalbild och SHA-256 ovan; versionerad referens. |
| AV-02 | PASS | Scope-ID:n `overview`, `distribution-0004`, `access-0025`; READ/OVERVIEW är separata kameror. |
| AV-03 | FAIL | Global scope har 5 nested grupper och 34 source cards, men Chromium-bilden är ett vertikalt stråk och matchar inte Arvidsjaur-grammatiken. |
| AV-04 | FAIL | Distribution har egen 10/9/3-karta och containment, men medlemskorten staplas vertikalt i stället för referensens täta rytm. |
| AV-05 | PENDING_USER | Access har egen 40/39/7-karta, synlig root och grön hård geometri; visuellt beslut återstår. |
| AV-06 | PASS | Access25-klienterna är verkliga bladnoder; ingen saklig djupare fysisk nivå finns i fixture. |
| AV-07 | PASS | Stabilt medlemskap, ID:n, zone/role-proveniens och deterministisk group-sortering verifierad. |
| AV-08 | PASS | Nested ELK containment: alla medlemskort innanför gruppens innehållsyta i Chromium. |
| AV-09 | PASS | Header-band och kort separerade; inga header-intersections eller route-penetrationer. |
| AV-10 | FAIL | Ordning/mellanspacing är deterministisk men global/distribution visar lång diffus nod-/kabelriktning i stället för referensens kompakta grid. |
| AV-11 | PASS | READ root helt i panel med minst 16 px desktopmarginal. |
| AV-12 | PASS | Faktisk primär etikett minst 17,28125 screen px. |
| AV-13 | PASS | Faktisk sekundär etikett minst 14 screen px. |
| AV-14 | FAIL | OVERVIEW fit är geometriskt komplett men 5,06/4,10 screen px och kan inte kallas läsbar Arvidsjaur-översikt. |
| AV-15 | PASS | Breadcrumb/back, drill, READ↔OVERVIEW och återgång verifierade i real-browserflödet. |
| AV-16 | PASS | Presentation-only grupper och utelämnade/boundary-antal ändrar inte canonical source. |
| AV-17 | PASS | Async generation/request-key och determinism/race-regressioner gröna. |
| AV-18 | PASS | Äkta Chromium-bilder för 1366×768, 1280×800, 1920×1080 och 390×844. |
| AV-19 | PASS | 34/34, 10/9 och 40/39 link-ID/endpoints exakt source-reconciled utan dubletter. |
| AV-20 | PASS | Internal/boundary/external och hidden counts dokumenterade per scope ovan. |
| AV-21 | PENDING | Orthogonal/crossing/penetration/card-overlap är gröna; separat collinear-lane-overlap-mätare saknas i evidensschemat. |
| AV-22 | PASS | Riktiga källportar skiljs från view-only handles; Access25-inspektorn visar NOT DOCUMENTED för okända port/VLAN-fakta. |
| AV-23 | PASS | Historisk röd före-evidens bevarad; efterkörningen placerar panelen i första viewporten och root i READ-panelen. |
| AV-24 | PASS | `.yadilab`/Builder/Runtime/import-regressioner, P094 engine-test och 10k/10k compiled-Chromium acceptance gröna. |
| AV-25 | FAIL | 40/39/38 och A/B/C före/efter är exakt rapporterade, men fryst P093-optimeringsgate är objektivt FAIL och döljs inte. |
| AV-26 | PASS | Presentation groups är explicit `presentationOnly` och hålls åtskilda från fysisk topologi. |
| AV-27 | PASS | Selection/focus använder live scope-ID:n; inga utanför-scope-kort markeras i browserflödet. |
| AV-28 | PASS | Per-lager READ+OVERVIEW-bilder, DOM-geometri och kamera-state är versionerade i `chromium-414e9fe/`. |
| AV-29 | PENDING | GitHub required checks måste verifieras på den slutliga PR-HEAD efter dokumentcommit/push. |
| AV-30 | PENDING_USER | Sida-vid-sida mot originalbilden är dokumenterad; AI sätter inte `visualApproved: PASS`. |

## Slutsats

AV-001 är inte visuellt godkänd och ska inte mergas. Nästa säkra steg är att
användaren granskar de sex per-lagerbilderna och beslutar om den kvarstående
ELK-layoutblockeringen ska åtgärdas i samma PR. Ingen merge eller visuell
`PASS` har utförts.
