# Single-file Rails app demoing the Swapbook adapter: boot a minimal
# Rails::Application, render the shared demo design system through ActionView
# (inline ERB), mount the adapter at /_swapbook, serve via rackup. Same
# component set as the Go, Django and Laravel demos.
require "action_controller/railtie"
require_relative "swapbook"

# erb renders an inline ERB template through real ActionView.
def erb(tpl, locals = {})
  ActionController::Base.render(inline: tpl, locals: locals)
end

BTN = ->(a) { erb('<button class="btn btn-<%= variant %> btn-<%= size %>"<%= disabled ? " disabled" : "" %>><%= label %></button>',
  label: a["label"] || "Save", variant: a["variant"] || "primary", size: a["size"] || "md", disabled: a["disabled"] || false) }
BADGE = ->(a) { erb('<span class="badge badge-<%= status %>"><%= label %></span>', status: a["status"] || "open", label: a["label"] || "open") }
ALERT = ->(a) { erb('<div class="alert alert-<%= kind %>"><%= msg %></div>', kind: a["kind"] || "info", msg: a["message"] || "Heads up.") }
CARD = ->(a) { erb(<<~ERB.chomp, title: a["title"] || "Add dark mode", status: a["status"] || "open", reviews: (a["reviews"] || 0).to_i)
  <div class="card"><div class="card-head"><strong><%= title %></strong><span class="badge badge-<%= status %>"><%= status %></span></div><% if reviews.positive? %><p class="muted"><%= reviews %> review<%= "s" unless reviews == 1 %></p><% end %></div>
ERB
}
FIELD = ->(a) { erb(<<~ERB.chomp, label: a["label"] || "Email", value: a["value"] || "", error: a["error"] || "", disabled: a["disabled"] || false)
  <div class="field<%= error.empty? ? "" : " error" %>"><label><%= label %></label><input value="<%= value %>" placeholder="<%= label %>"<%= disabled ? " disabled" : "" %>><% unless error.empty? %><span class="err"><%= error %></span><% end %></div>
ERB
}
EMPTY = ->(a) { erb('<div class="empty"><div class="mark">📭</div><h4><%= title %></h4><div><%= hint %></div></div>',
  title: a["title"] || "No workouts yet", hint: a["hint"] || "Create your first one to get started.") }
TABLE = ->(_a) { erb(<<~ERB.chomp, rows: [["Ada Lovelace", "Owner", "open"], ["Alan Turing", "Maintainer", "merged"], ["Grace Hopper", "Contributor", "closed"]])
  <table class="ds"><thead><tr><th>name</th><th>role</th><th>status</th></tr></thead><tbody><% rows.each do |name, role, status| %><tr><td><%= name %></td><td><%= role %></td><td><span class="badge badge-<%= status %>"><%= status %></span></td></tr><% end %></tbody></table>
ERB
}
TODO = ->(_a) { '<div class="todo"><ul id="rows"><li>Write the launch post</li><li>Record the demo gif</li></ul><button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>' }
PHANTOM = ->(a) { erb('<script src="https://cdn.jsdelivr.net/npm/@aejkatappaja/phantom-ui/dist/phantom-ui.cdn.js"></script><phantom-ui<%= loading ? " loading" : "" %> animation="<%= animation %>" style="display:block;max-width:420px"><div class="card"><div class="card-head"><strong>Ada Lovelace</strong></div><p class="muted">First programmer, probably.</p></div></phantom-ui>',
  loading: a.fetch("loading", true), animation: a["animation"] || "shimmer") }

REG = Swapbook::Registry.new(css_src: "/static/ds.css")

REG.register("Button", group: "actions", docs: "The button primitive. `variant` and `size` are props, not classes you type.", variants: [
  Swapbook.variant("primary", ->(_a) { BTN.call("label" => "Save", "variant" => "primary") }),
  Swapbook.variant("secondary", ->(_a) { BTN.call("label" => "Cancel", "variant" => "secondary") }),
  Swapbook.variant("danger", ->(_a) { BTN.call("label" => "Delete", "variant" => "danger") }),
  Swapbook.variant("disabled", ->(_a) { BTN.call("label" => "Save", "disabled" => true) }),
  Swapbook.variant("controls", BTN, controls: [
    Swapbook.control("label", default: "Save"),
    Swapbook.control("variant", type: "select", default: "primary", options: %w[primary secondary danger]),
    Swapbook.control("size", type: "select", default: "md", options: %w[sm md lg]),
    Swapbook.control("disabled", type: "bool", default: false),
  ]),
])

