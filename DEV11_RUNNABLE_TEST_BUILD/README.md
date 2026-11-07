# YadiLab v1.8.0-dev.11 runnable test build

Detta är en persistent, uppdaterad Dev11-kandidatbuild för manuell Parrot-verifiering.
Den är inte sealed, är immutable-parent-kompatibel med Dev10 och får inte behandlas som ett release-artifact.

Starta från denna katalog:

```bash
./START_YADILAB.sh
```

Startscriptet kontrollerar Dev11-build-markören, startar en loopback-server och öppnar Chromium/Chrome. Standardporten är `18375`; använd exempelvis `YADILAB_PORT=18376 ./START_YADILAB.sh` om porten är upptagen.

Manuell kontroll:

1. Main Actions är organiserade som Lab & Scenario, Builder, Run & Preview och Import / Export.
2. Topologin ligger före runtime-panelerna och kan scrollas som ett normalt dokument.
3. Höger musknapp + drag panorerar topologin; vänsterklick markerar; vänsterdrag på tom yta panorerar inte.
4. Kör en lyckad probe och bekräfta synlig grön `✓` på destinationen.
5. Kör en blockerad probe och bekräfta synlig röd `✕` på exakt blockeringspunkt.
6. Kontrollera att `✓`/`✕` visas efter terminal ankomst/drop och ligger kvar ungefär 4 sekunder.
7. Aktivera `Loop animation`; bekräfta att samma journey spelas om, att terminalmarkören får dwell och att paus stänger av loopen.
8. Kör `Kör modellerad observation`; bekräfta gold state-focus på verklig target-node, texten `CLASS B · node.state` och ingen packet journey.
9. Kontrollera att probe/packet-animationen inte hoppar förbi den Engine-verifierade vägen.
10. Växla mellan flera enterprise- och guided-scenarier utan blank sida, stale topology eller felaktig tidigare journey.
11. Kontrollera att Proxmox är blå/cyan som standard och inte lila.
12. Kontrollera hover, pressed och keyboard-focus på knappar.
13. Kontrollera att stängda chevrons pekar höger `▸` och öppna chevrons pekar ned `▾`.
14. Öppna DevTools och bekräfta att inga severe/uncaught runtime-fel uppstår under växling, observation, loop och probe-körning.
15. Bekräfta att Dev10 inte ändras och att Dev11 fortfarande är en kandidat.

Dev11:s tre deterministiska visualiseringsdemos finns i `Verifierad leverans`:

- `Verified Delivery — Success`: preset `Verified client → Web server · TCP/443` ska ge Engine TRUE och grön `✓`.
- `Verified Delivery — Drop`: preset `Verified client → blocked server · TCP/443` ska ge Engine FALSE vid `drop-server` och röd `✕`.
- `Verified Delivery — Mixed`: kör först `Allowed client → allowed server · TCP/443` och sedan `Blocked client → blocked server · TCP/443` utan att ladda om scenario; samma runtime ska ge TRUE respektive FALSE.

Presets fyller endast i den befintliga Active Probe-panelen. De ersätter inte Engine och gör inte UNKNOWN till ett resultat. Kör därefter `Kör modellerad observation` och kontrollera att `data-runtime-scenario-id` före/efter är samma; observationen är en Class B `node.state`-projektion, inte en packet journey eller ett scenario-byte.

Automatiserad serverkontroll utan browser:

```bash
YADILAB_TEST_ONCE=1 ./START_YADILAB.sh
```

För den nya topology-renderingkontrollen: välj `Verified Delivery — Mixed`, starta den modellerade leveransen och kontrollera hoppen `client-allowed → router01 → allowed-server` samt den blockerade varianten `client01 → router01 → drop-server`. Med ett aktivt packet, och med terminalmarkören synlig, ändra fönsterstorleken mindre/större. Minimera/återställ och maximera/återställ därefter; samma kanoniska länkar ska finnas kvar utan omladdning. Kontrollera också att `✓` stannar på `allowed-server`, `✕` på `drop-server`, och att UNKNOWN fortfarande visas som lila utan terminalmarkör.

Dev11 är avsiktligt fortfarande osigillad. Den manuella Parrot-kontrollen är den återstående användaracceptansen före ett eventuellt seal-beslut.

Slutlig Mixed-kontroll:

A. Välj `Verified Delivery — Mixed`, starta körläge, öppna `Modellerade aktiva prober`, lämna `Probe preset / flöde` på `Allowed client → allowed server · TCP/443`, kör proben och bekräfta packet-hoppen `client-allowed → router01 → allowed-server` samt grön `✓` på `allowed-server` efter terminal ankomst.

B. Välj `Blocked client → blocked server · TCP/443`, kör samma befintliga Active Probe och bekräfta `client-blocked → router01 → blocked-server` samt röd `✕` på `blocked-server` efter terminal drop.

C. Ladda om/öppna Mixed igen. Preset ska alltid återställas till Allowed som dokumenterat default. Upprepa A och B flera gånger och kontrollera att resultatet inte växlar på grund av reload. Växla därefter Allowed → Blocked → Allowed utan browser refresh. Någon separat `Spela båda flödena`-knapp finns inte i denna kandidat; använd explicit flow-selector och Loop endast för det valda flödet.
