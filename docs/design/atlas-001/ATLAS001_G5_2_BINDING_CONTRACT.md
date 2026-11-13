# ATLAS-001 G5.2 — bindande kontrakt för fysisk DOCX-sidevidens

Status: `CONTRACT_FROZEN` · Implementation: `NOT_STARTED`
Contract ID: `yadilab.docx-physical-page-evidence` · Schema: `1.0.0`
Pilotprofil: `atlas001.g5.2.reviewed-docx-page-evidence.v1`

Detta är ett kontrakts- och teststeg. Det aktiverar ingen ny produktväg,
ändrar inte `main` och ändrar inte PR:ens merge-status. Alla fysiska sidnummer
är evidens om redan granskade DOCX-fakta; de är aldrig en källa till topologi.

## 1. Godkända arkitekturbeslut

G5.2 gäller endast reproducerbart sidbevis för redan granskade DOCX-fakta.
Piloten har högst 12 kanoniska resurser och 11 deklarerade connections. Detta
är ett tak, inte ett krav på 23 objekt:

| Objekt | Max | Härledning från sidor |
|---|---:|---:|
| Kanoniska resurser | 12 | 0 |
| Deklarerade connections | 11 | 0 |
| Portar | Befintlig källa | 0 |
| Zoner | Befintlig källa | 0 |
| Fysiska dokumentsidor | Endast kvalificerad rendererprofil | 0 |

`500` sidor från G5.0 är ett sidantal, inte en nätverkstopologibudget. En
DOCX med 13 resurser eller 12 connections ska ge `BLOCKED` före Atlas-
aktivering; ingen fallback till global ELK är tillåten.

DOCX återanvänder befintlig säkra OPC/WordprocessingML-väg, `ScenarioSource`,
`yadilab.office-reviewed-provenance` v1.0.0 och befintlig
`buildAtlasIndex`/`projectAtlasPage`. IC-040:s ODT-väg bevaras oförändrad och
får inte använda DOCX-profilen.

## 2. Två separata auktoritetsnivåer

* **Källfakta** är en användargranskad och SHA-bunden cell i
  `word/document.xml`, identifierad med tabell-, rad- och cellordinal samt
  befintligt `factId`, target, fält, source identity och source revision.
* **Sidbevis** är rendererbundet bevis för var just den källförekomsten ligger
  på fysisk sida `N`.

Sidbevis är aldrig en ersättning för källfakta. Sidans samförekomst, text-
sökning, närhet, en ritad kabel eller en IP/gatewayrelation får inte skapa
resurs, connection, port, zon, roll eller Engine-sanning.

## 3. Separat, versionshanterad evidensrepresentation

`yadilab.docx-physical-page-evidence@1.0.0` är metadata-only och refererar till
G5.1-fakta genom stabila identiteter. Den duplicerar inte `ScenarioSource` och
ändrar inte semantiken i `yadilab.office-reviewed-provenance@1.0.0`.

Varje evidenspost måste innehålla:

* evidens-ID, kontrakts-ID och schema-version;
* originalets SHA-256, DOCX-profil och `word/document.xml`;
* G5.1-format/version, `factId`, canonical `sourceIdentity` och
  `sourceRevision`;
* exakt tabell-/rad-/cell-locator, target-ID och fältnamn;
* rendererprofil-ID, faktiskt fingerprint, OS/arkitektur, LibreOffice,
  Poppler, locale, fontinventeringshash, sidformat/layoutparametrar,
  renderad output-SHA, sidantal och sidordning;
* `physicalPage` eller `null`, verifieringsmetod, reproducerbar
  `evidenceRef`, samt status `VERIFIED`, `UNKNOWN` eller `BLOCKED`.

Råa DOCX-bytes, hemliga cellvärden och okontrollerat stora PDF:er får inte
bäddas in i sidecaren. `UNKNOWN` får inte presenteras som en verifierad sida.

## 4. Beviskrav för cell → fysisk sida

En `VERIFIED` post kräver en entydig och reproducerbar koppling från exakt

```text
source SHA + word/document.xml + table/row/cell + factId
```

till fysisk sida `N` i en kvalificerad rendering. En textsträng som råkar
förekomma på flera sidor är inte tillräcklig. Samma gäller tabeller som bryts
över sidor, duplicerade ID:n, saknad locator och mapping som bara bygger på
renderad PDF-text. Utan en kontrollerad pilotmetod blir utfallet `UNKNOWN`.

