<?php
declare(strict_types=1);

$path = $argv[1] ?? '';
if ($path === '' || !is_file($path)) {
    fwrite(STDERR, "Usage: php scripts/seed-msl-data.php /path/to/db.json\n");
    exit(2);
}
$raw = file_get_contents($path);
$doc = json_decode((string)$raw, true, 512, JSON_THROW_ON_ERROR);
$wrapped = isset($doc['db']) && is_array($doc['db']);
$db = $wrapped ? $doc['db'] : $doc;
$db['orgs'] = is_array($db['orgs'] ?? null) ? $db['orgs'] : [];

$required = [
    ['id' => 'rut-miit', 'name' => 'Российский университет транспорта', 'short' => 'РУТ МИИТ', 'kind' => 'institute', 'description' => 'Университет-участник Moscow Student\'s League.', 'site' => 'https://miit.ru'],
    ['id' => 'niu-mgsu', 'name' => 'Национальный исследовательский Московский государственный строительный университет', 'short' => 'НИУ МГСУ', 'kind' => 'institute', 'description' => 'Университет-участник Moscow Student\'s League.', 'site' => 'https://mgsu.ru'],
    ['id' => 'fin-university', 'name' => 'Финансовый университет при Правительстве Российской Федерации', 'short' => 'Финансовый университет', 'kind' => 'institute', 'description' => 'Университет-участник Moscow Student\'s League.', 'site' => 'https://fa.ru'],
    ['id' => 'bmstu', 'name' => 'Московский государственный технический университет имени Н. Э. Баумана', 'short' => 'МГТУ им. Н. Э. Баумана', 'kind' => 'institute', 'description' => 'Университет-участник Moscow Student\'s League.', 'site' => 'https://bmstu.ru'],
];

$changed = false;
$index = [];
foreach ($db['orgs'] as $i => $org) if (isset($org['id'])) $index[(string)$org['id']] = $i;
foreach ($required as $org) {
    if (!isset($index[$org['id']])) {
        $db['orgs'][] = $org;
        $changed = true;
    }
}
if (!$changed) {
    echo "unchanged\n";
    exit(0);
}
if ($wrapped) {
    $doc['db'] = $db;
    $doc['rev'] = (int)($doc['rev'] ?? 0) + 1;
    $doc['updatedAt'] = gmdate('c');
} else {
    $doc = $db;
}
$tmp = $path . '.msl.tmp';
file_put_contents($tmp, json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n", LOCK_EX);
chmod($tmp, fileperms($path) & 0777);
rename($tmp, $path);
echo "updated\n";
