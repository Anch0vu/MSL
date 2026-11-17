<?php
declare(strict_types=1);
// Private CLI integration test with transaction rollback. Never prints test credentials.
if (PHP_SAPI !== 'cli') exit(1);
$cfg = require '/var/www/cup/api/config.php';
$d = $cfg['db'];
$db = new PDO($d['dsn'], $d['user'], $d['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
]);
function q(string $sql, array $args=[]): PDOStatement {
    global $db;
    $s = $db->prepare($sql);
    $s->execute($args);
    return $s;
}
function isAdmin(): bool {return true;}
function currentUserId(): ?string {return null;}
function csrf(): void {}
function rateLimit(string $bucket,int $limit,int $window=600): void {}
function str(mixed $value,int $max,bool $required=false): string {
    $v = trim((string)$value);
    if($required && !$v) throw new RuntimeException('Required field');
    return mb_substr($v,0,$max);
}
function fail(int $code,string $message): never {throw new RuntimeException($code.' '.$message);}
require __DIR__.'/../api/obs-keys.php';
$before=(int)q('SELECT COUNT(*) FROM obs_scene_keys')->fetchColumn();
$db->beginTransaction();
try {
    $created=obsKeyCreate(['label'=>'Test broadcaster','days'=>1]);
    if (!str_starts_with($created['key'],'obs_')) throw new RuntimeException('token format');
    if (!obsKeyValid($created['key'])) throw new RuntimeException('active rejected');
    if (!count(obsKeyList()['keys'])) throw new RuntimeException('listing');
    obsKeyRevoke(['id'=>$created['id']]);
    if (obsKeyValid($created['key'])) throw new RuntimeException('revocation ignored');
    echo "PASS create/list/validate/revoke\n";
} finally {
    $db->rollBack();
}
$after=(int)q('SELECT COUNT(*) FROM obs_scene_keys')->fetchColumn();
if ($before!==$after) throw new RuntimeException('transaction did not roll back');
echo "PASS rollback; no test credentials persisted\n";
