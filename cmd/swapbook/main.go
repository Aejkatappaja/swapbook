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
	"net"
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
	host := flag.String("host", "127.0.0.1", "address to listen on; pass 0.0.0.0 to reach the workbench from another device")
	showVersion := flag.Bool("version", false, "print version and exit")
	insecure := flag.Bool("insecure", false, "skip TLS certificate verification for the target, for a dev app behind a self-signed certificate")
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
	srv, err := server.New(*target, ui, server.Options{Headers: headers, Insecure: *insecure})
	if err != nil {
		log.Fatalf("bad target: %v", err)
	}

	addr := net.JoinHostPort(strings.Trim(*host, "[]"), *port)
	fmt.Printf("swapbook → target %s\n", *target)
	fmt.Printf("open      http://%s%s/\n", openHost(*host, *port), server.Overlay)
	if len(headers) > 0 {
		fmt.Printf("auth      injecting %d header(s) into target requests (live/safe mode)\n", len(headers))
	}
	if note := tlsNote(*target, *insecure); note != "" {
		fmt.Println(note)
	}
	if note := hostNote(*host, addr); note != "" {
		fmt.Println(note)
	}
	log.Fatal(http.ListenAndServe(addr, srv.Handler()))
}

// openHost is the authority to print for the browser. A bind to one interface
// is only reachable at that address, so printing localhost there would hand the
// user a URL their browser refuses.
func openHost(host, port string) string {
	if loopback(host) || host == "" || host == "0.0.0.0" || host == "::" {
		return "localhost:" + port
	}
	return net.JoinHostPort(strings.Trim(host, "[]"), port)
}

// hostNote says so when the workbench is listening beyond this machine, and
// returns "" when it is not. Worth saying out loud: it strips the target's
// framing headers and forwards any --header credential, so who can reach it is
// not a detail.
func hostNote(host, addr string) string {
	if loopback(host) {
		return ""
	}
	return "host      listening on " + addr + ", reachable from your network"
}

// loopback reports whether host keeps the workbench on this machine. ParseIP
// covers 127.0.0.0/8 and ::1; the name and the bracketed IPv6 form have to be
// handled here, and both are plausible things to type at a tool that prints a
// localhost URL on startup.
func loopback(host string) bool {
	host = strings.Trim(host, "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// tlsNote reports what --insecure actually did, or "" when there is nothing to
// say. Normalize defaults a schemeless target to http, where skipping
// certificate verification is a no-op: saying it was disabled would confirm a
// mental model that is about to cost the user a confusing failure.
func tlsNote(target string, insecure bool) string {
	if !insecure {
		return ""
	}
	u, err := server.Normalize(target)
	if err != nil || u.Scheme == "https" {
		return "tls       certificate verification disabled for the target"
	}
	return "tls       --insecure ignored: " + u.String() + " is not https"
}

// runCheck handles `swapbook check`: a headless render smoke over every story,
// exiting 1 on any failure (or a setup error) so CI can gate on it.
func runCheck(args []string) {
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	target := fs.String("target", ":8080", "target app address (host:port or URL)")
	insecure := fs.Bool("insecure", false, "skip TLS certificate verification for the target")
	fs.Parse(args)
	if note := tlsNote(*target, *insecure); note != "" {
		fmt.Println(note)
	}
	failed, err := check.Run(*target, *insecure, os.Stdout)
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
