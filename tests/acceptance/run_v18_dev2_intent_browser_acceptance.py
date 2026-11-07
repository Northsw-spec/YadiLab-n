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
        driver.find_element(By.CSS_SELECTOR, '[data-intent-create-multi="true"]').click()
        driver.find_element(By.CSS_SELECTOR, '[data-intent-preview="true"]').click()
        wait(driver, "document.querySelector('[data-intent-preview-summary]') !== null", "intent expansion preview missing")
        preview = driver.find_element(By.CSS_SELECTOR, '[data-intent-preview-summary]').text
        if "Concrete cases" not in preview:
            raise AssertionError(f"missing concrete case count: {preview}")
        driver.find_element(By.CSS_SELECTOR, '[data-intent-run="true"]').click()
        wait(driver, "document.querySelector('[data-intent-run-summary]') !== null", "IntentRun summary missing")
        summary = driver.find_element(By.CSS_SELECTOR, '[data-intent-run-summary]').text
        cases = driver.find_elements(By.CSS_SELECTOR, '[data-intent-case]')
        if len(cases) < 2:
            raise AssertionError(f"multi-case IntentRun did not render cases: {len(cases)}")
        for case in cases:
            driver.execute_script("arguments[0].open = true", case)
        case_text = "\n".join(case.text for case in cases)
        if "Expected" not in case_text or "Actual" not in case_text or "Engine run" not in case_text:
            raise AssertionError(f"Expected/Actual/Engine binding missing: {case_text}")
        if any(term in summary.lower() for term in ("score", "ranking", "best")):
            raise AssertionError(f"forbidden ranking language in IntentRun summary: {summary}")
        severe = [entry for entry in driver.get_log("browser") if entry.get("level") == "SEVERE"]
        if severe:
            raise AssertionError(f"browser console errors: {severe}")
        report = {"status": "PASS", "browser": driver.capabilities.get("browserVersion"), "preview": preview, "runSummary": summary, "caseCount": len(cases), "consoleUncaughtErrors": 0}
        args.evidence_dir.mkdir(parents=True, exist_ok=True)
        (args.evidence_dir / "v18-dev2-intent-browser-acceptance.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        return 0
    except Exception as exc:
        print(f"FAIL v18 Dev2 Intent browser acceptance: {exc}", file=sys.stderr)
        return 1
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
