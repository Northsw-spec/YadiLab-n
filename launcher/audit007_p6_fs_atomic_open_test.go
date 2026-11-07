package main

import (
    "go/ast"
    "go/parser"
    "go/token"
    "net/http"
    "net/http/httptest"
    "os"
    "path/filepath"
    "strings"
    "testing"
)

const audit007P6OutsideCanary = "AUDIT007_P6_OUTSIDE_STATIC_ROOT_SECRET_80421"

func audit007P6Server(t *testing.T, root string) *staticServer {
    t.Helper()
    s, err := newStaticServer(root)
    if err != nil { t.Fatal(err) }
    // Closing root FD is supported by the secure implementation; no compile
    // dependency on the new Close method in the original first-oracle commit.
    t.Cleanup(func() {
        if closer, ok := interface{}(s).(interface{ Close() error }); ok { _ = closer.Close() }
    })
    return s
}

func audit007P6HTTP(s *staticServer, requestPath string) *httptest.ResponseRecorder {
    w := httptest.NewRecorder()
    r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+requestPath, nil)
    s.ServeHTTP(w, r)
    return w
}

func audit007P6Write(t *testing.T, path, content string) {
    t.Helper()
    if err := os.WriteFile(path, []byte(content), 0600); err != nil {t.Fatal(err)}
}

// Stable, actual ServeHTTP reproduction: an installed server should not switch
// its trusted root to another directory if the pathname is replaced. The old
// path-only implementation answers 404; secure pinned-root FD continues to
// serve the original bytes, never the outside canary.
func TestAudit007P6OriginalRootRemainsPinnedAfterPathReplacement(t *testing.T) {
    parent := t.TempDir()
    root := filepath.Join(parent,"web")
    if err := os.Mkdir(root,0700); err != nil {t.Fatal(err)}
    audit007P6Write(t,filepath.Join(root,"index.html"),"PINNED_ORIGINAL_INDEX_222")
    outside := filepath.Join(parent,"different")
    if err := os.Mkdir(outside,0700); err != nil {t.Fatal(err)}
    audit007P6Write(t,filepath.Join(outside,"index.html"),audit007P6OutsideCanary)
    s := audit007P6Server(t,root)
    first := audit007P6HTTP(s,"/")
    if first.Code != 200 || !strings.Contains(first.Body.String(),"PINNED_ORIGINAL_INDEX_222") {
        t.Fatalf("pre-swap positive original index failed: HTTP %d %q",first.Code,first.Body.String())
    }
    if err := os.Rename(root,root+"-retained"); err != nil {t.Fatal(err)}
    if err := os.Symlink(outside,root); err != nil {t.Fatal(err)}
    second := audit007P6HTTP(s,"/")
    if second.Code != 200 || strings.TrimSpace(second.Body.String())!="PINNED_ORIGINAL_INDEX_222" ||
       strings.Contains(second.Body.String(),audit007P6OutsideCanary) {
        t.Fatalf("trusted root identity changed after original pathname replacement: HTTP %d %q",
            second.Code,second.Body.String())
    }
    t.Log("PASS AUDIT-007 P6 pinned original root survives pathname swap without external bytes")
}

// Fail closed even for a symlink which currently leads inside the root. This
// policy excludes all symlink components so later swapping cannot redirect
// a previously checked path outside the file-descriptor chain.
func TestAudit007P6InRootSymlinkComponentsDenied(t *testing.T) {
    root := fixture(t)
    dir := filepath.Join(root,"assets")
    if err := os.Mkdir(dir,0700); err != nil {t.Fatal(err)}
    audit007P6Write(t,filepath.Join(dir,"readme.txt"),"REAL_ASSET")
    if err := os.Symlink(dir,filepath.Join(root,"alias")); err != nil {t.Fatal(err)}
    if err := os.Symlink(filepath.Join(dir,"readme.txt"),filepath.Join(root,"link.txt")); err != nil {t.Fatal(err)}
    s := audit007P6Server(t,root)
    for _,p:= range []string{"/alias/readme.txt","/link.txt"} {
        res := audit007P6HTTP(s,p)
        if res.Code != http.StatusNotFound || strings.Contains(res.Body.String(),"REAL_ASSET") {
            t.Fatalf("symlink path %s was followed, HTTP %d %q",p,res.Code,res.Body.String())
        }
    }
    direct := audit007P6HTTP(s,"/assets/readme.txt")
    if direct.Code!=200 || strings.TrimSpace(direct.Body.String())!="REAL_ASSET" {
        t.Fatalf("positive direct asset route broken, HTTP %d %q",direct.Code,direct.Body.String())
    }
    t.Log("PASS AUDIT-007 P6 symlink components fail closed and genuine asset stays accessible")
}

