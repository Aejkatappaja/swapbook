// Reference Swapbook demo for Go: the shared demo design system, rendered with
// stdlib html/template (no codegen, so `go run ./examples/go` just works). The
// go-gym project is the templ showcase; this is the self-contained example.
package main

import (
	"context"
	"flag"
	"html/template"
	"io"
	"log"
	"net/http"
	"os"

	adapter "github.com/Aejkatappaja/swapbook/adapters/go"
)

func tmpl(s string) *template.Template { return template.Must(template.New("c").Parse(s)) }

// render wraps an html/template execution as an adapter.Renderer.
func render(t *template.Template, data any) adapter.Renderer {
	return adapter.RenderFunc(func(_ context.Context, w io.Writer) error { return t.Execute(w, data) })
}

var (
	btnT   = tmpl(`<button class="btn btn-{{.Variant}} btn-{{.Size}}"{{if .Disabled}} disabled{{end}}>{{.Label}}</button>`)
	badgeT = tmpl(`<span class="badge badge-{{.Status}}">{{.Label}}</span>`)
	alertT = tmpl(`<div class="alert alert-{{.Kind}}">{{.Msg}}</div>`)
	cardT  = tmpl(`<div class="card"><div class="card-head"><strong>{{.Title}}</strong><span class="badge badge-{{.Status}}">{{.Status}}</span></div>{{if .Reviews}}<p class="muted">{{.Reviews}} review{{if ne .Reviews 1}}s{{end}}</p>{{end}}</div>`)
	fieldT = tmpl(`<div class="field{{if .Error}} error{{end}}"><label>{{.Label}}</label><input value="{{.Value}}" placeholder="{{.Label}}"{{if .Disabled}} disabled{{end}}>{{if .Error}}<span class="err">{{.Error}}</span>{{end}}</div>`)
	emptyT = tmpl(`<div class="empty"><div class="mark">📭</div><h4>{{.Title}}</h4><div>{{.Hint}}</div></div>`)
	tableT = tmpl(`<table class="ds"><thead><tr><th>name</th><th>role</th><th>status</th></tr></thead><tbody>{{range .}}<tr><td>{{.Name}}</td><td>{{.Role}}</td><td><span class="badge badge-{{.Status}}">{{.Status}}</span></td></tr>{{end}}</tbody></table>`)
	todoT  = tmpl(`<div class="todo"><ul id="rows"><li>Write the launch post</li><li>Record the demo gif</li></ul><button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>`)
	rowT   = tmpl(`<li>New task</li>`)
	// The response-targets extension lets htmx swap on an error status; the
	// mock for POST /ds/save returns 422, so hx-target-422 renders the error body.
	saveFormT = tmpl(`<script src="https://cdn.jsdelivr.net/npm/htmx-ext-response-targets@2.0.3"></script>
<div hx-ext="response-targets" class="field">
  <form hx-post="/ds/save" hx-target="#save-out" hx-target-422="#save-out" hx-swap="innerHTML">
    <label>Email</label>
    <input name="email" value="not-an-email">
    <button class="btn btn-primary">Save</button>
  </form>
  <div id="save-out"></div>
</div>`)
	saveErrT = tmpl(`<div class="alert alert-error">Enter a valid email</div>`)
	phanT    = tmpl(`<script src="https://cdn.jsdelivr.net/npm/@aejkatappaja/phantom-ui/dist/phantom-ui.cdn.js"></script><phantom-ui{{if .Loading}} loading{{end}} animation="{{.Animation}}" style="display:block;max-width:420px"><div class="card"><div class="card-head"><strong>Ada Lovelace</strong></div><p class="muted">First programmer, probably.</p></div></phantom-ui>`)
)

type row struct{ Name, Role, Status string }

func btn(label, variant, size string, disabled bool) adapter.Renderer {
	return render(btnT, map[string]any{"Label": label, "Variant": variant, "Size": size, "Disabled": disabled})
}
func card(title, status string, reviews int) adapter.Renderer {
	return render(cardT, map[string]any{"Title": title, "Status": status, "Reviews": reviews})
}
func phantom(loading bool, anim string) adapter.Renderer {
	return render(phanT, map[string]any{"Loading": loading, "Animation": anim})
}

