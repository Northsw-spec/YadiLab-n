#!/usr/bin/env python3
"""Real Chrome/Chromium acceptance for the dev30 viewport, Journey and enterprise selector."""

import argparse
import json
from pathlib import Path
import re
import sys
import time

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.select import Select
from selenium.webdriver.support.ui import WebDriverWait


def require(value, message):
    if not value:
        raise AssertionError(message)


def rect(driver, selector):
    return driver.execute_script(
        "const r=document.querySelector(arguments[0]).getBoundingClientRect();"
        "return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};",
        selector,
    )


def button(driver, text):
    matches = driver.find_elements(By.XPATH, f"//button[normalize-space()='{text}']")
    require(len(matches) == 1, f"expected one button {text!r}, found {len(matches)}")
    return matches[0]


def wait(driver, expression, message, timeout=40):
    try:
        return WebDriverWait(driver, timeout).until(lambda d: d.execute_script(f"return !!({expression})"))
    except Exception as exc:
        raise AssertionError(f"{message}: {exc}") from exc


def journey_outcome_marker_count(driver, marker, anchor=None):
    return driver.execute_script(
        """
        const marker=arguments[0], anchor=arguments[1];
        const root=anchor
          ? [...document.querySelectorAll('.react-flow__node')].find((node)=>node.dataset.id===anchor)
          : document;
        if(!root) return 0;
        return root.querySelectorAll(`[data-outcome-marker="${marker}"]`).length;
        """,
        marker,
        anchor,
    )


def drive_journey_to_terminal(driver, player):
    pause = player.find_elements(By.XPATH, ".//button[normalize-space()='Pausa']")
    if pause:
        pause[0].click()
        time.sleep(.05)
    for _ in range(512):
        outcome = player.find_element(By.CSS_SELECTOR, ".journey-outcome")
        status = outcome.get_attribute("data-journey-outcome-status")
        if status != "pending":
            return outcome
        step = player.find_element(By.XPATH, ".//button[normalize-space()='Steg ▶']")
        require(step.is_enabled(), "Journey reached a non-terminal state with no enabled forward step")
        step.click()
        time.sleep(.025)
    raise AssertionError("Journey did not reach its terminal Engine event within 512 deterministic steps")


def verify_terminal_outcome_marker(driver, player, results):
    outcome = drive_journey_to_terminal(driver, player)
    status = outcome.get_attribute("data-journey-outcome-status")
    anchor = outcome.get_attribute("data-journey-outcome-anchor")
    exact_location = outcome.get_attribute("data-journey-outcome-exact-location") == "true"
    marker = player.get_attribute("data-journey-outcome-marker")
    duration_ms = int(player.get_attribute("data-journey-outcome-marker-ms"))
    require(status in ("destination_reached", "dropped", "unknown"), f"unexpected terminal Journey outcome: {status}")
    require(duration_ms == 4000, f"Journey success/drop marker contract must be exactly 4000 ms, got {duration_ms}")

    if status == "destination_reached":
        require(marker == "success", f"destination_reached must use success marker, got {marker}")
        require(exact_location and anchor not in ("", "UNMODELED", "PENDING"), f"destination success must be anchored to exact destination: anchor={anchor!r}")
    elif status == "dropped" and exact_location:
        require(marker == "drop", f"exact dropped outcome must use drop marker, got {marker}")
        require(anchor not in ("", "UNMODELED", "PENDING"), f"exact drop must have Engine-owned anchor: {anchor!r}")
    elif status == "dropped":
        require(marker == "none", f"unlocated drop must not fabricate a red marker, got {marker}")
    else:
        require(marker in ("unknown", "none"), f"UNKNOWN may not fabricate success/drop marker, got {marker}")

    if marker in ("success", "drop"):
        started = time.monotonic()
        WebDriverWait(driver, 1.0).until(lambda d: journey_outcome_marker_count(d, marker, anchor) == 1)
        require(journey_outcome_marker_count(driver, "drop" if marker == "success" else "success") == 0, "contradictory success/drop outcome marker rendered")
        toggle_name = "success" if marker == "success" else "drop"
        toggle = driver.find_element(By.CSS_SELECTOR, f'[data-outcome-toggle="{toggle_name}"]')
        require(toggle.is_selected(), f"{toggle_name} outcome toggle must default ON")
        toggle.click()
        require(journey_outcome_marker_count(driver, marker, anchor) == 0, f"{toggle_name} toggle OFF did not hide the marker")
        toggle.click()
        WebDriverWait(driver, 1.0).until(lambda d: journey_outcome_marker_count(d, marker, anchor) == 1)
        time.sleep(3.20)
        require(journey_outcome_marker_count(driver, marker, anchor) == 1, f"{marker} marker disappeared substantially before the 4-second contract")
        WebDriverWait(driver, 2.0, poll_frequency=.05).until(lambda d: journey_outcome_marker_count(d, marker, anchor) == 0)
        elapsed = time.monotonic() - started
        require(3.5 <= elapsed <= 5.4, f"{marker} marker lifetime outside acceptance tolerance around 4 s: {elapsed:.2f}s")
        results.append(f"terminal outcome {status}: {marker} marker at {anchor} for ~4 s ({elapsed:.2f}s)")
    elif marker == "unknown":
        require(journey_outcome_marker_count(driver, "success") == 0 and journey_outcome_marker_count(driver, "drop") == 0, "UNKNOWN rendered false success/drop marker")
        results.append(f"terminal outcome UNKNOWN: neutral marker only at {anchor}")
    else:
        require(journey_outcome_marker_count(driver, "success") == 0 and journey_outcome_marker_count(driver, "drop") == 0, "unlocated drop rendered fabricated success/drop marker")
        results.append("terminal drop has no fabricated node marker because exact Engine drop location is unavailable")


