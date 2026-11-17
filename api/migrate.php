<?php
declare(strict_types=1);
/*
 * Установка схемы и разовый перенос старых данных в таблицы MySQL/MariaDB.
 * Запуск из CLI: php api/migrate.php [/путь/к/старому/data_dir]
 * Источники: site_doc (прежний формат «документ одной строкой»), db.json и applications.json старого JSON-хранилища.
 */
if (PHP_SAPI !== 'cli') exit(1);
$CFG = require __DIR__ . '/config.php';
$d = $CFG['db'];
$GLOBALS['PDO'] = new PDO($d['dsn'], $d['user'], $d['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
function pdo(): PDO
{
    return $GLOBALS['PDO'];
}
function q(string $sql, array $args = []): PDOStatement
{
    $st = pdo()->prepare($sql);
    $st->execute($args);
    return $st;
}
require __DIR__ . '/doc.php';
$pdo = pdo();

foreach (array_filter(array_map('trim', explode(';', (string)file_get_contents(__DIR__ . '/schema.sql')))) as $sql) {
    if (!preg_match('/^\s*(--.*\n)*\s*$/', $sql)) $pdo->exec($sql);
}
echo "schema ok\n";

$old = $argv[1] ?? ($CFG['data_dir'] ?? null);
$ts = fn(?string $iso) => $iso ? gmdate('Y-m-d H:i:s', strtotime($iso)) : null;

/** Нормализация для сравнения: ключи по алфавиту, пустой объект равен пустому массиву. */
function canon(mixed $v): mixed
{
    if (is_object($v)) $v = (array)$v;
    if (!is_array($v)) return $v;
    $isList = array_is_list($v);
    $v = array_map('canon', $v);
    if (!$isList) ksort($v);
    return $v;
}

if (!q('SELECT 1 FROM site_meta WHERE id=1')->fetch()) {
    $src = null;
    $rev = 1;
    $at = gmdate('Y-m-d H:i:s');
    $row = q('SELECT rev, body, updated_at FROM site_doc WHERE id=1')->fetch();
    if ($row) {
        $src = json_decode($row['body'], true);
        $rev = (int)$row['rev'];
        $at = $row['updated_at'];
    } elseif ($old && is_file("$old/db.json")) {
        $doc = json_decode((string)file_get_contents("$old/db.json"), true);
        if (is_array($doc) && isset($doc['db'])) {
            $src = $doc['db'];
            $rev = (int)$doc['rev'];
            $at = $ts($doc['updatedAt'] ?? null) ?? $at;
        }
    }
    if (is_array($src)) {
        $pdo->beginTransaction();
        docStore($src);
        q('INSERT INTO site_meta (id, rev, updated_at) VALUES (1,?,?)', [$rev, $at]);
        $back = docLoad();
        $cmp = fn(array $x) => json_encode(array_filter(canon($x), fn($v) => $v !== [])); // пустые секции (например, orgs) не считаются отличием
        if ($cmp($back) !== $cmp($src)) {
            $pdo->rollBack();
            fwrite(STDERR, "MISMATCH: перенос отменён, данные не совпали\n");
            file_put_contents('/tmp/migrate-src.json', json_encode(canon($src), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
            file_put_contents('/tmp/migrate-back.json', json_encode(canon($back), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
            exit(2);
        }
        $pdo->commit();
        echo "document rev $rev moved to d_* tables, round-trip identical\n";
    }
}

$apps = ($old && is_file("$old/applications.json")) ? json_decode((string)file_get_contents("$old/applications.json"), true) : [];
$n = 0;
foreach ($apps ?: [] as $a) {
    if (q('SELECT 1 FROM applications WHERE id=?', [$a['id']])->fetch()) continue;
    q('INSERT INTO applications (id, kind, status, tournament_id, user_id, org_id, faculty, contact, comment, team_name, team_tag, captain, players, nick, role, twitch, course, note, created_at, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        $a['id'], $a['kind'], $a['status'], $a['tournamentId'] ?? '', $a['userId'] ?? '', $a['orgId'] ?? '', $a['faculty'] ?? '', $a['contact'], $a['comment'] ?? '',
        $a['team']['name'] ?? null, $a['team']['tag'] ?? null, $a['captain'] ?? null, isset($a['players']) ? json_encode($a['players'], JSON_UNESCAPED_UNICODE) : null,
        $a['nick'] ?? null, $a['role'] ?? null, $a['twitch'] ?? null, $a['course'] ?? null, $a['note'] ?? '', $ts($a['createdAt']) ?? gmdate('Y-m-d H:i:s'), $ts($a['decidedAt'] ?? null),
    ]);
    $n++;
}
echo "applications imported: $n\n";
if ($old && !(int)q('SELECT COUNT(*) FROM site_snapshots')->fetchColumn()) {
    foreach (glob("$old/backups/db-*.json") ?: [] as $f) {
        if (!preg_match('/-r(\d+)\.json$/', $f, $m)) continue;
        q('INSERT INTO site_snapshots (rev, body, created_at) VALUES (?,?,?)', [(int)$m[1], (string)file_get_contents($f), gmdate('Y-m-d H:i:s', filemtime($f))]);
    }
}
echo "done\n";