func registry() *adapter.Registry {
	reg := adapter.New()
	reg.CSSSrc = "/static/ds.css"

	reg.RegisterIn("actions", "Button",
		adapter.Var("primary", btn("Save", "primary", "md", false)),
		adapter.Var("secondary", btn("Cancel", "secondary", "md", false)),
		adapter.Var("danger", btn("Delete", "danger", "md", false)),
		adapter.Var("disabled", btn("Save", "primary", "md", true)),
		adapter.VarC("controls", []adapter.Control{
			{Name: "label", Type: "text", Default: "Save"},
			{Name: "variant", Type: "select", Default: "primary", Options: []string{"primary", "secondary", "danger"}},
			{Name: "size", Type: "select", Default: "md", Options: []string{"sm", "md", "lg"}},
			{Name: "disabled", Type: "bool", Default: false},
		}, func(a adapter.Args) adapter.Renderer {
			return btn(a.String("label"), a.String("variant"), a.String("size"), a.Bool("disabled"))
		}),
	)
	reg.DocStory("Button", "The button primitive. `variant` and `size` are props, not classes you type.")

	reg.RegisterIn("data-display", "Badge",
		adapter.Var("open", render(badgeT, map[string]any{"Status": "open", "Label": "open"})),
		adapter.Var("merged", render(badgeT, map[string]any{"Status": "merged", "Label": "merged"})),
		adapter.Var("closed", render(badgeT, map[string]any{"Status": "closed", "Label": "closed"})),
		adapter.VarC("controls", []adapter.Control{
			{Name: "status", Type: "select", Default: "open", Options: []string{"open", "merged", "closed"}},
			{Name: "label", Type: "text", Default: "open"},
		}, func(a adapter.Args) adapter.Renderer {
			return render(badgeT, map[string]any{"Status": a.String("status"), "Label": a.String("label")})
		}),
	)

	reg.RegisterIn("feedback", "Alert",
		adapter.Var("info", render(alertT, map[string]any{"Kind": "info", "Msg": "A new version is available."})),
		adapter.Var("success", render(alertT, map[string]any{"Kind": "success", "Msg": "Saved successfully."})),
		adapter.Var("warning", render(alertT, map[string]any{"Kind": "warning", "Msg": "Your trial ends in 3 days."})),
		adapter.Var("error", render(alertT, map[string]any{"Kind": "error", "Msg": "Could not reach the server."})),
		adapter.VarC("controls", []adapter.Control{
			{Name: "kind", Type: "select", Default: "info", Options: []string{"info", "success", "warning", "error"}},
			{Name: "message", Type: "text", Default: "Heads up."},
		}, func(a adapter.Args) adapter.Renderer {
			return render(alertT, map[string]any{"Kind": a.String("kind"), "Msg": a.String("message")})
		}),
	)

	reg.RegisterIn("data-display", "PR Card",
		adapter.Var("open", card("Add dark mode", "open", 0)),
		adapter.Var("with-reviews", card("Refactor router", "merged", 3)),
		adapter.VarC("controls", []adapter.Control{
			{Name: "title", Type: "text", Default: "Add dark mode"},
			{Name: "status", Type: "select", Default: "open", Options: []string{"open", "merged", "closed"}},
			{Name: "reviews", Type: "number", Default: 0},
		}, func(a adapter.Args) adapter.Renderer {
			return card(a.String("title"), a.String("status"), a.Int("reviews"))
		}),
	)

	reg.RegisterIn("forms", "Field",
		adapter.Var("default", render(fieldT, map[string]any{"Label": "Email", "Value": ""})),
		adapter.Var("error", render(fieldT, map[string]any{"Label": "Email", "Value": "not-an-email", "Error": "Enter a valid email"})),
		adapter.Var("disabled", render(fieldT, map[string]any{"Label": "Email", "Value": "you@example.com", "Disabled": true})),
		adapter.VarC("controls", []adapter.Control{
			{Name: "label", Type: "text", Default: "Email"},
			{Name: "value", Type: "text", Default: ""},
			{Name: "error", Type: "text", Default: ""},
			{Name: "disabled", Type: "bool", Default: false},
		}, func(a adapter.Args) adapter.Renderer {
			return render(fieldT, map[string]any{"Label": a.String("label"), "Value": a.String("value"), "Error": a.String("error"), "Disabled": a.Bool("disabled")})
		}),
	)

	reg.RegisterIn("feedback", "Empty state",
		adapter.VarC("default", []adapter.Control{
			{Name: "title", Type: "text", Default: "No workouts yet"},
			{Name: "hint", Type: "text", Default: "Create your first one to get started."},
		}, func(a adapter.Args) adapter.Renderer {
			return render(emptyT, map[string]any{"Title": a.String("title"), "Hint": a.String("hint")})
		}),
	)

	reg.RegisterIn("data-display", "Table",
		adapter.Var("default", render(tableT, []row{
			{"Ada Lovelace", "Owner", "open"},
			{"Alan Turing", "Maintainer", "merged"},
			{"Grace Hopper", "Contributor", "closed"},
		})),
	)

	reg.RegisterIn("interactive", "Todo list",
		adapter.Var("default", render(todoT, nil)).
			Mock("GET /ds/row", render(rowT, nil)).
			Doc("Click **+ add row**: the mock returns a new `<li>` htmx appends. Watch the swap-target flash in the inspector."),
	)

	reg.RegisterIn("interactive", "Form validation",
		adapter.Var("invalid", render(saveFormT, nil)).
			MockStatus("POST /ds/save", 422, render(saveErrT, nil)).
			Doc("Click **Save**: the mock replies `422`, so `hx-target-422` swaps in the error alert. The inspector logs the request with its failing status."),
	)

	reg.RegisterIn("web components", "Skeleton (phantom-ui)",
		adapter.Var("loading", phantom(true, "shimmer")),
		adapter.Var("loaded", phantom(false, "shimmer")),
		adapter.VarC("controls", []adapter.Control{
			{Name: "loading", Type: "bool", Default: true},
			{Name: "animation", Type: "select", Default: "shimmer", Options: []string{"shimmer", "pulse", "breathe", "solid"}},
		}, func(a adapter.Args) adapter.Renderer {
			return phantom(a.Bool("loading"), a.String("animation"))
		}),
	)
	reg.DocStory("Skeleton (phantom-ui)", "A third-party **Web Component** (`@aejkatappaja/phantom-ui`) from jsdelivr. Toggle `loading` to swap skeleton and content.")

	return reg
}

func main() {
	port := flag.String("port", "8000", "port to listen on")
	cssPath := flag.String("css", "examples/shared/ds.css", "path to the shared demo stylesheet")
	flag.Parse()

	dsCSS, err := os.ReadFile(*cssPath)
	if err != nil {
		log.Fatalf("read css %q: %v", *cssPath, err)
	}

	reg := registry()
	mux := http.NewServeMux()
	mux.Handle(adapter.MountPath+"/", http.StripPrefix(adapter.MountPath, reg.Handler()))
	mux.HandleFunc("/static/ds.css", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Write(dsCSS)
	})
	addr := ":" + *port
	log.Println("demo target on " + addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
