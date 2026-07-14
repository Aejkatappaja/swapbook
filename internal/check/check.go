// Package check runs a headless render smoke over a target's Swapbook stories,
// for use in CI. It fetches the manifest and requests every story/variant's
// preview, reporting any that fail to render. No browser is needed; this is a
// pure-HTTP gate (render + reachability), a precursor to visual regression.
package check

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	adapter "github.com/Aejkatappaja/swapbook/adapters/go"
	"github.com/Aejkatappaja/swapbook/internal/server"
)

type manifest struct {
	Stories []struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Variants []struct {
			Name string `json:"name"`
		} `json:"variants"`
	} `json:"stories"`
}

// Run smoke-checks every story/variant preview on the target (":8080",
// "localhost:8080" or a URL), writing a per-story report to out. It returns the
// number of failures; a non-nil error is a setup failure (unreachable target,
// no adapter, malformed manifest) and should also fail the build.
func Run(target string, out io.Writer) (int, error) {
	base, err := server.Normalize(target)
	if err != nil {
		return 0, fmt.Errorf("bad target %q: %w", target, err)
	}
	root := base.String() + adapter.MountPath
	cli := &http.Client{Timeout: 15 * time.Second}

	resp, err := cli.Get(root + "/manifest.json")
	if err != nil {
		return 0, fmt.Errorf("target unreachable at %s: %w", base, err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return 0, fmt.Errorf("no adapter mounted at %s (manifest 404)", root)
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("manifest returned %d", resp.StatusCode)
	}
	var m manifest
	if err := json.Unmarshal(body, &m); err != nil {
		return 0, fmt.Errorf("manifest is not valid JSON: %w", err)
	}

	// Flatten to a work list so previews can be checked concurrently while the
	// report stays in manifest order (each result is written to its own index).
	type item struct{ id, name, variant, detail string }
	var items []item
	for _, s := range m.Stories {
		for _, v := range s.Variants {
			items = append(items, item{id: s.ID, name: s.Name, variant: v.Name})
		}
	}
	sem := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup
	for i := range items {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			items[i].detail = checkPreview(cli, root, items[i].id, items[i].variant)
		}(i)
	}
	wg.Wait()

	fmt.Fprintf(out, "swapbook check → %s\n", base)
	failed := 0
	for _, it := range items {
		if it.detail == "" {
			fmt.Fprintf(out, "  ok   %s · %s\n", it.name, it.variant)
		} else {
			failed++
			fmt.Fprintf(out, "  FAIL %s · %s: %s\n", it.name, it.variant, it.detail)
		}
	}
	fmt.Fprintf(out, "%d preview(s), %d failed\n", len(items), failed)
	return failed, nil
}

// maxConcurrent bounds in-flight preview requests so a large gallery checks fast
// without opening a connection per story.
const maxConcurrent = 8

// checkPreview requests one preview and returns "" on success or a short reason
// it failed to render (non-2xx, empty body, or unreachable).
func checkPreview(cli *http.Client, root, id, variant string) string {
	resp, err := cli.Get(root + "/preview/" + url.PathEscape(id) + "/" + url.PathEscape(variant))
	if err != nil {
		return "unreachable: " + err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Sprintf("preview %d", resp.StatusCode)
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return "empty response"
	}
	return ""
}
