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
	"os"
	"runtime/debug"
	"strings"

	"github.com/Aejkatappaja/swapbook/internal/check"
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

// headerFlags collects repeatable --header values ("Name: value").
type headerFlags []string

func (h *headerFlags) String() string { return strings.Join(*h, ", ") }
func (h *headerFlags) Set(v string) error {
	if !strings.Contains(v, ":") {
		return fmt.Errorf("expected \"Name: value\", got %q", v)
	}
	*h = append(*h, v)
	return nil
}

func main() {
	// `swapbook check --target ...` is a headless CI gate: render every story and
	// exit non-zero on failure. Dispatched before the default server flags.
	if len(os.Args) > 1 && os.Args[1] == "check" {
		runCheck(os.Args[2:])
		return
	}

	target := flag.String("target", ":8080", "target app address (host:port or URL)")
	port := flag.String("port", "7007", "port to serve the Swapbook UI on")
	showVersion := flag.Bool("version", false, "print version and exit")
	var headers headerFlags
	flag.Var(&headers, "header", "header injected into every request to the target, e.g. --header 'Cookie: session=...' (repeatable) so components behind auth render in live mode")
	flag.Parse()

	if *showVersion {
		fmt.Println("swapbook", resolvedVersion())
		return
	}

	ui, err := loadUI()
	if err != nil {
		log.Fatalf("load ui: %v", err)
	}
	srv, err := server.New(*target, ui, headers...)
	if err != nil {
		log.Fatalf("bad target: %v", err)
	}

	addr := ":" + *port
	fmt.Printf("swapbook → target %s\n", *target)
	fmt.Printf("open      http://localhost:%s%s/\n", *port, server.Overlay)
	if len(headers) > 0 {
		fmt.Printf("auth      injecting %d header(s) into target requests (live/safe mode)\n", len(headers))
	}
	log.Fatal(http.ListenAndServe(addr, srv.Handler()))
}

// runCheck handles `swapbook check`: a headless render smoke over every story,
// exiting 1 on any failure (or a setup error) so CI can gate on it.
func runCheck(args []string) {
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	target := fs.String("target", ":8080", "target app address (host:port or URL)")
	fs.Parse(args)
	failed, err := check.Run(*target, os.Stdout)
	if err != nil {
		fmt.Fprintln(os.Stderr, "swapbook check:", err)
		os.Exit(1)
	}
	if failed > 0 {
		os.Exit(1)
	}
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
