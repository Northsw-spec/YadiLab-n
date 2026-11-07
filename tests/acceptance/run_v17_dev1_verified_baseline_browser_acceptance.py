import json
import sys
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

url = sys.argv[1]
options = Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--window-size=1920,1080")
options.binary_location = "/bin/chromium"
options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
driver = webdriver.Chrome(service=Service("/bin/chromedriver"), options=options)
try:
    wait = WebDriverWait(driver, 30)
    driver.get(url)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '[data-verified-baselines="ready"]')))
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-case-create="true"]'))).click()
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-experiment-create-baseline="true"]'))).click()
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '[data-experiment-list="true"]')))
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-experiment-run="true"]'))).click()
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '[data-experiment-status="true"]')))
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-baseline-create="true"]'))).click()
    summary = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '[data-baseline-summary="true"]')))
    identity_before = summary.find_element(By.TAG_NAME, "small").text
    assert "Source identity" in identity_before
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-experiment-reset="true"]'))).click()
    identity_after = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '[data-baseline-summary="true"]'))).find_element(By.TAG_NAME, "small").text
    assert identity_before == identity_after
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-baseline-reproduce="true"]'))).click()
    wait.until(lambda d: d.find_element(By.TAG_NAME, "html").get_attribute("data-app-runtime") == "ready")
    severe = [item for item in driver.get_log("browser") if item.get("level") == "SEVERE"]
    if severe:
        raise AssertionError(json.dumps(severe))
    print(json.dumps({"status": "PASS", "baseline": "immutable source snapshot", "reproduction": "fresh Compiler + Engine run", "consoleUncaughtErrors": 0}))
finally:
    driver.quit()
