#!/usr/bin/env python3
"""PROJECT-086: real Chromium topology navigation and mouse contract."""
import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def viewport(page):
    transform = page.locator(".topology-panel .react-flow__viewport").get_attribute("style") or ""
    match = re.search(r"translate\(([-0-9.]+)px,\s*([-0-9.]+)px\) scale\(([-0-9.]+)\)", transform)
    if not match:
        raise AssertionError(f"Missing React Flow viewport transform: {transform}")
    return tuple(float(value) for value in match.groups())


def start_lab(page, scenario_id):
    page.locator('[data-guided-lab-catalog="wave1"]').select_option(scenario_id)
    page.locator('[data-guided-lab-start="direct"]').click()
    page.wait_for_function(
        "scenario => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id') === scenario",
        arg=scenario_id,
        timeout=45000,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    if target.scheme != "http" or target.hostname != "127.0.0.1" or not target.port or target.path != "/":
        raise AssertionError("PROJECT-086 must exercise compiled app on loopback")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=30000)
            start_lab(page, "guided_linux_ssh")
            panel = page.locator(".topology-panel")
            expect(panel).to_be_visible(timeout=15000)
            node = page.locator('.react-flow__node[data-id="client1"]')
            expect(node).to_be_visible(timeout=15000)

            initial = viewport(page)
            interaction_surface = page.locator(".react-flow__pane")
            expect(interaction_surface).to_be_visible(timeout=10000)
            interaction_surface.scroll_into_view_if_needed()
            box = interaction_surface.bounding_box()
            if not box:
                raise AssertionError("Missing topology panel bounds")
            center = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
            page.mouse.move(center["x"], center["y"])
            page.mouse.down(button="middle")
            page.mouse.move(center["x"] + 90, center["y"] + 45, steps=8)
            page.mouse.up(button="middle")
            after_middle = viewport(page)
            if after_middle[2] != initial[2] or after_middle[:2] == initial[:2]:
                raise AssertionError(f"Middle drag did not pan without zoom: {initial} -> {after_middle}")
            expect(page.locator('[data-topology-context-menu]')).to_have_count(0)

            page.mouse.move(center["x"], center["y"])
            page.mouse.wheel(0, -400)
            after_wheel = viewport(page)
            if after_wheel[2] <= after_middle[2]:
                raise AssertionError(f"Wheel did not zoom in: {after_middle} -> {after_wheel}")

            page.mouse.move(center["x"], center["y"])
            page.mouse.down(button="right")
            page.mouse.move(center["x"] + 120, center["y"] + 20, steps=8)
            page.mouse.up(button="right")
            after_right_drag = viewport(page)
            if after_right_drag != after_wheel:
                raise AssertionError(f"Right drag unexpectedly panned: {after_wheel} -> {after_right_drag}")

            node.scroll_into_view_if_needed()
            node_box = node.bounding_box()
            if not node_box:
                raise AssertionError("Missing node bounds for context menu")
            page.mouse.click(node_box["x"] + node_box["width"] / 2, node_box["y"] + node_box["height"] / 2, button="right")
            menu = page.locator('[data-topology-context-menu="node"]')
            expect(menu).to_be_visible(timeout=10000)
            expect(menu).to_contain_text("client1")
            menu.get_by_role("menuitem", name="Visa enhetsdetaljer").click()
            expect(page.locator('[data-topology-context-details="node"]')).to_contain_text("client1")
            page.get_by_role("button", name="Stäng detaljer").click()

            node.dblclick(force=True)
            expect(page.locator('[data-topology-breadcrumb="focus"]')).to_be_visible(timeout=10000)
            expect(page.locator('[data-topology-focus-counts]')).to_be_visible(timeout=10000)
            expect(page.locator('[data-topology-context-menu]')).to_have_count(0)
            page.keyboard.press("Escape")
            page.locator(".topology-panel").click(position={"x": 12, "y": 12})
            page.get_by_role("button", name="Nätverksöversikt").last.click()
            expect(page.locator('[data-topology-breadcrumb="overview"]')).to_be_visible(timeout=10000)
            if errors:
                raise AssertionError("Chromium page errors: " + repr(errors))
            evidence = {"initial": initial, "afterMiddle": after_middle, "afterWheel": after_wheel, "afterRightDrag": after_right_drag, "pageErrors": errors, "status": "PASS"}
            (args.evidence_dir / "project086-topology-explorer.json").write_text(json.dumps(evidence, indent=2) + "\n")
            print("PASS PROJECT-086 topology explorer Chromium")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
