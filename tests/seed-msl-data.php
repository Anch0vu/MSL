<?php
$root = dirname(__DIR__);
$tmp = tempnam(sys_get_temp_dir(), 'msl-seed-');
$fixture = [
  'rev' => 7,
  'updatedAt' => '2026-11-17T00:00:00Z',
  'db' => [
    'teams' => [], 'players' => [],
    'tournaments' => [[
      'id' => 'existing', 'name' => 'Existing', 'status' => 'finished', 'startDate' => '2026-01-01',
      'format' => 'Bo1', 'maxTeams' => 2, 'description' => '', 'teams' => [], 'stages' => [],
    ]],
    'matches' => [], 'news' => [], 'orgs' => [],
  ],
];
file_put_contents($tmp, json_encode($fixture, JSON_UNESCAPED_UNICODE));
$cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($root . '/scripts/seed-msl-data.php') . ' ' . escapeshellarg($tmp);
exec($cmd, $out, $code);
if ($code !== 0) throw new RuntimeException('seed failed: ' . implode("\n", $out));
$first = json_decode(file_get_contents($tmp), true, 512, JSON_THROW_ON_ERROR);
if (($first['rev'] ?? 0) !== 8) throw new RuntimeException('rev must increment once');
$ids = array_column($first['db']['orgs'], 'id');
foreach (['rut-miit','niu-mgsu','fin-university','bmstu'] as $id) {
  if (!in_array($id, $ids, true)) throw new RuntimeException("missing org $id");
}
$tids = array_column($first['db']['tournaments'], 'id');
if ($tids !== ['existing']) throw new RuntimeException('existing tournaments changed before dates and discipline were approved');
$before = file_get_contents($tmp);
exec($cmd, $out2, $code2);
if ($code2 !== 0) throw new RuntimeException('second seed failed');
$after = file_get_contents($tmp);
if ($before !== $after) throw new RuntimeException('seed is not idempotent');
unlink($tmp);
echo "seed-msl-data: ok\n";
