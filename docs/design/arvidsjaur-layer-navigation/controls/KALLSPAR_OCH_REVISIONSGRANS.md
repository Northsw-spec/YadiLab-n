# Källspår, konkreta kodkonsekvenser och beslutspunkter

**Baslinje:** GitHub `Northsw-spec/YadiLab-n` PR #105 HEAD `945465b61b77948764364b5fc61355287f15ca5f`, `main` `8b75e344b702a3ad645759b89ef47720952ec424`, avläst 2026-11-12. Nya kodsessioner ska hämta aktuella ref:ar. Ingen kod eller PR-status ändrades av denna granskning.

| Verifierad källa | Faktiskt observerat | Konsekvens för AV-001 |
|---|---|---|
| `ui/src/canvas/hierarchical-topology.ts` | Har `NavigationGroup` med `declared-zone`/`derived-navigation`, `overview`/`branch`, scopebaserade nod- och edge-ID:n samt grupper uppdelade från nodernas roller och referensankare. | Gruppmedlemskap kan och ska definieras innan placering, inte härledas ur efterhandsbilden. |
| `ui/src/canvas/topology-elk-adapter.ts` | `buildElkGraph` bygger layoutgraph av platta resursnoder; `groupOverlayNodes` gör omslutningsrektanglar efter ELK-positionerna. | Befintlig implementation kan inte ensam garantera Arvidsjaurs gruppcontainment. Ett test måste bli rött först. |
| `layout/src/types.ts` | `LayoutGraphNode` har `children` och `parent`; backendkontrakt innehåller sektioner/portar. | Teknisk möjlighet att försöka nästlade layoutgrupper; korrekt enhetlig världsgeometri ej bevisad för nuvarande adapter. |
| `layout/src/elk-backend.ts` | `nodeToElk` översätter `children` rekursivt, men `collectNodes` lagrar föräldrars lokala koordinater i resultatet enligt äldre layoutkontrakt; edge-sektioner normaliseras till world space. | Luna måste göra isolerad cross-group fixture innan adapterändring, annars risk för koordinat- och kabelregression. |
| `ui/app/main.mjs` | Separata state för focus/root/page/hierarchy och `topologyCameraMode`, men `changeTopologyCameraMode('read')` kör generellt `fitView`; `runInitialFit` försöker root `setCenter`, resize kan återapplicera sparad viewport. | Gemensam explicit identitet för scope + layoutgeneration + kameramode, och test för att fokus inte ligger offscreen efter async commit. |
| `tests/acceptance/run_project091_arvidsjaur_layout_real_browser.py` | Grupper och källlänkar kontrolleras, men visuella gruppordning-/containment-/textgrindar saknas. | Utöka med DOM-baserad Arvidsjaur-acceptans; `data-navigation-group` räcker inte. |
| `tests/acceptance/run_project094_topology_engine_real_browser.py` | `read_camera_gate` kontrollerar `getComputedStyle(fontSize)` och `camera` skrivs i rapporten som `PASS` utan verklig fokusrektangelassertion. | Testutökning ska först FAILA i nuvarande Access25 READ. |
| `03_EVIDENS/PR105_access25_READ_1366x768_BEFORE.png` och `camera-readability.json` | Rapportens kortposition för fokusswitchen ligger helt ovanför topologipanelen i READ. | Hård kamera-/screenshot-/fontskalegrind. |
| `03_EVIDENS/Arvidsjaur_Standarden_2026-11-12.png` | Användarens *nya* normbild, SHA `8eb2417a…`. | Enda normativa visuella referensen. |

## Beslut som inte får vara implementationens fria val

1. **Visuell auktoritet:** Användarens originalbild + AV-001-kontraktet, aldrig kabelminimeringspoängen ensam.
2. **Källa:** Canonical scenario/links/ports och proveniens; presentationsgrupper får inte bli fysiska fakta.
3. **Layout:** Använd existerande ELK, inte ett ersättningssystem; gruppcontainment måste bevisas i faktiskt renderad vy.
4. **Navigation:** Barnlager är nya karta/scopes, inte kamera; `READ` och `OVERVIEW` är kameramode i befintligt scope.
5. **Läsbarhet:** Testas efter React Flow zoom och transform.
6. **Avsteg:** Om faktisk källstruktur gör referensgrammatiken omöjlig på en nivå: blockera/synliggör och begär separat arkitekturbeslut. Hitta inte på en annan lösning.
7. **Status:** Endast användaren får ge visuell acceptans och besluta om merge.

## Historiskt verifierad PR-status

- PR: https://github.com/Northsw-spec/YadiLab-n/pull/105
- Actions: https://github.com/Northsw-spec/YadiLab-n/actions/runs/43176553455
- Krävda checknamn: `source-and-security`, `browser-regressions / compiled-chromium`, `yadilab-required-ci`.
- Historisk status: OPEN, UNMERGED, 3×SUCCESS, visuellt `PENDING_USER`.

Dessa CI-resultat avser **den tidigare HEAD** som anges ovan, inte framtida fixade versioner.
