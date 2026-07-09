package adapter

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
)

// MountPath is where the adapter endpoints live on the target app.
const MountPath = "/_swapbook"

// manifest is the wire format Swapbook reads to build its gallery.
type manifest struct {
	HTMXSrc string      `json:"htmxSrc"`
	CSSSrc  string      `json:"cssSrc"`
	JSSrc   string      `json:"jsSrc"`
	Stories []storyMeta `json:"stories"`
}

type storyMeta struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Group    string        `json:"group"`
	Docs     string        `json:"docs,omitempty"`
	Variants []variantMeta `json:"variants"`
}

type variantMeta struct {
	Name     string    `json:"name"`
	Controls []Control `json:"controls,omitempty"`
	Docs     string    `json:"docs,omitempty"`
}

// MockMeta is the wire shape of a variant's mocked route, shared with the
// Swapbook binary so it decodes into the same type.
type MockMeta struct {
	Verb  string `json:"verb"`
	Path  string `json:"path"`
	Index int    `json:"index"`
}

// Handler returns an http.Handler exposing the manifest and preview endpoints.
// Mount it on the app router at MountPath, e.g.:
//
//	mux.Handle(adapter.MountPath+"/", http.StripPrefix(adapter.MountPath, reg.Handler()))
func (r *Registry) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /manifest.json", r.serveManifest)
	mux.HandleFunc("GET /preview/{id}/{variant}", r.servePreview)
	mux.HandleFunc("GET /mocks/{id}/{variant}", r.serveMocks)
	mux.HandleFunc("/mock/{id}/{variant}/{index}", r.serveMock) // any method
	return mux
}

// findVariant returns the variant with the given story id and variant name.
func (r *Registry) findVariant(id, variant string) *Variant {
	for i := range r.stories {
		if r.stories[i].ID != id {
			continue
		}
		for j := range r.stories[i].Variants {
			if r.stories[i].Variants[j].Name == variant {
				return &r.stories[i].Variants[j]
			}
		}
	}
	return nil
}

func (r *Registry) serveManifest(w http.ResponseWriter, _ *http.Request) {
	m := manifest{HTMXSrc: r.HTMXSrc, CSSSrc: r.CSSSrc, JSSrc: r.JSSrc}
	for _, s := range r.stories {
		vs := make([]variantMeta, len(s.Variants))
		for i, v := range s.Variants {
			vs[i] = variantMeta{Name: v.Name, Controls: v.Controls, Docs: v.Docs}
		}
		m.Stories = append(m.Stories, storyMeta{
			ID: s.ID, Name: s.Name, Group: s.Group, Docs: s.Docs, Variants: vs,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(m)
}

func (r *Registry) servePreview(w http.ResponseWriter, req *http.Request) {
	v := r.findVariant(req.PathValue("id"), req.PathValue("variant"))
	if v == nil {
		http.NotFound(w, req)
		return
	}
	comp := v.Component
	if v.Build != nil {
		comp = v.Build(coerceArgs(v.Controls, req.URL.Query()))
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := comp.Render(req.Context(), w); err != nil {
		http.Error(w, "render: "+err.Error(), http.StatusInternalServerError)
	}
}

// coerceArgs turns query values into typed Args using the control schema,
// falling back to each control's default when a value is absent.
func coerceArgs(controls []Control, q url.Values) Args {
	a := Args{}
	for _, c := range controls {
		// absent -> default; present-but-empty is a real value (e.g. cleared text)
		if !q.Has(c.Name) {
			a[c.Name] = c.Default
			continue
		}
		raw := q.Get(c.Name)
		switch c.Type {
		case "number":
			if n, err := strconv.ParseFloat(raw, 64); err == nil {
				a[c.Name] = n
			} else {
				a[c.Name] = c.Default
			}
		case "bool":
			a[c.Name] = parseBool(raw)
		default:
			a[c.Name] = raw
		}
	}
	return a
}

// serveMocks lists the mocked routes for a variant so Swapbook can wire the
// preview frame to intercept them.
func (r *Registry) serveMocks(w http.ResponseWriter, req *http.Request) {
	v := r.findVariant(req.PathValue("id"), req.PathValue("variant"))
	if v == nil {
		http.NotFound(w, req)
		return
	}
	out := make([]MockMeta, len(v.Mocks))
	for i, m := range v.Mocks {
		out[i] = MockMeta{Verb: m.Verb, Path: m.Path, Index: i}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// serveMock renders a single mock component by index.
func (r *Registry) serveMock(w http.ResponseWriter, req *http.Request) {
	v := r.findVariant(req.PathValue("id"), req.PathValue("variant"))
	idx, err := strconv.Atoi(req.PathValue("index"))
	if v == nil || err != nil || idx < 0 || idx >= len(v.Mocks) {
		http.NotFound(w, req)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := v.Mocks[idx].Component.Render(req.Context(), w); err != nil {
		http.Error(w, "render: "+err.Error(), http.StatusInternalServerError)
	}
}
