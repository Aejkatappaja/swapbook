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

// The workbench proxies the target and forwards --header credentials, so the
// default bind keeps it on this machine. Anything wider gets said out loud.
func TestHostNote(t *testing.T) {
	for _, tc := range []struct {
		host  string
		quiet bool // loopback: nothing to warn about
	}{
		{"127.0.0.1", true}, // the default
		{"localhost", true}, // the one case ParseIP cannot answer
		{"::1", true},
		{"[::1]", true},    // what you type when you remember IPv6 needs brackets
		{"0.0.0.0", false}, // the documented way out
		{"", false},        // every interface
	} {
		got := hostNote(tc.host, tc.host+":7007")
		if tc.quiet && got != "" {
			t.Errorf("hostNote(%q) = %q, want silence", tc.host, got)
		}
		if !tc.quiet && !strings.Contains(got, "reachable from your network") {
			t.Errorf("hostNote(%q) = %q, want a warning", tc.host, got)
		}
	}
}

// The printed URL has to be one the browser will accept: a bind to a single
// interface is not reachable at localhost.
func TestOpenHost(t *testing.T) {
	for _, tc := range []struct{ host, want string }{
		{"127.0.0.1", "localhost:7007"},
		{"localhost", "localhost:7007"},
		{"", "localhost:7007"},        // every interface, localhost works
		{"0.0.0.0", "localhost:7007"}, // same
		{"192.168.1.5", "192.168.1.5:7007"},
		{"[::1]", "localhost:7007"},
	} {
		if got := openHost(tc.host, "7007"); got != tc.want {
			t.Errorf("openHost(%q) = %q, want %q", tc.host, got, tc.want)
		}
	}
}
