package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<html>ok</html>"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app.js"), []byte("console.log('ok')"), 0644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestServesOnlyFilesInsideRoot(t *testing.T) {
	h, err := newStaticServer(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), "ok") {
		t.Fatalf("unexpected response: %d %q", rr.Code, rr.Body.String())
	}
	csp := rr.Header().Get("Content-Security-Policy")
	if csp == "" { t.Fatal("missing CSP") }
	if !strings.Contains(csp, "script-src 'self' 'unsafe-eval'") { t.Fatal("CSP must permit pinned Ajv schema compilation without remote script sources") }
	if !strings.Contains(csp, "img-src 'self' blob:") { t.Fatal("CSP must allow only local and blob images") }
	if strings.Contains(csp, "data:") || !strings.Contains(csp, "object-src 'none'") { t.Fatal("CSP may not enable data URLs or object embedding") }
	if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
}

func TestRejectsUnsafeMethods(t *testing.T) {
	h, _ := newStaticServer(fixture(t))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rr.Code)
	}
}

func TestRejectsEncodedTraversal(t *testing.T) {
	h, _ := newStaticServer(fixture(t))
	for _, p := range []string{"/%2e%2e/secret", "/..%2fsecret", "/%5csecret"} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+p, nil)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("%s expected 400, got %d", p, rr.Code)
		}
	}
}

func TestSymlinkEscapeRejected(t *testing.T) {
	root := fixture(t)
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(root, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	h, _ := newStaticServer(root)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/escape.txt", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
	if strings.Contains(rr.Body.String(), "secret") {
		t.Fatal("symlink escaped root")
	}
}

func TestWebmanifestContentType(t *testing.T) {
	root := fixture(t)
	if err := os.WriteFile(filepath.Join(root, "manifest.webmanifest"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	h, _ := newStaticServer(root)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodHead, "http://127.0.0.1/manifest.webmanifest", nil)
	h.ServeHTTP(rr, req)
	if got := rr.Header().Get("Content-Type"); got != "application/manifest+json" {
		t.Fatalf("unexpected content type %q", got)
	}
}