def check_viewport(driver, width, height, evidence_dir, results):
    driver.set_window_size(width, height)
    driver.execute_script("window.scrollTo(0, 0)")
    time.sleep(.35)
    metrics = driver.execute_script("""
      const topology=document.querySelector('.topology-panel').getBoundingClientRect();
      const playback=document.querySelector('[data-visual-journey="ready"]').getBoundingClientRect();
      const workspace=document.querySelector('.workspace-grid').getBoundingClientRect();
      const right=document.querySelector('.right-scroll-column');
      const header=document.querySelector('.app-header').getBoundingClientRect();
      return {
        innerWidth,innerHeight,scrollY,topology:{x:topology.x,y:topology.y,width:topology.width,height:topology.height,bottom:topology.bottom},
        playback:{x:playback.x,y:playback.y,width:playback.width,height:playback.height,top:playback.top,bottom:playback.bottom},
        workspace:{x:workspace.x,y:workspace.y,width:workspace.width,height:workspace.height},
        header:{x:header.x,y:header.y,width:header.width,height:header.height,bottom:header.bottom},
        documentWidth:document.documentElement.scrollWidth,documentClientWidth:document.documentElement.clientWidth,documentHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight,
        rightClientHeight:right.clientHeight,rightScrollHeight:right.scrollHeight,
      };
    """)
    require(metrics["topology"]["width"] > 500, f"topology too narrow at {width}x{height}: {metrics}")
    require(metrics["topology"]["height"] > 260, f"topology zero/clipped at {width}x{height}: {metrics}")
    require(metrics["topology"]["height"] >= 500, f"topology is not a bounded working area: {metrics}")
    require(metrics["playback"]["top"] >= metrics["topology"]["bottom"] + 8, f"playback overlaps topology: {metrics}")
    require(metrics["documentWidth"] == metrics["documentClientWidth"], f"unexpected horizontal document overflow: {metrics}")
    require(metrics["documentHeight"] > metrics["clientHeight"], f"document is not vertically scrollable: {metrics}")
    require(metrics["header"]["bottom"] < metrics["workspace"]["y"], "header overlaps workspace")
    require(metrics["rightScrollHeight"] > metrics["rightClientHeight"], "right panel is not independently scrollable")
    screenshot = evidence_dir / f"dev23-{width}x{height}.png"
    driver.save_screenshot(str(screenshot))
    before_scroll = driver.execute_script("return window.scrollY")
    driver.execute_script("window.scrollTo({top: document.body.scrollHeight, behavior: 'instant'})")
    WebDriverWait(driver, 3).until(lambda d: d.execute_script("return window.scrollY") > before_scroll)
    require(driver.find_element(By.CSS_SELECTOR, '[data-visual-journey="ready"]').is_displayed(), "playback is not reachable by document scroll")
    require(button(driver, "Spela om").is_enabled() and button(driver, "Spela").is_enabled(), "playback controls are not clickable after document scroll")
    require(driver.find_element(By.CSS_SELECTOR, '[data-event-xray="ready"]').is_displayed(), "Event X-Ray is not reachable after document scroll")
    driver.execute_script("window.scrollTo(0, 0)")
    WebDriverWait(driver, 3).until(lambda d: d.execute_script("return window.scrollY") == 0)
    require(driver.find_element(By.CSS_SELECTOR, ".topology-panel").is_displayed(), "topology is not reachable after scrolling back to top")
    results.append(f"viewport {width}x{height}: bounded topology, non-overlapping playback, document scroll and X-Ray reachability")


