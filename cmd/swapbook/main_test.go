package main

import (
	"strings"
	"testing"
)

// --insecure is a no-op on a target Normalize resolved to http, which is what a
// schemeless --target :8443 becomes. Saying otherwise sends the user hunting
// for a certificate problem they do not have.
func TestTLSNote(t *testing.T) {
	for _, tc := range []struct {
		target   string
		insecure bool
		want     string
	}{
		{"https://app.localhost", true, "disabled"},
		{"localhost:8443", true, "ignored"},
		{":8443", true, "ignored"},
		{"http://localhost:8080", true, "ignored"},
		{"https://app.localhost", false, ""},
		{"localhost:8443", false, ""},
	} {
		got := tlsNote(tc.target, tc.insecure)
		if tc.want == "" {
			if got != "" {
				t.Errorf("tlsNote(%q, %v) = %q, want empty", tc.target, tc.insecure, got)
			}
			continue
		}
		if !strings.Contains(got, tc.want) {
			t.Errorf("tlsNote(%q, %v) = %q, want it to mention %q", tc.target, tc.insecure, got, tc.want)
		}
	}
}
