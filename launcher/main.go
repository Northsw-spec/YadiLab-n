package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

const defaultPort = 17931

func main() {
	executable, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	defaultRoot := filepath.Join(filepath.Dir(executable), "web")
	root := flag.String("root", defaultRoot, "directory containing bundled static application assets")
	port := flag.Int("port", defaultPort, "loopback TCP port")
	flag.Parse()

	if *port < 1024 || *port > 65535 {
		log.Fatalf("invalid port %d", *port)
	}
	handler, err := newStaticServer(*root)
	if err != nil {
		log.Fatal(err)
	}
	defer handler.Close() // close pinned static-root descriptor after HTTP shutdown

	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(*port))
	listener, err := net.Listen("tcp4", address)
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()

	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5_000_000_000,
		IdleTimeout:       30_000_000_000,
		MaxHeaderBytes:    16 << 10,
	}
	fmt.Printf("http://127.0.0.1:%d/\n", *port)
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
