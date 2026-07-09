# Swapbook example target in plain Ruby stdlib (webrick). No gems, no templating,
# no adapter package: it implements the Swapbook protocol (see SPEC.md) by hand.
# Renders a subset of the shared demo design system (same ds.css classes as the
# Go/Django/Rails/Laravel demos) to prove any stdlib server works.
require "webrick"
require "json"

BTN = ->(a) { %(<button class="btn btn-#{a["variant"] || "primary"} btn-#{a["size"] || "md"}"#{a["disabled"] ? " disabled" : ""}>#{a["label"] || "Save"}</button>) }
BADGE = ->(a) { %(<span class="badge badge-#{a["status"] || "open"}">#{a["label"] || "open"}</span>) }
CARD = ->(a) {
  reviews = (a["reviews"] || 0).to_i
  p = reviews.positive? ? %(<p class="muted">#{reviews} review#{reviews == 1 ? "" : "s"}</p>) : ""
  %(<div class="card"><div class="card-head"><strong>#{a["title"] || "Add dark mode"}</strong><span class="badge badge-#{a["status"] || "open"}">#{a["status"] || "open"}</span></div>#{p}</div>)
}
TODO = '<div class="todo"><ul id="rows"><li>Write the launch post</li><li>Record the demo gif</li></ul><button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>'

def ctl(name, type: "text", default: nil, options: nil)
  { name: name, type: type, default: default, options: options }.compact
end

# A subset of the shared DS: static variants, live controls, and an htmx mock.
STORIES = [
  { id: "button", name: "Button", group: "actions", docs: "The button primitive, from a raw Ruby server.", variants: [
    { name: "primary", render: ->(_a) { BTN.call("label" => "Save", "variant" => "primary") } },
    { name: "secondary", render: ->(_a) { BTN.call("label" => "Cancel", "variant" => "secondary") } },
    { name: "danger", render: ->(_a) { BTN.call("label" => "Delete", "variant" => "danger") } },
    { name: "controls", render: BTN, controls: [
      ctl("label", default: "Save"),
      ctl("variant", type: "select", default: "primary", options: %w[primary secondary danger]),
      ctl("size", type: "select", default: "md", options: %w[sm md lg]),
      ctl("disabled", type: "bool", default: false),
    ] },
  ] },
  { id: "badge", name: "Badge", group: "data-display", variants: [
    { name: "open", render: ->(_a) { BADGE.call("status" => "open", "label" => "open") } },
    { name: "merged", render: ->(_a) { BADGE.call("status" => "merged", "label" => "merged") } },
    { name: "closed", render: ->(_a) { BADGE.call("status" => "closed", "label" => "closed") } },
  ] },
  { id: "pr-card", name: "PR Card", group: "data-display", variants: [
    { name: "open", render: ->(_a) { CARD.call({}) } },
    { name: "with-reviews", render: ->(_a) { CARD.call("title" => "Refactor router", "status" => "merged", "reviews" => 3) } },
    { name: "controls", render: CARD, controls: [
      ctl("title", default: "Add dark mode"),
      ctl("status", type: "select", default: "open", options: %w[open merged closed]),
      ctl("reviews", type: "number", default: 0),
    ] },
  ] },
  { id: "todo-list", name: "Todo list", group: "interactive", variants: [
    { name: "default", render: ->(_a) { TODO },
      docs: "Click **+ add row**: the mock returns a new `<li>` htmx appends.",
      mocks: [{ verb: "GET", path: "/ds/row", render: ->(_a) { "<li>New task</li>" } }] },
  ] },
].freeze

def find(sid, vname)
  s = STORIES.find { |st| st[:id] == sid }
  s && s[:variants].find { |v| v[:name] == vname }
end

def coerce(controls, params)
  (controls || []).each_with_object({}) do |c, args|
    name = c[:name]
    unless params.key?(name) # absent -> default; present-but-empty is real
      args[name] = c[:default]
      next
    end
    raw = params[name].to_s
    args[name] =
      case c[:type]
      when "number" then (Float(raw) rescue c[:default])
      when "bool" then %w[true 1 on].include?(raw)
      else raw
      end
  end
end

def manifest
  { htmxSrc: "", cssSrc: "/static/ds.css", stories: STORIES.map { |s|
    { id: s[:id], name: s[:name], group: s[:group], docs: s[:docs] || "",
      variants: s[:variants].map { |v| { name: v[:name], controls: v[:controls] || [], docs: v[:docs] || "" } } }
  } }
end

def ds_css
  cand = [File.join(__dir__, "ds.css"), "examples/shared/ds.css"].find { |p| File.exist?(p) }
  cand ? File.read(cand) : ""
end

port = (ARGV[0] || 9092).to_i
server = WEBrick::HTTPServer.new(Port: port, Logger: WEBrick::Log.new(File::NULL), AccessLog: [])
server.mount_proc "/" do |req, res|
  p = req.path
  parts = p.split("/") # ["", "_swapbook", kind, id, variant, ...]
  if p == "/static/ds.css"
    res["Content-Type"] = "text/css; charset=utf-8"; res.body = ds_css
  elsif p == "/_swapbook/manifest.json"
    res["Content-Type"] = "application/json"; res.body = JSON.dump(manifest)
  elsif p.start_with?("/_swapbook/preview/")
    v = find(parts[3], parts[4])
    res.status = v ? 200 : 404
    res["Content-Type"] = "text/html"; res.body = v ? v[:render].call(coerce(v[:controls], req.query)) : ""
  elsif p.start_with?("/_swapbook/mocks/")
    v = find(parts[3], parts[4])
    res["Content-Type"] = "application/json"
    res.body = JSON.dump(v ? (v[:mocks] || []).each_with_index.map { |m, i| { verb: m[:verb], path: m[:path], index: i } } : [])
  elsif p.start_with?("/_swapbook/mock/")
    v = find(parts[3], parts[4])
    mocks = (v && v[:mocks]) || []
    i = parts[5].to_i
    res.status = v ? 200 : 404
    res["Content-Type"] = "text/html"; res.body = mocks[i] ? mocks[i][:render].call({}) : ""
  else
    res.status = 404
  end
end
trap("INT") { server.shutdown }
server.start
