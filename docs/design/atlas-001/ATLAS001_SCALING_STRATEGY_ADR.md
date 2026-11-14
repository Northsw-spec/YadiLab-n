# ATLAS-001 — skalningsstrategi som sidbaserad vy

Status: föreslagen och implementerad endast inom G0–G3 i PR #105.
Normativ visuell standard: AV-001, originalbild SHA-256
`8eb2417aef038a2c02dc9866f49709874c4e2ded2c88fd5442df98d8bfed834c`.

## Beslut

ATLAS-001 kompletterar AV-001/PROJECT-094 med ett härlett, deterministiskt
atlasindex. Ett kanoniskt nätverk förblir en enda källa. Varje Atlas-sida är en
begränsad projektion med egna Arvidsjaur-grupper, egna layoutkoordinater och
egna kameratillstånd. Endast den aktiva sidans verkliga resurser och interna
kanoniska länkar skickas till befintlig ELK/React Flow-rendering.

En gränslänk blir aldrig en ny fysisk kabel. Den visas som en view-only-
fortsättningsreferens med original-ID, båda endpoints, kända portpar och
destinationssid-ID. `internal`, `boundary` och `external` partitioneras mot
hela den kanoniska connection-listan på varje sida.

## Avgränsning G0–G3

- G0: livebaslinje, PR #105 och AV-001-kontroll.
- G1: åttaresursers syntetisk tvåsidig röd kontraktsfixture.
- G2: rena, deterministiska `buildAtlasIndex`/`projectAtlasPage`-funktioner.
- G3: explicit Atlas-vy, sidbyte, fortsättningsreferens, sökning och tillbaka.

Startbudgeten är 60 resurser per sida, med hårda renderingsgrindar 100 noder
och 250 interna kanoniska länkar. Överbudget delas deterministiskt eller ger
ett explicit listläge; länkar får aldrig tyst kapas.

## Oförändrat

Ingen ändring görs i `ScenarioSource`, `.yadilab`-format, importörer, Runtime,
Engine, Builder-data eller befintlig NORMAL TOPOLOGY. Atlas-indexet är härlett
och cache-/request-identitet innehåller source revision, `atlas.v1`, pageId,
layoutversion och viewportklass. Senare async-svar får inte skriva över en ny
sida.

G4–G6 (500-enheter, formatövergripande dokument och 10k) ingår inte i detta
ADR. Visuellt godkännande är fortsatt `PENDING_USER`; PR #105 ska inte mergas.
