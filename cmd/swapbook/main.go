// Command swapbook serves an HTMX-aware component gallery in front of a
// running target app.
//
//	swapbook --target :8080
//
// Then open http://localhost:7007/__sb/.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"runtime/debug"

	"github.com/Aejkatappaja/swapbook/internal/server"
)

//go:embed ui/*
var uiFS embed.FS

// version is stamped at build time via -ldflags "-X main.version=..." (release
// builds). Left as "dev" otherwise.
var version = "dev"

// resolvedVersion prefers the ldflags value, then falls back to the module
// version recorded by the Go toolchain, so "go install ...@v0.1.0" also reports
// a real version instead of "dev".
func resolvedVersion() string {
	if version != "dev" {
		return version
	}
	if bi, ok := debug.ReadBuildInfo(); ok {
		if v := bi.Main.Version; v != "" && v != "(devel)" {
			return v
		}
	}
	return version
}

func main() {
	target := flag.String("target", ":8080", "target app address (host:port or URL)")
	port := flag.String("port", "7007", "port to serve the Swapbook UI on")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("swapbook", resolvedVersion())
		return
	}

	ui, err := loadUI()
	if err != nil {
		log.Fatalf("load ui: %v", err)
	}
	srv, err := server.New(*target, ui)
	if err != nil {
		log.Fatalf("bad target: %v", err)
	}

	addr := ":" + *port
	fmt.Printf("swapbook → target %s\n", *target)
	fmt.Printf("open      http://localhost:%s%s/\n", *port, server.Overlay)
	log.Fatal(http.ListenAndServe(addr, srv.Handler()))
}

func loadUI() (server.UI, error) {
	read := func(name string) ([]byte, error) { return uiFS.ReadFile("ui/" + name) }
	index, err := read("index.html")
	if err != nil {
		return server.UI{}, err
	}
	inspector, err := read("inspector.js")
	if err != nil {
		return server.UI{}, err
	}
	assets := map[string][]byte{}
	entries, _ := fs.ReadDir(uiFS, "ui")
	for _, e := range entries {
		if e.IsDir() || e.Name() == "index.html" || e.Name() == "inspector.js" {
			continue
		}
		b, err := read(e.Name())
		if err != nil {
			return server.UI{}, err
		}
		assets[e.Name()] = b
	}
	return server.UI{Index: index, Inspector: inspector, Assets: assets}, nil
}
