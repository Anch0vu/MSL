<?php
declare(strict_types=1);
// End-to-end HTTP test: temporary OBS key is removed even if any check fails.
if (PHP_SAPI !== 'cli') exit(1);
$cfg=require '/var/www/cup/api/config.php';
$d=$cfg['db'];
$db=new PDO($d['dsn'],$d['user'],$d['pass'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$id='osk-'.bin2hex(random_bytes(8));
$token='obs_'.rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');
$statement=$db->prepare("INSERT INTO obs_scene_keys(id,owner_id,label,token_hash,created_at,expires_at) VALUES(?,NULL,'HTTP smoke test',?,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))");
$statement->execute([$id,hash('sha256',$token)]);
function verify(string $token): int {
    $c=curl_init('https://cup.rut-miit.su/api/?r=obsaccess');
    curl_setopt_array($c,[
        CURLOPT_RESOLVE=>['cup.rut-miit.su:443:127.0.0.1'],
        CURLOPT_POST=>true, CURLOPT_RETURNTRANSFER=>true,
        CURLOPT_CONNECTTIMEOUT=>3,CURLOPT_TIMEOUT=>8,
        CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Cup: 1'],
        CURLOPT_POSTFIELDS=>json_encode(['key'=>$token]),
    ]);
    $response=curl_exec($c);
    if($response===false)throw new RuntimeException('CURL transport failed');
    return (int)curl_getinfo($c,CURLINFO_HTTP_CODE);
}
try {
    if(verify($token)!==200)throw new RuntimeException('active key HTTP failed');
    $db->prepare('UPDATE obs_scene_keys SET revoked_at=UTC_TIMESTAMP() WHERE id=?')->execute([$id]);
    if(verify($token)!==403)throw new RuntimeException('revocation HTTP failed');
    echo "PASS HTTP authorized=200 revoked=403\n";
} finally {
    $db->prepare('DELETE FROM obs_scene_keys WHERE id=?')->execute([$id]);
}
