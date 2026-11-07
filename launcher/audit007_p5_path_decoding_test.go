package main

import (
    "net/http"
    "net/http/httptest"
    "os"
    "path/filepath"
    "strings"
    "testing"
)

// Frozen BEFORE changing server.go. Go's net/http URL.Path is already
// percent-decoded once. An additional PathUnescape may alias a different file.
func audit007P5Serve(t *testing.T, root, path string) *httptest.ResponseRecorder {
    t.Helper()
    h, err := newStaticServer(root)
    if err != nil { t.Fatal(err) }
    request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+path, nil)
    result := httptest.NewRecorder()
    h.ServeHTTP(result, request)
    return result
}

func audit007P5Write(t *testing.T, filename, contents string) {
    t.Helper()
    if err := os.WriteFile(filename, []byte(contents), 0600); err != nil { t.Fatal(err) }
}

func TestAudit007P5DoubleEncodedSlashDoesNotAliasNestedFile(t *testing.T) {
    root := fixture(t)
    nested := filepath.Join(root, "nested")
    if err := os.Mkdir(nested, 0700); err != nil { t.Fatal(err) }
    audit007P5Write(t, filepath.Join(nested, "private.txt"), "UNSELECTED_NESTED_RESOURCE_CANARY")
    direct := audit007P5Serve(t, root, "/nested/private.txt")
    if direct.Code != http.StatusOK || !strings.Contains(direct.Body.String(), "UNSELECTED_NESTED_RESOURCE_CANARY") {
        t.Fatalf("positive direct nested file control failed: HTTP %d %q", direct.Code, direct.Body.String())
    }
    forbidden := audit007P5Serve(t, root, "/nested%2fprivate.txt")
    if forbidden.Code != http.StatusBadRequest {
        t.Fatalf("single encoded slash should remain blocked; got HTTP %d", forbidden.Code)
    }
    aliased := audit007P5Serve(t, root, "/nested%252fprivate.txt")
    if aliased.Code != http.StatusNotFound || strings.Contains(aliased.Body.String(), "UNSELECTED_NESTED_RESOURCE_CANARY") {
        t.Fatalf("double-encoded slash must NOT alias nested resource: HTTP %d body %q",
            aliased.Code, aliased.Body.String())
    }
    t.Log("PASS AUDIT-007 P5 double-encoded slash cannot alias another source file")
}

func TestAudit007P5DoubleEncodedDotSegmentDoesNotAliasRoot(t *testing.T) {
    root := fixture(t)
    direct := audit007P5Serve(t, root, "/")
    if direct.Code != http.StatusOK { t.Fatalf("positive root control: HTTP %d", direct.Code) }
    forbidden := audit007P5Serve(t, root, "/%2e%2e/index.html")
    if forbidden.Code != http.StatusBadRequest {
        t.Fatalf("single encoded dot segments must be rejected; HTTP %d", forbidden.Code)
    }
    aliased := audit007P5Serve(t, root, "/%252e%252e/index.html")
    if aliased.Code != http.StatusNotFound || strings.Contains(aliased.Body.String(), "<html>ok</html>") {
        t.Fatalf("double-encoded dot segment unexpectedly aliased root index: HTTP %d", aliased.Code)
    }
    t.Log("PASS AUDIT-007 P5 double-encoded dot segment does not alias root")
}

func TestAudit007P5LiteralEncodedSeparatorInFilename(t *testing.T) {
    root := fixture(t)
    audit007P5Write(t, filepath.Join(root, "literal%2fsegment.txt"), "LITERAL_ONE_DECODING_ONLY")
    response := audit007P5Serve(t, root, "/literal%252fsegment.txt")
    if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != "LITERAL_ONE_DECODING_ONLY" {
        t.Fatalf("valid percent-encoded literal filename must be served EXACTLY: HTTP %d body %q",
            response.Code, response.Body.String())
    }
    t.Log("PASS AUDIT-007 P5 literal percent-two-f filename remains literal")
}

func TestAudit007P5SinglePercentSignFilename(t *testing.T) {
    root := fixture(t)
    audit007P5Write(t, filepath.Join(root, "100%-complete.txt"), "PERCENT_FILENAME_POSITIVE")
    response := audit007P5Serve(t, root, "/100%25-complete.txt")
    if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != "PERCENT_FILENAME_POSITIVE" {
        t.Fatalf("valid URL-encoded percent in file name must remain a literal percent: HTTP %d body %q",
            response.Code, response.Body.String())
    }
    t.Log("PASS AUDIT-007 P5 literal percent filename can be served")
}