func TestAudit007P6ExternalSymlinkAndDirectoryBoundary(t *testing.T) {
    root := fixture(t)
    outside := t.TempDir()
    audit007P6Write(t,filepath.Join(outside,"secret.txt"),audit007P6OutsideCanary)
    if err := os.Symlink(outside,filepath.Join(root,"escape-dir")); err != nil {t.Fatal(err)}
    if err := os.Symlink(filepath.Join(outside,"secret.txt"),filepath.Join(root,"escape.txt")); err != nil {t.Fatal(err)}
    s := audit007P6Server(t,root)
    for _,p := range []string{"/escape-dir/secret.txt","/escape.txt"} {
        res := audit007P6HTTP(s,p)
        if res.Code != http.StatusNotFound || strings.Contains(res.Body.String(),audit007P6OutsideCanary) {
            t.Fatalf("outside symlink exposed via %s, HTTP %d %q",p,res.Code,res.Body.String())
        }
    }
    t.Log("PASS AUDIT-007 P6 symlink outside root still blocked")
}

func TestAudit007P6NestedIndexAndHeadPreserved(t *testing.T) {
    root:=fixture(t)
    if err:=os.Mkdir(filepath.Join(root,"manual"),0700); err!=nil {t.Fatal(err)}
    audit007P6Write(t,filepath.Join(root,"manual","index.html"),"NESTED_INDEX_POSITIVE")
    s:=audit007P6Server(t,root)
    for _,p:=range []string{"/manual","/manual/"} {
        res:=audit007P6HTTP(s,p)
        if res.Code != 200 || strings.TrimSpace(res.Body.String())!="NESTED_INDEX_POSITIVE" {
            t.Fatalf("nested index %q no longer works: HTTP %d %q",p,res.Code,res.Body.String())
        }
    }
    req:=httptest.NewRequest(http.MethodHead,"http://127.0.0.1/manual/",nil)
    res:=httptest.NewRecorder();s.ServeHTTP(res,req)
    if res.Code!=200 || res.Body.Len()!=0 || res.Header().Get("Content-Length")!="21" {
        t.Fatalf("HEAD/length semantics lost: %d body=%q length=%q",
           res.Code,res.Body.String(),res.Header().Get("Content-Length"))
    }
    t.Log("PASS AUDIT-007 P6 GET nested index and HEAD response preserved")
}

// Source contract supplements the runtime reproducer. Never validate a path,
// return its string and then independently os.Open(string) it: a concurrent
// rename/symlink swap can invalidate that earlier validation. AST is not a
// substitute for the actual HTTP/FD-root tests above.
func TestAudit007P6NoPathCheckThenIndependentOSOpen(t *testing.T) {
    astFile,err:=parser.ParseFile(token.NewFileSet(),"server.go",nil,0)
    if err!=nil {t.Fatal(err)}
    foundHandler:=false
    for _,decl:=range astFile.Decls {
        fn,ok:=decl.(*ast.FuncDecl)
        if !ok||fn.Name.Name!="ServeHTTP" {continue}
        foundHandler=true
        ast.Inspect(fn.Body,func(n ast.Node) bool {
            call,ok:=n.(*ast.CallExpr);if !ok{return true}
            sel,ok:=call.Fun.(*ast.SelectorExpr);if !ok{return true}
            pkg,ok:=sel.X.(*ast.Ident)
            if ok&&pkg.Name=="os"&&sel.Sel.Name=="Open" {
                t.Errorf("unsafe path-based os.Open in HTTP handler after path validation; use fd-confined openat")
            }
            return true
        })
    }
    if !foundHandler {t.Fatal("ServeHTTP not found; cannot certify static boundary")}
    t.Log("PASS AUDIT-007 P6 no separate unchecked pathname open after resolution")
}
