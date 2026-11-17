<?php
declare(strict_types=1);

/* OBS source credentials: a key belongs to a producer and can be revoked immediately.
   Only SHA-256 digests are persisted. The plaintext is returned once at issuance. */

function obsCanOperate(): bool
{
    return isAdmin() || in_array(userRole(), ['obs_operator', 'referee'], true);
}

function obsRequireOperator(): void
{
    if (!obsCanOperate()) fail(403, 'Доступ к OBS только для команды эфира');
    csrf();
}

function obsKeysEnsure(): void
{
    static $ready = false;
    if ($ready) return;
    // Deployed through schema.sql; API requests must never take DDL locks.
    q('SELECT 1 FROM obs_scene_keys LIMIT 0');
    $ready = true;
}

function obsKeyList(): array
{
    obsRequireOperator();
    obsKeysEnsure();
    $uid = currentUserId();
    $admin = isAdmin();
    $rows = $admin
        ? q("SELECT k.id,k.owner_id,k.label,k.created_at,k.expires_at,k.revoked_at,k.last_used_at,u.login AS owner_login
             FROM obs_scene_keys k LEFT JOIN users u ON u.id=k.owner_id ORDER BY k.created_at DESC LIMIT 200")->fetchAll()
        : q("SELECT k.id,k.owner_id,k.label,k.created_at,k.expires_at,k.revoked_at,k.last_used_at,u.login AS owner_login
             FROM obs_scene_keys k LEFT JOIN users u ON u.id=k.owner_id
             WHERE k.owner_id=? ORDER BY k.created_at DESC LIMIT 50", [$uid])->fetchAll();
    return ['keys' => $rows, 'canManageAll' => $admin];
}

function obsKeyCreate(array $input): array
{
    obsRequireOperator();
    obsKeysEnsure();
    rateLimit('obs-keys-create', 8, 3600);
    $uid = currentUserId();
    if ($uid === null && !isAdmin()) fail(403, 'Требуется вход в аккаунт');
    $label = str($input['label'] ?? '', 80, true);
    $days = (int) ($input['days'] ?? 30);
    if ($days < 1 || $days > 90) fail(422, 'Срок: от 1 до 90 дней');
    $count = $uid
        ? (int)q('SELECT COUNT(*) FROM obs_scene_keys WHERE owner_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP()', [$uid])->fetchColumn()
        : (int)q('SELECT COUNT(*) FROM obs_scene_keys WHERE owner_id IS NULL AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP()')->fetchColumn();
    if ($count >= 12) fail(409, 'Достигнут лимит активных ключей (12)');
    $id = 'osk-' . bin2hex(random_bytes(8));
    $token = 'obs_' . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    q('INSERT INTO obs_scene_keys(id,owner_id,label,token_hash,created_at,expires_at) VALUES(?,?,?,?,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))',
      [$id, $uid, $label, hash('sha256', $token), $days]);
    return ['id' => $id, 'key' => $token, 'label' => $label, 'days' => $days];
}

function obsKeyRevoke(array $input): array
{
    obsRequireOperator();
    obsKeysEnsure();
    $id = str($input['id'] ?? '', 24, true);
    $uid = currentUserId();
    if (isAdmin()) {
        $count = q('UPDATE obs_scene_keys SET revoked_at=UTC_TIMESTAMP() WHERE id=? AND revoked_at IS NULL', [$id])->rowCount();
    } else {
        $count = q('UPDATE obs_scene_keys SET revoked_at=UTC_TIMESTAMP() WHERE id=? AND owner_id=? AND revoked_at IS NULL', [$id, $uid])->rowCount();
    }
    if (!$count) fail(404, 'Ключ не найден или уже отозван');
    return ['ok' => true];
}

function obsKeyValid(string $token): bool
{
    if (!preg_match('/^obs_[A-Za-z0-9_-]{43}$/D', $token)) return false;
    // Schema is installed by deployment migration. Avoid DDL on scene polling.
    $record = q("SELECT k.id,k.last_used_at,k.owner_id,u.role
                 FROM obs_scene_keys k LEFT JOIN users u ON u.id=k.owner_id
                 WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>UTC_TIMESTAMP() LIMIT 1",
                [hash('sha256', $token)])->fetch();
    if (!$record) return false;
    if ($record['owner_id'] !== null && !in_array($record['role'], ['admin', 'obs_operator', 'referee'], true)) return false;
    if (!$record['last_used_at'] || strtotime($record['last_used_at'] . ' UTC') < time() - 300) {
        q('UPDATE obs_scene_keys SET last_used_at=UTC_TIMESTAMP() WHERE id=?', [$record['id']]);
    }
    return true;
}
