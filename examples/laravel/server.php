<?php
// Laravel/Blade demo target for Swapbook. Renders the shared demo design system
// through the real Blade compiler (illuminate/view). Served by php's built-in
// server as a router script.
require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/swapbook.php';

use Illuminate\Filesystem\Filesystem;
use Illuminate\View\Compilers\BladeCompiler;

/** Render a Blade string with data (the actual Laravel Blade compiler). */
function blade(string $tpl, array $data = []): string
{
    static $compiler;
    if (!$compiler) {
        $cache = sys_get_temp_dir() . '/sb-blade';
        @mkdir($cache);
        $compiler = new BladeCompiler(new Filesystem(), $cache);
    }
    $php = $compiler->compileString($tpl);
    $level = ob_get_level();
    ob_start();
    extract($data);
    try {
        eval('?>' . $php);
    } catch (\Throwable $e) {
        while (ob_get_level() > $level) {
            ob_end_clean();
        }
        throw $e;
    }
    return ob_get_clean();
}

$card = fn(array $a) => blade(
    '<div class="card"><div class="card-head"><strong>{{ $title }}</strong><span class="badge badge-{{ $status }}">{{ $status }}</span></div>@if($reviews)<p class="muted">{{ $reviews }} review{{ $reviews == 1 ? "" : "s" }}</p>@endif</div>',
    ['title' => $a['title'] ?? 'Add dark mode', 'status' => $a['status'] ?? 'open', 'reviews' => (int) ($a['reviews'] ?? 0)]
);
$phantom = fn(array $a) => blade(
    '<script src="https://cdn.jsdelivr.net/npm/@aejkatappaja/phantom-ui/dist/phantom-ui.cdn.js"></script><phantom-ui @if($loading) loading @endif animation="{{ $animation }}" style="display:block;max-width:420px"><div class="card"><div class="card-head"><strong>Ada Lovelace</strong></div><p class="muted">First programmer, probably.</p></div></phantom-ui>',
    ['loading' => $a['loading'] ?? true, 'animation' => $a['animation'] ?? 'shimmer']
);
$btn = fn(array $a) => blade(
    '<button class="btn btn-{{ $variant }} btn-{{ $size }}" @if($disabled) disabled @endif>{{ $label }}</button>',
    ['label' => $a['label'] ?? 'Save', 'variant' => $a['variant'] ?? 'primary', 'size' => $a['size'] ?? 'md', 'disabled' => $a['disabled'] ?? false]
);
$field = fn(array $a) => blade(
    '<div class="field @if($error) error @endif"><label>{{ $label }}</label><input value="{{ $value }}" placeholder="{{ $label }}" @if($disabled) disabled @endif>@if($error)<span class="err">{{ $error }}</span>@endif</div>',
    ['label' => $a['label'] ?? 'Email', 'value' => $a['value'] ?? '', 'error' => $a['error'] ?? '', 'disabled' => $a['disabled'] ?? false]
);
$alert = fn(array $a) => blade('<div class="alert alert-{{ $kind }}">{{ $msg }}</div>', ['kind' => $a['kind'] ?? 'info', 'msg' => $a['message'] ?? 'Heads up.']);
$badge = fn(array $a) => blade('<span class="badge badge-{{ $status }}">{{ $label }}</span>', ['status' => $a['status'] ?? 'open', 'label' => $a['label'] ?? 'open']);
$empty = fn(array $a) => blade('<div class="empty"><div class="mark">📭</div><h4>{{ $title }}</h4><div>{{ $hint }}</div></div>', ['title' => $a['title'] ?? 'No workouts yet', 'hint' => $a['hint'] ?? 'Create your first one to get started.']);

$sb = new Swapbook();
$sb->cssSrc = '/static/ds.css';

$sb->register('Button', [
    sb_variant('primary', fn($a) => $btn(['label' => 'Save', 'variant' => 'primary'])),
    sb_variant('secondary', fn($a) => $btn(['label' => 'Cancel', 'variant' => 'secondary'])),
    sb_variant('danger', fn($a) => $btn(['label' => 'Delete', 'variant' => 'danger'])),
    sb_variant('disabled', fn($a) => $btn(['label' => 'Save', 'disabled' => true])),
    sb_variant('controls', $btn, [
        sb_control('label', 'text', 'Save'),
        sb_control('variant', 'select', 'primary', ['primary', 'secondary', 'danger']),
        sb_control('size', 'select', 'md', ['sm', 'md', 'lg']),
        sb_control('disabled', 'bool', false),
    ]),
], 'actions', 'The button primitive. `variant` and `size` are props.');

