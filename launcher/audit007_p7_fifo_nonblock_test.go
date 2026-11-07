package main

import (
    "net/http"
    "net/http/httptest"
    "os"
    "path/filepath"
    "strings"
    "syscall"
    "testing"
    "time"
)

// This file is frozen before changing the production static server. A FIFO
// is not a regular file; blocking in openat before f.Stat can hang an HTTP
// worker if a local actor can place a FIFO in the served static asset tree.
func audit007P7Handle(t *testing.T, server *staticServer, path string) *httptest.ResponseRecorder {
    t.Helper()
    done:=make(chan *httptest.ResponseRecorder,1)
    go func(){
        result:=httptest.NewRecorder()
        server.ServeHTTP(result,httptest.NewRequest(http.MethodGet,"http://127.0.0.1"+path,nil))
        done<-result
    }()
    select {
    case res:=<-done:
        return res
    case <-time.After(1200*time.Millisecond):
        t.Fatalf("AUDIT-007 P7 BLOCKED: static HTTP worker hung while opening special FIFO %q before validating file type",path)
    }
    return nil
}

func audit007P7Server(t *testing.T, root string) *staticServer {
    t.Helper()
    s,err:=newStaticServer(root)
    if err!=nil {t.Fatal(err)}
    t.Cleanup(func(){ if closer,ok:=interface{}(s).(interface{ Close() error });ok{_ = closer.Close()} })
    return s
}

func TestAudit007P7DirectFIFORefusedWithoutBlocking(t *testing.T){
    root:=fixture(t)
    if err:=syscall.Mkfifo(filepath.Join(root,"stalled.txt"),0600);err!=nil{t.Fatal(err)}
    s:=audit007P7Server(t,root)
    res:=audit007P7Handle(t,s,"/stalled.txt")
    if res.Code!=http.StatusNotFound {
        t.Fatalf("nonregular FIFO must not become a served resource; got HTTP %d %q",res.Code,res.Body.String())
    }
    res=audit007P7Handle(t,s,"/app.js")
    if res.Code!=http.StatusOK || !strings.Contains(res.Body.String(),"console.log('ok')") {
        t.Fatalf("safe static asset unavailable after FIFO refusal: HTTP %d %q",res.Code,res.Body.String())
    }
    t.Log("PASS AUDIT-007 P7 FIFO resource denies without blocking and normal asset remains served")
}

func TestAudit007P7DirectoryIndexFIFORefusedWithoutBlocking(t *testing.T){
    root:=fixture(t)
    directory:=filepath.Join(root,"special")
    if err:=os.Mkdir(directory,0700);err!=nil{t.Fatal(err)}
    if err:=syscall.Mkfifo(filepath.Join(directory,"index.html"),0600);err!=nil{t.Fatal(err)}
    s:=audit007P7Server(t,root)
    res:=audit007P7Handle(t,s,"/special/")
    if res.Code!=http.StatusNotFound {
        t.Fatalf("nonregular FIFO directory index must not become a served resource; got HTTP %d %q",res.Code,res.Body.String())
    }
    res=audit007P7Handle(t,s,"/")
    if res.Code!=http.StatusOK || !strings.Contains(res.Body.String(),"<html>ok</html>") {
        t.Fatalf("positive original root index broken after FIFO denial: HTTP %d %q",res.Code,res.Body.String())
    }
    t.Log("PASS AUDIT-007 P7 FIFO index denies without blocking and valid root index remains served")
}

func TestAudit007P7RegularNestedAndHEADStillWork(t *testing.T) {
    root:=fixture(t)
    nested:=filepath.Join(root,"nested")
    if err:=os.Mkdir(nested,0700);err!=nil{t.Fatal(err)}
    if err:=os.WriteFile(filepath.Join(nested,"regular.txt"),[]byte("REGULAR_P7_POSITIVE"),0600);err!=nil{t.Fatal(err)}
    s:=audit007P7Server(t,root)
    res:=audit007P7Handle(t,s,"/nested/regular.txt")
    if res.Code!=http.StatusOK || strings.TrimSpace(res.Body.String())!="REGULAR_P7_POSITIVE"{
        t.Fatalf("legitimate nested file unavailable: HTTP %d %q",res.Code,res.Body.String())
    }
    response:=httptest.NewRecorder()
    s.ServeHTTP(response,httptest.NewRequest(http.MethodHead,"http://127.0.0.1/nested/regular.txt",nil))
    if response.Code!=http.StatusOK || response.Body.Len()!=0 ||
       response.Header().Get("Content-Length")!="19" {
        t.Fatalf("HEAD regular file contract changed: code=%d length=%q body=%q",
            response.Code,response.Header().Get("Content-Length"),response.Body.String())
    }
    t.Log("PASS AUDIT-007 P7 nonblocking FD flags do not alter real regular file/HEAD")
}
