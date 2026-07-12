// Target app for the Playwright probe E2E: one full-page story per hypermedia
// library (Turbo, Unpoly, Datastar), each loading the real vendored library and
// exposing a GET trigger (mocked -> should reroute) plus a POST trigger
// (unmocked -> should be blocked in mock mode). The Swapbook binary runs in
// front of this; the specs drive the triggers and assert the probe's behavior.
package main

import (
	"embed"
	"flag"
	"log"
	"net/http"
	"strings"

	adapter "github.com/Aejkatappaja/swapbook/adapters/go"
)

//go:embed vendor/*
var vendor embed.FS

// Each preview is a full HTML document (so Swapbook injects only the inspector,
// not htmx) that loads one real library and wires a GET and a POST trigger.
const turboPage = `<!doctype html>
<html><head><meta charset="utf-8"><script src="/static/turbo.js"></script></head>
<body>
<turbo-frame id="tf"><a id="go-get" href="/rows">load rows</a></turbo-frame>
<form id="frm" action="/save" method="post"><button id="go-post">save</button></form>
</body></html>`

const unpolyPage = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/static/unpoly.css"><script src="/static/unpoly.js"></script></head>
<body>
<div id="target">initial</div>
<a id="go-get" up-follow up-target="#target" href="/rows">load rows</a>
<form id="frm" up-submit up-target="#target" action="/save" method="post"><button id="go-post">save</button></form>
</body></html>`

const datastarPage = `<!doctype html>
<html><head><meta charset="utf-8"><script type="module" src="/static/datastar.js"></script></head>
<body data-signals="{}">
<div id="target"></div>
<button id="go-get" data-on-click="@get('/rows')">load rows</button>
<button id="go-post" data-on-click="@post('/save')">save</button>
</body></html>`

func registry() *adapter.Registry {
	reg := adapter.New()
	// A mocked GET (should reroute) and an unmocked POST (should be blocked).
	story := func(id string, page string) {
		reg.Register(id,
			adapter.Var("default", adapter.HTML(page)).
				Mock("GET /rows", adapter.HTML(`<turbo-frame id="tf"><div id="target">ROW</div></turbo-frame>`)),
		)
	}
	story("turbo", turboPage)
	story("unpoly", unpolyPage)
	story("datastar", datastarPage)
	return reg
}

func main() {
	port := flag.String("port", "8402", "port to listen on")
	flag.Parse()

	reg := registry()
	mux := http.NewServeMux()
	mux.Handle(adapter.MountPath+"/", http.StripPrefix(adapter.MountPath, reg.Handler()))
	mux.HandleFunc("/static/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/static/")
		b, err := vendor.ReadFile("vendor/" + name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(name, ".css") {
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		} else {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		}
		w.Write(b)
	})
	addr := ":" + *port
	log.Println("e2e target on " + addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