REG.register("Badge", group: "data-display", variants: [
  Swapbook.variant("open", ->(_a) { BADGE.call("status" => "open", "label" => "open") }),
  Swapbook.variant("merged", ->(_a) { BADGE.call("status" => "merged", "label" => "merged") }),
  Swapbook.variant("closed", ->(_a) { BADGE.call("status" => "closed", "label" => "closed") }),
  Swapbook.variant("controls", BADGE, controls: [
    Swapbook.control("status", type: "select", default: "open", options: %w[open merged closed]),
    Swapbook.control("label", default: "open"),
  ]),
])

REG.register("Alert", group: "feedback", variants: [
  Swapbook.variant("info", ->(_a) { ALERT.call("kind" => "info", "message" => "A new version is available.") }),
  Swapbook.variant("success", ->(_a) { ALERT.call("kind" => "success", "message" => "Saved successfully.") }),
  Swapbook.variant("warning", ->(_a) { ALERT.call("kind" => "warning", "message" => "Your trial ends in 3 days.") }),
  Swapbook.variant("error", ->(_a) { ALERT.call("kind" => "error", "message" => "Could not reach the server.") }),
  Swapbook.variant("controls", ALERT, controls: [
    Swapbook.control("kind", type: "select", default: "info", options: %w[info success warning error]),
    Swapbook.control("message", default: "Heads up."),
  ]),
])

REG.register("PR Card", group: "data-display", variants: [
  Swapbook.variant("open", ->(_a) { CARD.call({}) }),
  Swapbook.variant("with-reviews", ->(_a) { CARD.call("title" => "Refactor router", "status" => "merged", "reviews" => 3) }),
  Swapbook.variant("controls", CARD, controls: [
    Swapbook.control("title", default: "Add dark mode"),
    Swapbook.control("status", type: "select", default: "open", options: %w[open merged closed]),
    Swapbook.control("reviews", type: "number", default: 0),
  ]),
])

REG.register("Field", group: "forms", variants: [
  Swapbook.variant("default", ->(_a) { FIELD.call("label" => "Email") }),
  Swapbook.variant("error", ->(_a) { FIELD.call("label" => "Email", "value" => "not-an-email", "error" => "Enter a valid email") }),
  Swapbook.variant("disabled", ->(_a) { FIELD.call("label" => "Email", "value" => "you@example.com", "disabled" => true) }),
  Swapbook.variant("controls", FIELD, controls: [
    Swapbook.control("label", default: "Email"),
    Swapbook.control("value", default: ""),
    Swapbook.control("error", default: ""),
    Swapbook.control("disabled", type: "bool", default: false),
  ]),
])

REG.register("Empty state", group: "feedback", variants: [
  Swapbook.variant("default", EMPTY, controls: [
    Swapbook.control("title", default: "No workouts yet"),
    Swapbook.control("hint", default: "Create your first one to get started."),
  ]),
])

REG.register("Table", group: "data-display", variants: [Swapbook.variant("default", TABLE)])

REG.register("Todo list", group: "interactive", variants: [
  Swapbook.variant("default", TODO,
    docs: "Click **+ add row**: the mock returns a new `<li>` htmx appends. Watch the swap-target flash in the inspector.",
    mocks: [Swapbook.mock("GET /ds/row", ->(_a) { "<li>New task</li>" })]),
])

REG.register("Skeleton (phantom-ui)", group: "web components", docs: "A third-party **Web Component** (`@aejkatappaja/phantom-ui`) from jsdelivr. Toggle `loading` to swap skeleton and content.", variants: [
  Swapbook.variant("loading", PHANTOM),
  Swapbook.variant("loaded", ->(_a) { PHANTOM.call("loading" => false) }),
  Swapbook.variant("controls", PHANTOM, controls: [
    Swapbook.control("loading", type: "bool", default: true),
    Swapbook.control("animation", type: "select", default: "shimmer", options: %w[shimmer pulse breathe solid]),
  ]),
])

# Serve the shared demo stylesheet (sits next to config.ru in the image).
DS_CSS = [File.join(__dir__, "ds.css"), "examples/shared/ds.css"].find { |p| File.exist?(p) }
CSS_APP = ->(_env) { [200, { "content-type" => "text/css; charset=utf-8" }, [DS_CSS ? File.read(DS_CSS) : ""]] }

class App < Rails::Application
  config.eager_load = false
  config.secret_key_base = "swapbook-demo"
  config.hosts.clear # allow any host (container)
  config.logger = Logger.new($stdout)
  routes.append do
    get "/static/ds.css", to: CSS_APP
    mount REG => "/_swapbook"
  end
end
App.initialize!

run App
