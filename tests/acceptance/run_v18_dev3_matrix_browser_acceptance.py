import argparse
import json
import sys
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


def wait(driver, expression, message):
    WebDriverWait(driver, 45).until(lambda d: d.execute_script(f"return {expression}"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--chrome", default="/bin/google-chrome")
    parser.add_argument("--chromedriver", default="/bin/chromedriver")
    parser.add_argument("--evidence-dir", type=Path, required=True)
    args = parser.parse_args()
    options = Options()
    options.binary_location = args.chrome
    options.add_argument("--headless=new")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-component-update")
    options.add_argument("--no-first-run")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(service=Service(args.chromedriver), options=options)
    try:
        driver.set_window_size(1920, 1080)
        driver.get(args.url)
        wait(driver, "document.documentElement.dataset.appRuntime === 'ready'", "app did not mount")
        if driver.find_element(By.CSS_SELECTOR, '[data-yadilab-build-version="1.8.0-dev.4"]').text != "v1.8.0-dev.4":
            raise AssertionError("Dev3 build marker missing")
        driver.find_element(By.CSS_SELECTOR, '[data-intent-create-multi="true"]').click()
        driver.find_element(By.CSS_SELECTOR, '[data-intent-preview="true"]').click()
        wait(driver, "document.querySelector('[data-intent-preview-summary]') !== null", "expansion preview missing")
        driver.find_element(By.CSS_SELECTOR, '[data-intent-run="true"]').click()
        wait(driver, "document.querySelector('[data-intent-matrix]') !== null", "matrix missing")
        cells = driver.find_elements(By.CSS_SELECTOR, '[data-intent-matrix-cell]')
        if len(cells) != 4:
            raise AssertionError(f"expected 4 endpoint-set matrix cells, got {len(cells)}")
        if not driver.find_elements(By.CSS_SELECTOR, '[data-intent-matrix-state="MIXED"]'):
            raise AssertionError("MIXED aggregate cell missing")
        driver.find_element(By.CSS_SELECTOR, '[data-intent-matrix-result-filter="true"]').send_keys("MIXED")
        wait(driver, "document.querySelectorAll('[data-intent-matrix-cell]').length === 1", "result filter did not isolate MIXED")
        driver.find_element(By.CSS_SELECTOR, '[data-intent-matrix-filter-clear="true"]').click()
        wait(driver, "document.querySelectorAll('[data-intent-matrix-cell]').length === 4", "filter clear lost matrix cells")
        driver.find_element(By.CSS_SELECTOR, '[data-intent-matrix-cell][data-intent-matrix-state="MIXED"]').click()
        cases = driver.find_elements(By.CSS_SELECTOR, '[data-intent-matrix-case]')
        if len(cases) != 6:
            raise AssertionError(f"expected 6 drill-down cases, got {len(cases)}")
        if not driver.find_elements(By.CSS_SELECTOR, '[data-intent-open-engine-run]'):
            raise AssertionError("exact Engine run navigation missing")
        selected = driver.find_elements(By.CSS_SELECTOR, '[data-intent-open-engine-run]')[0]
        selected.click()
        diagnostics = driver.find_elements(By.CSS_SELECTOR, ".diagnostic")
        if not any("Exact Engine evidence" in item.text for item in diagnostics):
            raise AssertionError("Engine run selection did not preserve exact binding")
        severe = [entry for entry in driver.get_log("browser") if entry.get("level") == "SEVERE"]
        if severe:
            raise AssertionError(f"browser console errors: {severe}")
        report = {"status": "PASS", "browser": driver.capabilities.get("browserVersion"), "matrixCells": len(cells), "drillDownCases": len(cases), "consoleUncaughtErrors": 0}
        args.evidence_dir.mkdir(parents=True, exist_ok=True)
        (args.evidence_dir / "v18-dev3-matrix-browser-acceptance.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        return 0
    except Exception as exc:
        print(f"FAIL v18 Dev3 matrix browser acceptance: {exc}", file=sys.stderr)
        return 1
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
