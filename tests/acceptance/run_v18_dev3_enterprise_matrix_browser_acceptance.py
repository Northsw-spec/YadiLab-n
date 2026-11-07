import argparse
import json
import sys
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.select import Select
from selenium.webdriver.support.ui import WebDriverWait


def wait(driver, expression, message, timeout=60):
    WebDriverWait(driver, timeout).until(lambda d: d.execute_script(f"return {expression}"))


def run_size(driver, size):
    Select(driver.find_element(By.CSS_SELECTOR, '[data-enterprise-scenario-selector="true"]')).select_by_value(f"enterprise_office_{size}")
    driver.find_element(By.CSS_SELECTOR, '[data-enterprise-start="runtime"]').click()
    wait(driver, f"document.querySelectorAll('.react-flow__node').length >= {size}", f"{size}-node topology missing")
    driver.find_element(By.CSS_SELECTOR, '[data-enterprise-start="builder"]').click()
    wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", "enterprise source did not return to Builder")
    driver.find_element(By.CSS_SELECTOR, '[data-intent-create-multi="true"]').click()
    driver.find_element(By.CSS_SELECTOR, '[data-intent-preview="true"]').click()
    wait(driver, "document.querySelector('[data-intent-preview-summary]') !== null", "enterprise expansion preview missing")
    driver.find_element(By.CSS_SELECTOR, '[data-intent-run="true"]').click()
    wait(driver, "document.querySelector('[data-intent-matrix]') !== null", "enterprise matrix missing")
    cells = driver.find_elements(By.CSS_SELECTOR, '[data-intent-matrix-cell]')
    if not cells or not driver.find_elements(By.CSS_SELECTOR, '[data-intent-matrix-case]'):
        raise AssertionError(f"{size}-node matrix did not expose concrete cases")
    return {"size": size, "cells": len(cells), "cases": len(driver.find_elements(By.CSS_SELECTOR, '[data-intent-matrix-case]'))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--chrome", default="/bin/google-chrome")
    parser.add_argument("--chromedriver", default="/bin/chromedriver")
    parser.add_argument("--evidence-dir", type=Path, required=True)
    args = parser.parse_args()
    options = Options()
    options.binary_location = args.chrome
    for flag in ("--headless=new", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-component-update", "--no-first-run"): options.add_argument(flag)
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(service=Service(args.chromedriver), options=options)
    try:
        driver.set_window_size(1920, 1080)
        driver.get(args.url)
        wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", "app did not mount")
        results = [run_size(driver, 30), run_size(driver, 50), run_size(driver, 80)]
        severe = [entry for entry in driver.get_log("browser") if entry.get("level") == "SEVERE"]
        if severe: raise AssertionError(f"browser console errors: {severe}")
        report = {"status": "PASS", "browser": driver.capabilities.get("browserVersion"), "enterprise": results, "consoleUncaughtErrors": 0}
        args.evidence_dir.mkdir(parents=True, exist_ok=True)
        (args.evidence_dir / "v18-dev3-enterprise-matrix-browser-acceptance.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        return 0
    except Exception as exc:
        print(f"FAIL v18 Dev3 enterprise matrix browser acceptance: {exc}", file=sys.stderr)
        return 1
    finally:
        driver.quit()


if __name__ == "__main__": raise SystemExit(main())
