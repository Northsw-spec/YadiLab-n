package main

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

type staticServer struct {
	root string
	rootDir *os.File // pinned original directory identity for all requests
}

func newStaticServer(root string) (*staticServer, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("static root is not a directory: %s", abs)
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, err
	}
	// Pin the exact directory file identity, not a mutable pathname. The
	// checked root might be renamed after server startup; never follow a
	// replacement root symlink during future HTTP requests.
	fd, err := syscall.Open(real, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	rootDir := os.NewFile(uintptr(fd), real)
	openedInfo, err := rootDir.Stat()
	if err != nil {
		rootDir.Close()
		return nil, err
	}
	if !openedInfo.IsDir() || !os.SameFile(info, openedInfo) {
		rootDir.Close()
		return nil, errors.New("static root identity changed during initialization")
	}
	return &staticServer{root: real, rootDir: rootDir}, nil
}

// Close releases the directory descriptor captured during startup.
// The HTTP server's owner closes it only after all requests have stopped.
func (s *staticServer) Close() error {
	if s == nil || s.rootDir == nil {
		return nil
	}
	return s.rootDir.Close()
}

func securityHeaders(w http.ResponseWriter) {
	// Ajv is intentionally part of the pinned browser runtime and compiles the
	// shipped/imported JSON Schemas with new Function. Keep script loading
	// same-origin-only while allowing that validator code generation.
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	w.Header().Set("Cache-Control", "no-cache")
}

func suspiciousEscapedPath(r *http.Request) bool {
	raw := strings.ToLower(r.URL.EscapedPath())
	bad := []string{"%2e", "%2f", "%5c", "%00"}
	for _, token := range bad {
		if strings.Contains(raw, token) {
			return true
		}
	}
	return false
}

// openStaticFile opens *each* path component relative to an already-opened
// directory FD with O_NOFOLLOW. Unlike a check-then-os.Open(path) sequence,
// the returned regular file descriptor is the exact file later served.
// This is a deliberate fail-closed policy: all symlink components are denied,
// including symlinks which currently lead back inside the original root.
func (s *staticServer) openStaticFile(requestPath string) (*os.File, error) {
	if s == nil || s.rootDir == nil || strings.ContainsRune(requestPath, '\x00') ||
		strings.Contains(requestPath, "\\") {
		return nil, errors.New("invalid static request path")
	}
	// r.URL.Path has already been decoded exactly once by net/http (P5).
	clean := filepath.Clean(filepath.FromSlash("/" + requestPath))
	rel := strings.TrimPrefix(clean, string(filepath.Separator))
	var components []string
	if rel != "" && rel != "." {
		components = strings.Split(rel, string(filepath.Separator))
	}

	currentFD := int(s.rootDir.Fd())
	ownedFD := -1
	// No user-supplied pathname is ever passed to os.Open after a separate
	// symlink check. Relative opens remain confined to the pinned root FD.
	defer func() {
		if ownedFD >= 0 {
			_ = syscall.Close(ownedFD)
		}
	}()
	name := "index.html"
	for i, part := range components {
		if part == "" || part == "." || part == ".." {
			return nil, errors.New("invalid static path component")
		}
		flags := syscall.O_RDONLY | syscall.O_CLOEXEC | syscall.O_NOFOLLOW
		if i != len(components)-1 {
			flags |= syscall.O_DIRECTORY
		} else {
			// Opening a FIFO for reading blocks before f.Stat can reject it.
			// Nonblocking has no effect on normal static regular-file reads.
			flags |= syscall.O_NONBLOCK
		}
		nextFD, err := syscall.Openat(currentFD, part, flags, 0)
		if err != nil {
			return nil, err
		}
		if ownedFD >= 0 {
			_ = syscall.Close(ownedFD)
		}
		ownedFD = nextFD
		currentFD = nextFD
		name = part
	}
	var st syscall.Stat_t
	if err := syscall.Fstat(currentFD, &st); err != nil {
		return nil, err
	}
	if st.Mode&syscall.S_IFMT == syscall.S_IFDIR {
		// Directory index is opened relative to that actual directory FD;
		// even a concurrent directory rename/symlink swap cannot redirect it.
		nextFD, err := syscall.Openat(currentFD, "index.html",
			syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if err != nil {
			return nil, err
		}
		if ownedFD >= 0 {
			_ = syscall.Close(ownedFD)
		}
		ownedFD = nextFD
		name = "index.html"
	}
	if ownedFD < 0 {
		return nil, errors.New("static index unavailable")
	}
	f := os.NewFile(uintptr(ownedFD), name)
	ownedFD = -1 // transfer ownership to the caller; no reopen by pathname
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if !info.Mode().IsRegular() {
		f.Close()
		return nil, errors.New("not a regular static file")
	}
	return f, nil
}

func (s *staticServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	securityHeaders(w)
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if suspiciousEscapedPath(r) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	f, err := s.openStaticFile(r.URL.Path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ct := mime.TypeByExtension(filepath.Ext(f.Name()))
	if filepath.Ext(f.Name()) == ".webmanifest" {
		ct = "application/manifest+json"
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
		w.WriteHeader(http.StatusOK)
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), io.NewSectionReader(f, 0, info.Size()))
}
