#!/usr/bin/env python3
"""Independent negative and representative positive host-label source contract."""
import os
from target_platform_identity import parse_os_release, describe_local_host

assert parse_os_release('ID=parrot\nPRETTY_NAME="Parrot Security OS"\n') == {
    "ID": "parrot", "PRETTY_NAME": "Parrot Security OS"
}
assert parse_os_release('ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04 LTS"\n') == {
    "ID": "ubuntu", "PRETTY_NAME": "Ubuntu 24.04 LTS"
}
assert parse_os_release('ID=debian\nPRETTY_NAME="Parrot Security Linux"\n') == {
    "ID": "debian", "PRETTY_NAME": "Parrot Security Linux"
}
context = describe_local_host()
assert isinstance(context["actualParrotHost"], bool)
assert context["osId"] not in ("", None)
assert context["osPrettyName"] not in ("", None)
# An env var cannot change the on-disk OS identity.
previous = (os.environ.get("ID"), os.environ.get("PRETTY_NAME"))
os.environ["ID"] = "parrot"
os.environ["PRETTY_NAME"] = "Parrot Security"
try:
    assert describe_local_host() == context, "OS metadata was spoofed by process env"
finally:
    for key, old in zip(("ID", "PRETTY_NAME"), previous):
        if old is None: os.environ.pop(key, None)
        else: os.environ[key] = old
print("PASS: actual os-release host metadata stable under spoofed environment; no Parrot PASS inferred")
