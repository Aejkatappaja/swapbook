<?php
// Swapbook adapter for Laravel / PHP.
//
// Exposes the Swapbook protocol (manifest / preview / mocks / mock). Render-
// agnostic: a variant's render is a callable(array $args): string returning
// HTML, so it works with Blade, plain PHP, or any templating. Dispatch requests
// through Swapbook::handle(); mount point is /_swapbook.

function sb_control(string $name, string $type = 'text', $default = null, ?array $options = null): array
{
    $c = ['name' => $name, 'type' => $type, 'default' => $default];
    if ($options !== null) {
        $c['options'] = $options;
    }
    return $c;
}

function sb_mock(string $route, callable $render): array
{
    [$verb, $path] = str_contains($route, ' ') ? explode(' ', $route, 2) : ['GET', $route];
    return ['verb' => strtoupper($verb), 'path' => $path, 'render' => $render];
}

function sb_variant(string $name, callable $render, array $controls = [], string $docs = '', array $mocks = []): array
{
    return compact('name', 'render', 'controls', 'docs', 'mocks');
}

class Swapbook
{
    private array $stories = [];
    public string $htmxSrc = '';
    public string $cssSrc = '';
    public string $jsSrc = '';

    public function register(string $name, array $variants, string $group = '', string $docs = ''): void
    {
        $this->stories[] = ['id' => self::slug($name), 'name' => $name, 'group' => $group, 'docs' => $docs, 'variants' => $variants];
    }

    public static function slug(string $s): string
    {
        return trim(preg_replace('/-+/', '-', preg_replace('/[^a-z0-9]+/', '-', strtolower($s))), '-');
    }

    private function find(string $id, string $vname): ?array
    {
        foreach ($this->stories as $s) {
            if ($s['id'] === $id) {
                foreach ($s['variants'] as $v) {
                    if ($v['name'] === $vname) {
                        return $v;
                    }
                }
            }
        }
        return null;
    }

    private function coerce(array $controls, array $q): array
    {
        $args = [];
        foreach ($controls as $c) {
            $n = $c['name'];
            if (!array_key_exists($n, $q)) { // absent -> default; empty is a real value
                $args[$n] = $c['default'] ?? null;
                continue;
            }
            $raw = (string) $q[$n];
            $args[$n] = match ($c['type']) {
                'number' => is_numeric($raw) ? (float) $raw : ($c['default'] ?? 0),
                'bool' => in_array($raw, ['true', '1', 'on'], true),
                default => $raw,
            };
        }
        return $args;
    }

    /** @return array{0:int,1:string,2:string} [status, contentType, body] */
    public function handle(string $method, string $path, array $query): array
    {
        if ($path === '/_swapbook/manifest.json') {
            return $this->json($this->manifest());
        }
        if (preg_match('#^/_swapbook/preview/([^/]+)/([^/]+)$#', $path, $m)) {
            $v = $this->find($m[1], $m[2]);
            return $v ? $this->html(($v['render'])($this->coerce($v['controls'], $query))) : $this->notFound();
        }
        if (preg_match('#^/_swapbook/mocks/([^/]+)/([^/]+)$#', $path, $m)) {
            $v = $this->find($m[1], $m[2]);
            if (!$v) {
                return $this->notFound();
            }
            $out = [];
            foreach ($v['mocks'] as $i => $mk) {
                $out[] = ['verb' => $mk['verb'], 'path' => $mk['path'], 'index' => $i];
            }
            return $this->json($out);
        }
        if (preg_match('#^/_swapbook/mock/([^/]+)/([^/]+)/(\d+)$#', $path, $m)) {
            $v = $this->find($m[1], $m[2]);
            return ($v && isset($v['mocks'][(int) $m[3]]))
                ? $this->html(($v['mocks'][(int) $m[3]]['render'])([]))
                : $this->notFound();
        }
        return $this->notFound();
    }

    private function manifest(): array
    {
        return [
            'htmxSrc' => $this->htmxSrc, 'cssSrc' => $this->cssSrc, 'jsSrc' => $this->jsSrc,
            'stories' => array_map(fn($s) => [
                'id' => $s['id'], 'name' => $s['name'], 'group' => $s['group'], 'docs' => $s['docs'],
                'variants' => array_map(fn($v) => ['name' => $v['name'], 'controls' => $v['controls'], 'docs' => $v['docs']], $s['variants']),
            ], $this->stories),
        ];
    }

    private function json(array $o): array { return [200, 'application/json', json_encode($o)]; }
    private function html(string $s): array { return [200, 'text/html; charset=utf-8', $s]; }
    private function notFound(): array { return [404, 'text/plain', 'not found']; }
}