def live(url, chrome, chromedriver, evidence_dir):
    options = Options()
    options.binary_location = chrome
    options.add_argument("--headless=new")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-component-update")
    options.add_argument("--no-first-run")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(service=Service(chromedriver), options=options)
    results = []
    try:
        driver.set_window_size(1920, 1080)
        driver.get(url.rstrip("/") + "/acceptance.html")
        WebDriverWait(driver, 30).until(lambda d: d.execute_script("return document.documentElement.dataset.acceptance") in ("pass", "fail"))
        require(driver.execute_script("return document.documentElement.dataset.acceptance") == "pass", "secure-context/IndexedDB/cache/service-worker probe failed")
        results.append("secure context + IndexedDB + Cache API + service worker")
        driver.get(url)
        wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", "React app did not mount")
        require(driver.find_element(By.CSS_SELECTOR, '[data-yadilab-build-version="1.8.0-dev.4"]').text == "v1.8.0-dev.4", "visible v1.8.0-dev.4 build marker missing")
        require(driver.find_element(By.CSS_SELECTOR, '[data-enterprise-scenario-selector="true"]').is_displayed(), "enterprise scenario selector missing")
        require(len(driver.find_elements(By.CSS_SELECTOR, '[data-enterprise-scenario-selector="true"] option')) >= 1, "truthful enterprise scenario selector missing options")
        enterprise_selector = Select(driver.find_element(By.CSS_SELECTOR, '[data-enterprise-scenario-selector="true"]'))
        expected_enterprise_sizes = {"enterprise_office_30": 30, "enterprise_office_healthy": 35, "enterprise_office_50": 50, "enterprise_office_70": 70, "enterprise_office_80": 80}
        for option in enterprise_selector.options:
            scenario_id = option.get_attribute("value")
            expected_nodes = expected_enterprise_sizes.get(scenario_id)
            require(expected_nodes is not None, f"enterprise scenario has no acceptance size contract: {scenario_id}")
            enterprise_selector.select_by_value(scenario_id)
            driver.find_element(By.CSS_SELECTOR, '[data-enterprise-start="runtime"]').click()
            WebDriverWait(driver, 45).until(lambda d, expected_nodes=expected_nodes: len(d.find_elements(By.CSS_SELECTOR, ".react-flow__node")) >= expected_nodes)
            require(len(driver.find_elements(By.CSS_SELECTOR, ".react-flow__node")) >= expected_nodes, f"enterprise topology did not render {expected_nodes} nodes")
            require(driver.find_element(By.CSS_SELECTOR, ".react-flow__controls").is_displayed(), f"enterprise controls missing for {scenario_id}")
            driver.find_element(By.XPATH, "//button[normalize-space()='Tillbaka till byggläget']").click()
            wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", f"return from enterprise size {scenario_id} failed")
        enterprise_selector.select_by_value("enterprise_office_healthy")
        driver.find_element(By.CSS_SELECTOR, '[data-enterprise-start="runtime"]').click()
        WebDriverWait(driver, 45).until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".react-flow__node")) >= 35)
        require(len(driver.find_elements(By.CSS_SELECTOR, ".react-flow__node")) >= 35, "enterprise topology did not render 35 nodes")
        require(driver.find_element(By.CSS_SELECTOR, ".topology-panel").is_displayed(), "enterprise topology workspace missing")
        results.append("enterprise selector + 30/35/50/70/80-node runtime topologies")
        driver.find_element(By.XPATH, "//button[normalize-space()='Tillbaka till byggläget']").click()
        wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", "return from enterprise runtime failed")
        button(driver, "Starta guidad labb").click()
        WebDriverWait(driver, 30).until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".react-flow__node")) > 0)
        require(len(driver.find_elements(By.CSS_SELECTOR, ".react-flow__node")) > 0, "guided topology did not render after enterprise runtime")
        driver.find_element(By.XPATH, "//button[normalize-space()='Tillbaka till byggläget']").click()
        wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", "return from guided runtime failed")
        Select(driver.find_element(By.CSS_SELECTOR, '[data-enterprise-scenario-selector="true"]')).select_by_value("enterprise_office_healthy")
        driver.find_element(By.CSS_SELECTOR, '[data-enterprise-start="runtime"]').click()
        WebDriverWait(driver, 45).until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".react-flow__node")) >= 35)
        require(len(driver.find_elements(By.CSS_SELECTOR, ".react-flow__node")) >= 35, "enterprise topology did not survive Guided -> Enterprise regression")
        results.append("Enterprise -> Guided -> Enterprise regression")
        driver.find_element(By.XPATH, "//button[normalize-space()='Tillbaka till byggläget']").click()
        wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", "return from enterprise regression failed")
        require(len(driver.find_elements(By.CSS_SELECTOR, ".react-flow__minimap")) == 0, "white/default MiniMap overlay remains")
        control = driver.find_element(By.CSS_SELECTOR, ".react-flow__controls-button")
        rgb = [int(x) for x in re.findall(r"\d+", control.value_of_css_property("background-color"))[:3]]
        require(len(rgb) == 3 and sum(rgb) < 280, f"React Flow control is not dark themed: {rgb}")
        results.append("mounted topology + dark controls + no MiniMap overlay")

        topology = driver.find_element(By.CSS_SELECTOR, ".topology-panel")
        before = rect(driver, ".topology-panel")
        right = driver.find_element(By.CSS_SELECTOR, ".right-scroll-column")
        driver.execute_script("arguments[0].scrollTop=Math.min(700,arguments[0].scrollHeight-arguments[0].clientHeight)", right)
        time.sleep(.2)
        after = rect(driver, ".topology-panel")
        require(topology.is_displayed() and driver.execute_script("return arguments[0].isConnected", topology), "topology remounted/disappeared during right scroll")
        require(abs(before["y"] - after["y"]) < 1 and abs(before["height"] - after["height"]) < 1, "right scroll moved/resized topology")
        results.append("right scroll independent from topology")

        driver.execute_script("arguments[0].scrollTop=0", right)
        button(driver, "Kompilera + layout").click()
        WebDriverWait(driver, 45).until(lambda d: button(d, "Förhandsvisa körläge").is_enabled())
        require(len(driver.find_elements(By.CSS_SELECTOR, ".react-flow__node")) > 0, "compiled topology nodes missing")
        button(driver, "Förhandsvisa körläge").click()
        wait(driver, "document.querySelector('[data-active-probe-engine=wave2]')", "active probe panel missing")

        probe_panel = driver.find_element(By.CSS_SELECTOR, '[data-active-probe-engine="wave2"]')
        driver.execute_script("arguments[0].scrollIntoView({block:'center'})", probe_panel)
        Select(probe_panel.find_element(By.XPATH, ".//label[contains(.,'Källvärd')]/select")).select_by_value("admin01")
        Select(probe_panel.find_element(By.XPATH, ".//label[contains(.,'Aktiv probe')]/select")).select_by_value("windows.test_netconnection")
        Select(probe_panel.find_element(By.XPATH, ".//label[contains(.,'Destination')]/select")).select_by_value("rds01")
        port = probe_panel.find_element(By.XPATH, ".//label[contains(.,'TCP port')]/input")
        port.clear(); port.send_keys("3389")
        probe_panel.find_element(By.XPATH, ".//button[normalize-space()='Kör modellerad aktiv probe']").click()
        wait(driver, "document.querySelector('[data-visual-journey=ready]')", "packet journey did not appear")
        player = driver.find_element(By.CSS_SELECTOR, '[data-visual-journey="ready"]')
        require(player.is_displayed(), "packet journey controls are not reachable")
        xray = player.find_element(By.CSS_SELECTOR, '[data-event-xray="ready"]')
        require(xray.is_displayed(), "synchronized Event X-Ray is not visible")
        require(xray.get_attribute("data-xray-sequence") == "1", "Event X-Ray must start on the same first Journey event")
        first_xray_event = xray.get_attribute("data-xray-event-id")
        require(first_xray_event, "Event X-Ray has no canonical event id")
        labels = {item.text for item in player.find_elements(By.CSS_SELECTOR, "button")}
        require("Spela om" in labels and "Steg ▶" in labels and ("Spela" in labels or "Pausa" in labels), f"Journey controls incomplete: {labels}")
        replay = player.find_element(By.XPATH, ".//button[normalize-space()='Spela om']")
        replay.click()
        time.sleep(1.1)
        require(len(driver.find_elements(By.CSS_SELECTOR, ".journey-pdu, .journey-node-current, .journey-node-arrived")) > 0, "Play animation produced no visible packet/node state")
        pause = player.find_elements(By.XPATH, ".//button[normalize-space()='Pausa']")
        if pause: pause[0].click()
        step = player.find_element(By.XPATH, ".//button[normalize-space()='Steg ▶']")
        if step.is_enabled():
            before_xray = player.find_element(By.CSS_SELECTOR, '[data-event-xray="ready"]').get_attribute("data-xray-event-id")
            step.click()
            WebDriverWait(driver, 2).until(lambda d: player.find_element(By.CSS_SELECTOR, '[data-event-xray="ready"]').get_attribute("data-xray-event-id") != before_xray)
            require(player.find_element(By.CSS_SELECTOR, '[data-event-xray="ready"]').get_attribute("data-xray-sequence") == str(int(player.find_element(By.CSS_SELECTOR, '[data-event-xray="ready"]').get_attribute("data-xray-sequence"))), "X-Ray sequence must remain numeric")
        back = player.find_element(By.XPATH, ".//button[normalize-space()='◀ Steg']")
        if back.is_enabled():
            current = player.find_element(By.CSS_SELECTOR, '[data-event-xray="ready"]').get_attribute("data-xray-event-id")
            back.click()
            WebDriverWait(driver, 2).until(lambda d: player.find_element(By.CSS_SELECTOR, '[data-event-xray="ready"]').get_attribute("data-xray-event-id") != current)
        Select(player.find_element(By.XPATH, ".//label[contains(.,'Rendering')]/select")).select_by_value("particle")
        Select(player.find_element(By.XPATH, ".//label[contains(.,'Hastighet')]/select")).select_by_value("2")
        require(driver.find_element(By.CSS_SELECTOR, ".journey-event").is_displayed(), "journey timeline/event is hidden")
        require(len(driver.find_elements(By.CSS_SELECTOR, '[data-path-comparison-xray="ready"]')) == 1, "Forward/Return Path X-Ray is not reachable")
        results.append("Journey Play/Pause/Replay/Step + synchronized Event X-Ray + speed/renderer + Forward/Return X-Ray")
        verify_terminal_outcome_marker(driver, player, results)
        driver.save_screenshot(str(evidence_dir / "dev23-terminal-outcome.png"))

        stable = rect(driver, ".topology-panel")
        details = driver.find_elements(By.CSS_SELECTOR, ".right-scroll-column details")
        driver.execute_script("for(const d of arguments[0]) d.open=false", details)
        time.sleep(.2)
        closed = rect(driver, ".topology-panel")
        require(len(driver.find_elements(By.CSS_SELECTOR, ".react-flow__node")) > 0, "closing all accordions removed nodes")
        require(abs(stable["height"] - closed["height"]) < 1 and closed["height"] > 260, "closing all accordions changed/zeroed topology")
        driver.execute_script("for(const d of arguments[0]) d.open=true", details)
        time.sleep(.2)
        opened = rect(driver, ".topology-panel")
        require(abs(stable["height"] - opened["height"]) < 1, "opening all accordions changed topology")
        results.append("all accordions closed/open: topology identity and dimensions stable")

        check_viewport(driver, 1920, 1080, evidence_dir, results)
        check_viewport(driver, 1366, 768, evidence_dir, results)
        driver.refresh()
        wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", "refresh did not remount")
        require(driver.find_element(By.CSS_SELECTOR, ".topology-panel").is_displayed(), "refresh lost topology viewport")
        require(len(driver.find_elements(By.CSS_SELECTOR, ".react-flow__controls")) == 1, "refresh lost React Flow controls")
        results.append("refresh remounted topology viewport")

        severe = [entry for entry in driver.get_log("browser") if entry.get("level") == "SEVERE"]
        require(not severe, f"uncaught/relevant Chrome console errors: {severe}")
        report = {"status": "PASS", "browser": driver.capabilities.get("browserVersion"), "results": results, "consoleUncaughtErrors": 0}
        (evidence_dir / "dev23-ui-browser-acceptance.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        return 0
    finally:
        driver.quit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--chrome", default="/bin/google-chrome")
    parser.add_argument("--chromedriver", default="/bin/chromedriver")
    parser.add_argument("--evidence-dir", type=Path, required=True)
    args = parser.parse_args()
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    try:
        return live(args.url, args.chrome, args.chromedriver, args.evidence_dir)
    except Exception as exc:
        print(f"FAIL dev23 Chrome UI acceptance: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