`BLOCKED` används när säkerhet, format, revision, källa, målmodell,
rendererprofil, integritet eller budgetkontroll misslyckas. `UNKNOWN` används
när källfakta och dokument är giltiga men sidplaceringen inte kan bevisas.

## 5. Rendererpolicy

Utgångspunkt är den befintliga profilen
`atlas001-g5.0.github-ubuntu-24.04-renderer.v1`. En verifierad körning måste
registrera käll-SHA, OS/arkitektur, LibreOffice, Poppler/`pdfinfo`/`pdftotext`,
locale, faktisk fontinventeringshash, sidformat, layoutparametrar, output-SHA,
sidantal och sidordning.

Profil-/patch-/font-/locale-drift, ändrade dokumentbytes eller okänd miljö får
inte automatiskt återanvända tidigare evidens. Evidensen måste omverifieras
eller bli `UNKNOWN`; en säkerhets-/integritets-/formatmiss blir `BLOCKED`.
Versionsfamilj ensam är aldrig tillräcklig auktoritet.

## 6. Kanonisk bindning, Save/Open och replay

En post är inte `CURRENT` om SHA, cell-locator, fact/target, fältvärde,
canonical source identity, source revision eller rendereridentitet har ändrats.
Saknad `officeReviewProvenance` blockerar auktoritativ evidens. `HISTORICAL`
blir aldrig automatiskt `CURRENT` efter Save/Open, reimport, Builder-ändring
eller sidbyte. Historik får sparas där befintliga kontrakt tillåter det, men
måste behålla sin historiska status.

G5.1-proveniens v1.0.0 ska kunna exporteras, sparas, öppnas och kontrolleras
utan G5.2-sidevidens. Export utan sidevidens är fortsatt giltig G5.1-data.
Atlas visar samma kanoniska resurser och connections; sidevidens muterar inte
modell, portlista, zoner, partitionering eller layoutmotor.

## 7. Acceptansmatris

Positiva kontroller omfattar G5.0 kontroll A/B, en avgränsad entydig mapping,
oförändrad kanonisk modell, G5.1 Save/Open/export, samt samma Atlas-projektion.
Negativa kontroller omfattar fel SHA/revision/source identity, okänt target eller
fact, falsk/duplicerad locator, upprepade textvärden, tabellbrytning,
renderer-/font-/locale-drift, korrupt DOCX/PDF, saknad sidverifiering, 13
resurser, 12 connections, historisk replay, ändrad Builder och ODT med
DOCX-profil. Varje fall ska få ett explicit motiverat utfall.

Det fokuserade kontraktstestet är ett strukturellt/invariant-test och använder
en testlokal beslutsoracle. Det är inte ett end-to-end-test av en ännu
icke-implementerad G5.2-produktväg.

## 8. Fail-closed-regler och icke-mål

Ändrad parser, DOCX-cell-disclosure, `ScenarioSource`, Runtime/Engine,
Atlas-partitionering, React Flow/ELK, UI-importkedja, AV-001-layout,
ZIP/XML-säkerhetsbudget eller G5.1-proveniens är uttryckligen utanför detta
freeze. Ingen ny permanent workflow eller produktflöde skapas i detta steg.

Alla budget-, käll-, revisions-, renderer-, mapping- och determinismfel ska
blockera eller ge `UNKNOWN`; de får inte maskeras som PASS eller global
rendering.

## 9. Implementeringsordning efter ny granskning

1. Granska och acceptera detta kontrakt.
2. Definiera stabila fact/evidence-identiteter och sidecar-versionering.
3. Kvalificera G5.0-renderer och en kontrollerad mappingmetod.
4. Implementera metadata-only utan modellmutation.
5. Lägg till positiva/negativa Save/Open/replay-tester.
6. Lägg till verkliga Chromium-bevis och separat visuell bedömning.
7. Verifiera exakt PR-HEAD före eventuell framtida mergebeslutspunkt.

## 10. Kvarvarande begränsningar

Generisk cell-till-PDF-mapping är inte bevisad för upprepade värden eller
delade tabeller. Rendererdrift kräver omverifiering. IC-040:s exakta ODT-
stödomfång är separat. 12/11 är ett tak, inte ett påstående om generell
importstöd. Ingen G5.2-produktimplementation är startad.
