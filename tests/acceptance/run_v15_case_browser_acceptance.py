import json
import sys
import time
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
    driver.get(url)
    wait = WebDriverWait(driver, 20)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '[data-troubleshooting-case="ready"]')))
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-case-create="true"]'))).click()
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '[data-case-summary="true"]')))
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-case-note="true"]'))).click()
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-case-reset="true"]'))).click()
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-case-export="true"]')))
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-session-export="true"]'))).click()
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '[data-session-import="true"]')))
    wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Kompilera + layout')]") )).click()
    wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Förhandsvisa körläge')]") )).click()
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[data-case-reproduce="true"]'))).click()
    time.sleep(1)
    severe = [item for item in driver.get_log("browser") if item.get("level") == "SEVERE"]
    if severe:
        raise AssertionError(json.dumps(severe))
    print(json.dumps({"status": "PASS", "case": "create/note/reset/export", "reproduction": "canonical source -> compiler -> engine", "consoleUncaughtErrors": 0}))
finally:
    driver.quit()
