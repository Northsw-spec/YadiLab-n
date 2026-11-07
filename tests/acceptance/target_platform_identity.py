"""Report host operating-system identity from /etc/os-release, never env labels.

This metadata is not proof of physical hardware. Actual Parrot acceptance requires
the separate shell target guard AND runtime source/Chromium evidence.
"""
from pathlib import Path


def parse_os_release(raw: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in raw.splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key not in ("ID", "PRETTY_NAME"):
            continue
        values[key] = value.strip().strip('"').strip("'")
    return values


def describe_local_host() -> dict[str, str | bool]:
    try:
        data = parse_os_release(Path("/etc/os-release").read_text(encoding="utf-8"))
    except (OSError, UnicodeError):
        data = {}
    os_id = data.get("ID", "unknown").lower()
    name = data.get("PRETTY_NAME", "unknown")
    parrot = os_id in ("parrot", "parrotsec") or (os_id == "debian" and "parrot" in name.lower())
    return {"osId": os_id, "osPrettyName": name, "actualParrotHost": parrot}
