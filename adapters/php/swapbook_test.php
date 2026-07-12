<?php
// Unit test for the PHP/Laravel Swapbook adapter. No framework needed:
//   php adapters/php/swapbook_test.php
// or, without a local PHP:
//   docker run --rm -v "$PWD/adapters/php:/app" -w /app php:8.3-cli php swapbook_test.php
require __DIR__ . '/swapbook.php';

$fails = 0;
function check(bool $ok, string $msg): void
{
    global $fails;
    echo ($ok ? "  ok   " : "  FAIL ") . $msg . "\n";
    if (!$ok) {
        $fails++;
    }
}

$sb = new Swapbook();
$sb->cssSrc = '/static/ds.css';
$sb->register('Button', [
    sb_variant('primary', fn($a) => '<button>Save</button>'),
    sb_variant('controls', fn($a) => "label={$a['label']} n={$a['reviews']} b=" . ($a['disabled'] ? '1' : '0'), [
        sb_control('label', 'text', 'Save'),
        sb_control('reviews', 'number', 0),
        sb_control('disabled', 'bool', false),
    ]),
], 'actions', 'Button docs.');
$sb->register('Todo', [
    sb_variant('default', fn($a) => '<ul id="rows"></ul>', [], 'todo docs', [
        sb_mock('GET /ds/row', fn($a) => '<li>New task</li>'),
    ]),
], 'interactive');

// slug normalization
check(Swapbook::slug('PR Card') === 'pr-card', 'slug("PR Card") == pr-card');

// manifest
[$st, $ct, $body] = $sb->handle('GET', '/_swapbook/manifest.json', []);
check($st === 200, 'manifest 200');
check($ct === 'application/json', 'manifest content-type json');
$m = json_decode($body, true);
check(($m['cssSrc'] ?? null) === '/static/ds.css', 'manifest cssSrc');
check(count($m['stories']) === 2, 'manifest 2 stories');
check(($m['stories'][0]['id'] ?? null) === 'button', 'story id slugged');
$ctrl = $m['stories'][0]['variants'][1] ?? [];
check(($ctrl['name'] ?? null) === 'controls' && ($ctrl['controls'][0]['name'] ?? null) === 'label', 'control schema in manifest');

// preview: static variant
[$st, , $body] = $sb->handle('GET', '/_swapbook/preview/button/primary', []);
check($st === 200 && $body === '<button>Save</button>', 'preview static variant');

// preview: control coercion (text + number, absent bool -> default false)
[, , $body] = $sb->handle('GET', '/_swapbook/preview/button/controls', ['label' => 'Hi', 'reviews' => '3']);
check($body === 'label=Hi n=3 b=0', "coerce text+number, absent bool default: got '$body'");
// preview: bool coercion + remaining defaults
[, , $body] = $sb->handle('GET', '/_swapbook/preview/button/controls', ['disabled' => 'true']);
check($body === 'label=Save n=0 b=1', "coerce bool true + defaults: got '$body'");

// mocks list
[$st, , $body] = $sb->handle('GET', '/_swapbook/mocks/todo/default', []);
$mk = json_decode($body, true);
check($st === 200 && ($mk[0]['verb'] ?? '') === 'GET' && ($mk[0]['path'] ?? '') === '/ds/row' && ($mk[0]['index'] ?? -1) === 0, 'mocks list shape');

// mock render (any method)
[$st, , $body] = $sb->handle('POST', '/_swapbook/mock/todo/default/0', []);
check($st === 200 && $body === '<li>New task</li>', 'mock render');

// mock with an explicit status serves it for error-state previews
$sb3 = new Swapbook();
$sb3->register('Form', [
    sb_variant('invalid', fn($a) => '<div>form</div>', [], '', [
        sb_mock('POST /save', fn($a) => '<div>invalid</div>', 422),
    ]),
]);
[$st, , $body] = $sb3->handle('POST', '/_swapbook/mock/form/invalid/0', []);
check($st === 422 && $body === '<div>invalid</div>', 'mock render honors status');

// unknown routes -> 404
[$st] = $sb->handle('GET', '/_swapbook/preview/nope/nope', []);
check($st === 404, 'unknown preview 404');
[$st] = $sb->handle('GET', '/nope', []);
check($st === 404, 'non-swapbook path 404');

// registry-level mocks merged into every variant
$sb2 = new Swapbook();
$sb2->mock('GET /shared', fn($a) => '<div>SHARED</div>');
$sb2->register('Card', [
    sb_variant('a', fn($a) => '<div>a</div>', [], '', [sb_mock('POST /save', fn($a) => 'SAVED')]),
    sb_variant('b', fn($a) => '<div>b</div>'),
], 'x');
[, , $body] = $sb2->handle('GET', '/_swapbook/mocks/card/a', []);
$la = json_decode($body, true);
check(count($la) === 2 && $la[0]['path'] === '/shared' && $la[1]['path'] === '/save', 'registry mock first, then variant own');
[, , $body] = $sb2->handle('GET', '/_swapbook/mocks/card/b', []);
$lb = json_decode($body, true);
check(count($lb) === 1 && $lb[0]['path'] === '/shared', 'variant without own mocks inherits the global');
[$st, , $body] = $sb2->handle('GET', '/_swapbook/mock/card/b/0', []);
check($st === 200 && $body === '<div>SHARED</div>', 'render inherited global mock');

echo $fails === 0 ? "\nPHP ADAPTER: ALL PASS\n" : "\nPHP ADAPTER: $fails FAILED\n";
exit($fails === 0 ? 0 : 1);
