// Target app for the Playwright probe E2E: one full-page story per hypermedia
// library (Turbo, Unpoly, Datastar), each loading the real vendored library and
// exposing a GET trigger (mocked -> should reroute) plus a POST trigger
// (unmocked -> should be blocked in mock mode). The Swapbook binary runs in
// front of this; the specs drive the triggers and assert the probe's behavior.
package main

import (
	"embed"
	"flag"
	"fmt"
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

// Opens an EventSource after load (so the inspector's stream wrap is in place)
// and shows the latest event. Full-page doc, so only the inspector is injected.
const ssePage = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
<div id="log">waiting</div>
<script>
  addEventListener("load", function () {
    var es = new EventSource("/sse");
    es.addEventListener("message", function (e) { document.getElementById("log").textContent = e.data; });
  });
</script>
</body></html>`

// A minimal page for the play runner: clicking #go updates #out. No library
// needed, so the test exercises the runner + command channel in a real browser.
const playPage = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
<button id="go" onclick="document.getElementById('out').textContent = 'clicked'">go</button>
<div id="out">idle</div>
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
	reg.Register("sse", adapter.Var("default", adapter.HTML(ssePage)))
	reg.Register("play", adapter.Var("default", adapter.HTML(playPage)))
	return reg
}

func main() {
	port := flag.String("port", "8402", "port to listen on")
	flag.Parse()

	reg := registry()
	mux := http.NewServeMux()
	mux.Handle(adapter.MountPath+"/", http.StripPrefix(adapter.MountPath, reg.Handler()))
	// A short Server-Sent Events stream: two events then close. Swapbook proxies
	// it through (FlushInterval -1), and the inspector's stream lens logs it.
	mux.HandleFunc("/sse", func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "no flush", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		for i := 1; i <= 2; i++ {
			fmt.Fprintf(w, "data: tick %d\n\n", i)
			fl.Flush()
		}
	})
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
