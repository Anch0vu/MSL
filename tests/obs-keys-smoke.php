<?php
declare(strict_types=1);
// CLI-only, fully transactional test of OBS key verification, expiry and revocation.
if (PHP_SAPI !== 'cli') exit(1);
$cfg = require '/var/www/cup/api/config.php';
$d = $cfg['db'];
$db = new PDO($d['dsn'], $d['user'], $d['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
]);
function q(string $sql, array $args=[]): PDOStatement {
    global $db;
    $stmt = $db->prepare($sql);
    $stmt->execute($args);
    return $stmt;
}
require __DIR__ . '/../api/obs-keys.php';
$token = 'obs_' . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
$id = 'osk-' . bin2hex(random_bytes(8));
$db->beginTransaction();
try {
    q("INSERT INTO obs_scene_keys (id,owner_id,label,token_hash,created_at,expires_at)
       VALUES (?,NULL,?,?,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY))",
       [$id,'integration test',hash('sha256',$token)]);
    if (!obsKeyValid($token)) throw new RuntimeException('active token rejected');
    if (obsKeyValid('obs_invalid')) throw new RuntimeException('invalid token accepted');
    q('UPDATE obs_scene_keys SET revoked_at=UTC_TIMESTAMP() WHERE id=?',[$id]);
    if (obsKeyValid($token)) throw new RuntimeException('revoked token accepted');
    q('UPDATE obs_scene_keys SET revoked_at=NULL, expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE id=?',[$id]);
    if (obsKeyValid($token)) throw new RuntimeException('expired token accepted');
    echo "PASS active/invalid/revoked/expired checks\n";
} finally {
    $db->rollBack();
}
