# Swapbook adapter for Rails (and any Rack app).
#
# A Rack app exposing the Swapbook protocol (manifest / preview / mocks / mock).
# Render-agnostic: a variant's :render is a proc (args) -> HTML string, so it
# works with ActionView partials, ViewComponent, Phlex or raw strings, on any
# modern Rails (6+). Mount it:  mount registry => "/_swapbook"
require "json"
require "rack"

module Swapbook
  def self.slug(s)
    s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/-+/, "-").gsub(/\A-|-\z/, "")
  end

  def self.control(name, type: "text", default: nil, options: nil)
    { name: name, type: type, default: default, options: options }.compact
  end

  # Pass a non-2xx status (422, 500, …) to preview a component's error state.
  def self.mock(route, render, status: 200)
    verb, path = route.include?(" ") ? route.split(" ", 2) : ["GET", route]
    { verb: verb.upcase, path: path, render: render, status: status }
  end

  def self.variant(name, render, controls: [], docs: "", mocks: [])
    { name: name, render: render, controls: controls, docs: docs, mocks: mocks }
  end

  class Registry
    def initialize(htmx_src: "", css_src: "", js_src: "")
      @htmx_src, @css_src, @js_src = htmx_src, css_src, js_src
      @stories = []
      @global_mocks = []
    end

    def register(name, variants:, group: "", docs: "")
      @stories << { id: Swapbook.slug(name), name: name, group: group, docs: docs, variants: variants }
    end

    # Declare a registry-level mock merged into every variant, for routes shared
    # across stories. A variant's own mock for the same route wins. Chainable.
    def mock(route, render, status: 200)
      @global_mocks << Swapbook.mock(route, render, status: status)
      self
    end

    # Rack entry point (PATH_INFO is relative to the mount point).
    def call(env)
      path = env["PATH_INFO"]
      params = Rack::Request.new(env).params
      case path
      when "/manifest.json"
        json(manifest)
      when %r{\A/preview/([^/]+)/([^/]+)\z}
        v = find($1, $2)
        v ? html(v[:render].call(coerce(v[:controls], params))) : not_found
      when %r{\A/mocks/([^/]+)/([^/]+)\z}
        v = find($1, $2)
        v ? json(mocks_for(v).each_with_index.map { |m, i| { verb: m[:verb], path: m[:path], index: i } }) : not_found
      when %r{\A/mock/([^/]+)/([^/]+)/(\d+)\z}
        v = find($1, $2)
        mk = v && mocks_for(v)[$3.to_i]
        mk ? html(mk[:render].call({}), mk[:status] || 200) : not_found
      else
        not_found
      end
    end

    private

    def manifest
      {
        htmxSrc: @htmx_src, cssSrc: @css_src, jsSrc: @js_src,
        stories: @stories.map { |s|
          {
            id: s[:id], name: s[:name], group: s[:group], docs: s[:docs],
            variants: s[:variants].map { |v| { name: v[:name], controls: v[:controls], docs: v[:docs] } },
          }
        },
      }
    end

    def find(sid, vname)
      s = @stories.find { |st| st[:id] == sid }
      s && s[:variants].find { |v| v[:name] == vname }
    end

    # registry-level mocks first, then the variant's own (which override on dup)
    def mocks_for(v)
      @global_mocks + v[:mocks]
    end

    def coerce(controls, params)
      controls.each_with_object({}) do |c, args|
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

    def json(obj) = [200, { "content-type" => "application/json" }, [JSON.generate(obj)]]
    def html(str, status = 200) = [status, { "content-type" => "text/html; charset=utf-8" }, [str.to_s]]
    def not_found = [404, { "content-type" => "text/plain" }, ["not found"]]
  end
end