$sb->register('Badge', [
    sb_variant('open', fn($a) => $badge(['status' => 'open', 'label' => 'open'])),
    sb_variant('merged', fn($a) => $badge(['status' => 'merged', 'label' => 'merged'])),
    sb_variant('closed', fn($a) => $badge(['status' => 'closed', 'label' => 'closed'])),
    sb_variant('controls', $badge, [
        sb_control('status', 'select', 'open', ['open', 'merged', 'closed']),
        sb_control('label', 'text', 'open'),
    ]),
], 'data-display');

$sb->register('Alert', [
    sb_variant('info', fn($a) => $alert(['kind' => 'info', 'message' => 'A new version is available.'])),
    sb_variant('success', fn($a) => $alert(['kind' => 'success', 'message' => 'Saved successfully.'])),
    sb_variant('warning', fn($a) => $alert(['kind' => 'warning', 'message' => 'Your trial ends in 3 days.'])),
    sb_variant('error', fn($a) => $alert(['kind' => 'error', 'message' => 'Could not reach the server.'])),
    sb_variant('controls', $alert, [
        sb_control('kind', 'select', 'info', ['info', 'success', 'warning', 'error']),
        sb_control('message', 'text', 'Heads up.'),
    ]),
], 'feedback');

$sb->register('PR Card', [
    sb_variant('open', fn($a) => $card([])),
    sb_variant('with-reviews', fn($a) => $card(['title' => 'Refactor router', 'status' => 'merged', 'reviews' => 3])),
    sb_variant('controls', $card, [
        sb_control('title', 'text', 'Add dark mode'),
        sb_control('status', 'select', 'open', ['open', 'merged', 'closed']),
        sb_control('reviews', 'number', 0),
    ]),
], 'data-display');

$sb->register('Field', [
    sb_variant('default', fn($a) => $field(['label' => 'Email'])),
    sb_variant('error', fn($a) => $field(['label' => 'Email', 'value' => 'not-an-email', 'error' => 'Enter a valid email'])),
    sb_variant('disabled', fn($a) => $field(['label' => 'Email', 'value' => 'you@example.com', 'disabled' => true])),
    sb_variant('controls', $field, [
        sb_control('label', 'text', 'Email'),
        sb_control('value', 'text', ''),
        sb_control('error', 'text', ''),
        sb_control('disabled', 'bool', false),
    ]),
], 'forms');

$sb->register('Empty state', [
    sb_variant('default', $empty, [
        sb_control('title', 'text', 'No workouts yet'),
        sb_control('hint', 'text', 'Create your first one to get started.'),
    ]),
], 'feedback');

$sb->register('Table', [
    sb_variant('default', function ($a) {
        $rows = [
            ['name' => 'Ada Lovelace', 'role' => 'Owner', 'status' => 'open'],
            ['name' => 'Alan Turing', 'role' => 'Maintainer', 'status' => 'merged'],
            ['name' => 'Grace Hopper', 'role' => 'Contributor', 'status' => 'closed'],
        ];
        $tr = '';
        foreach ($rows as $r) {
            $tr .= '<tr><td>' . e($r['name']) . '</td><td>' . e($r['role']) . '</td>'
                . '<td><span class="badge badge-' . e($r['status']) . '">' . e($r['status']) . '</span></td></tr>';
        }
        return '<table class="ds"><thead><tr><th>name</th><th>role</th><th>status</th></tr></thead><tbody>' . $tr . '</tbody></table>';
    }),
], 'data-display');

$sb->register('Todo list', [
    sb_variant(
        'default',
        fn($a) => '<div class="todo"><ul id="rows"><li>Write the launch post</li><li>Record the demo gif</li></ul><button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>',
        [],
        'Click **+ add row**: the mock returns a new row htmx appends.',
        [sb_mock('GET /ds/row', fn($a) => '<li>New task</li>')]
    ),
], 'interactive');

$sb->register('Skeleton (phantom-ui)', [
    sb_variant('loading', fn($a) => $phantom(['loading' => true])),
    sb_variant('loaded', fn($a) => $phantom(['loading' => false])),
    sb_variant('controls', $phantom, [
        sb_control('loading', 'bool', true),
        sb_control('animation', 'select', 'shimmer', ['shimmer', 'pulse', 'breathe', 'solid']),
    ]),
], 'web components', 'A third-party Web Component (`@aejkatappaja/phantom-ui`) from jsdelivr.');

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/static/ds.css') {
    header('Content-Type: text/css; charset=utf-8');
    readfile(__DIR__ . '/ds.css');
    return true;
}
[$status, $ct, $body] = $sb->handle($_SERVER['REQUEST_METHOD'], $path, $_GET);
http_response_code($status);
header("Content-Type: $ct");
echo $body;
