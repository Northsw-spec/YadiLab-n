# YadiLab v1.8.0-dev.10 runnable test build

This directory is a persistent, self-contained browser test build for the
Dev10 topology-first UI renovation. It is intentionally not a release build.

Run from this directory:

```bash
./START_YADILAB.sh
```

The launcher verifies `ui-dist/build-marker.json`, serves the bundled local
browser assets on loopback, and opens Chromium when available. Override the
default port (`18370`) with `YADILAB_PORT=...`.
