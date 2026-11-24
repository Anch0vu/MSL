<?php
declare(strict_types=1);

/*
 * API лиги. Один файл, PHP 8.1+, расширение pdo_mysql.
 * Маршрут через ?r=... — работает без mod_rewrite.
 * Хранилище — MySQL/MariaDB (схема в schema.sql, применяется php api/migrate.php).
 * Документ турнирной сетки раскладывается по таблицам d_* (doc.php), версия в site_meta, полные снапшоты для отката в site_snapshots;
 * аккаунты, заявки, лимиты запросов и кэш — отдельные таблицы.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

final class ApiError extends Exception
{
    public function __construct(public int $status, string $msg)
    {
        parent::__construct($msg);
    }
}

function fail(int $code, string $msg): never
{
    throw new ApiError($code, $msg);
}

function ok(mixed $data): never
{
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) {
    http_response_code(503);
    echo json_encode(['error' => 'api not configured: create api/config.php from config.example.php']);
    exit;
}
$CFG = require $cfgFile;

session_name('cupsid');
session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 7,
    'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'httponly' => true,
    'samesite' => 'Strict',
]);

function pdo(): PDO
{
    global $CFG;
    static $pdo = null;
    if ($pdo === null) {
        $d = $CFG['db'] ?? null;
        if (!$d) fail(503, 'db not configured');
        $pdo = new PDO($d['dsn'], $d['user'], $d['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement
{
    $st = pdo()->prepare($sql);
    $st->execute($args);
    return $st;
}

require __DIR__ . '/doc.php';
require __DIR__ . '/ratelimit.php';
require __DIR__ . '/features.php';
require __DIR__ . '/features2.php';
require __DIR__ . '/obs-keys.php';

function now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function iso(?string $dt): ?string
{
    return $dt ? gmdate('c', strtotime($dt . ' UTC')) : null;
}

function txn(callable $fn): mixed
{
    $p = pdo();
    $p->beginTransaction();
    try {
        $r = $fn();
        $p->commit();
        return $r;
    } catch (Throwable $e) {
        if ($p->inTransaction()) $p->rollBack();
        throw $e;
    }
}

function body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if (strlen($raw) > 2_000_000) fail(413, 'body too large');
    $j = json_decode($raw, true);
    if (!is_array($j)) fail(400, 'invalid json');
    return $j;
}

function str(mixed $v, int $max, bool $required = false): string
{
    $s = trim(is_string($v) ? $v : '');
    $s = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $s) ?? '';
    if ($required && $s === '') fail(422, 'missing field');
    return mb_substr($s, 0, $max);
}

function uid(string $prefix): string
{
    return $prefix . '-' . bin2hex(random_bytes(4));
}

/** Не больше $limit событий за $window секунд на IP. */
function rateLimit(string $bucket, int $limit, int $window = 600): void
{
    $key = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|cup');
    $t = time();
    q('DELETE FROM rate_limits WHERE ts < ?', [$t - 3600]);
    $n = (int)q('SELECT COUNT(*) FROM rate_limits WHERE bucket=? AND ip_hash=? AND ts>?', [$bucket, $key, $t - $window])->fetchColumn();
    if ($n >= $limit) fail(429, 'Слишком много попыток, попробуйте позже');
    q('INSERT INTO rate_limits (bucket, ip_hash, ts) VALUES (?,?,?)', [$bucket, $key, $t]);
}

function sess(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE && isset($_COOKIE['cupsid'])) session_start();
}

function isAdmin(): bool
{
    sess();
    // пароль организатора или роль аккаунта (features2.php)
    return !empty($_SESSION['admin']) || userRole() === 'admin';
}

function csrf(): void
{
    // защита от CSRF: браузер не пошлёт наш заголовок кросс-доменно без CORS
    if (($_SERVER['HTTP_X_CUP'] ?? '') !== '1') fail(403, 'bad request origin');
}

function requireAdmin(): void
{
    if (!isAdmin()) fail(401, 'login required');
    csrf();
}

function currentUserId(): ?string
{
    sess();
    $uid = $_SESSION['uid'] ?? null;
    if ($uid !== null) {
        static $banned = [];
        $banned[$uid] ??= (int)q('SELECT banned FROM users WHERE id=?', [$uid])->fetchColumn() === 1;
        if ($banned[$uid]) {
            unset($_SESSION['uid']);
            return null;
        }
    }
    return $uid;
}

// ---------- документ сайта ----------

function seedDb(): array
{
    $seed = __DIR__ . '/../data/db.json';
    $db = is_file($seed) ? json_decode((string)file_get_contents($seed), true) : null;
    return is_array($db) ? $db : ['teams' => [], 'players' => [], 'tournaments' => [], 'matches' => [], 'news' => [], 'rules' => ''];
}

/** Читает документ сайта под блокировкой версии, $fn может изменить его ($changed = true), тогда таблицы d_* перезаписываются. */
function docTx(callable $fn): mixed
{
    return txn(function () use ($fn) {
        $row = q('SELECT rev, updated_at FROM site_meta WHERE id=1 FOR UPDATE')->fetch();
        if (!$row) {
            q('INSERT IGNORE INTO site_meta (id, rev, updated_at) VALUES (1, 1, ?)', [now()]);
            $row = q('SELECT rev, updated_at FROM site_meta WHERE id=1 FOR UPDATE')->fetch();
            if ((int)q('SELECT COUNT(*) FROM d_tournaments')->fetchColumn() === 0 && (int)q('SELECT COUNT(*) FROM d_teams')->fetchColumn() === 0) docStore(seedDb());
        }
        $doc = ['rev' => (int)$row['rev'], 'db' => docLoad(), 'updatedAt' => iso($row['updated_at'])];
        $changed = false;
        $res = $fn($doc, $changed);
        if ($changed) {
            docStore($doc['db']);
            q('UPDATE site_meta SET rev=?, updated_at=? WHERE id=1', [$doc['rev'], now()]);
        }
        return $res;
    });
}

/** Чтение документа без блокировки (согласованный снимок); при пустой БД создаёт документ из сида. */
function docRead(): array
{
    $doc = txn(function () {
        $row = q('SELECT rev, updated_at FROM site_meta WHERE id=1')->fetch();
        return $row ? ['rev' => (int)$row['rev'], 'db' => docLoad(), 'updatedAt' => iso($row['updated_at'])] : null;
    });
    return $doc ?? docTx(fn($d) => $d);
}

function snapshot(array $doc): void
{
    q('INSERT INTO site_snapshots (rev, body, created_at) VALUES (?,?,?)', [$doc['rev'], json_encode($doc['db'], JSON_UNESCAPED_UNICODE), now()]);
    q('DELETE FROM site_snapshots WHERE id <= (SELECT id FROM (SELECT id FROM site_snapshots ORDER BY id DESC LIMIT 1 OFFSET 30) x)');
}

// ---------- пользователи и заявки ----------

function publicUser(array $u): array
{
    return [
        'id' => $u['id'], 'login' => $u['login'], 'name' => $u['name'], 'nick' => $u['nick'], 'orgId' => $u['org_id'], 'contact' => $u['contact'], 'twitch' => $u['twitch'], 'bio' => $u['bio'],
        'position' => $u['position'] ?? '', 'mmr' => isset($u['mmr']) ? (int)$u['mmr'] : null, 'discord' => $u['discord'] ?? '',
        'showContact' => !empty($u['show_contact']), 'avatar' => (int)($u['avatar_v'] ?? 0),
        'steam' => isset($u['steam_id']) ? (string)$u['steam_id'] : '', 'rankTier' => isset($u['rank_tier']) ? (int)$u['rank_tier'] : null,
        'leaderboard' => isset($u['leaderboard_rank']) ? (int)$u['leaderboard_rank'] : null, 'dotaMmr' => isset($u['dota_mmr']) ? (int)$u['dota_mmr'] : null,
        'dotaName' => $u['dota_name'] ?? '', 'dotaAt' => iso($u['dota_at'] ?? null), 'lft' => !empty($u['lft']), 'lftNote' => $u['lft_note'] ?? '',
        'steamVerified' => !empty($u['steam_verified']),
        'games' => json_decode((string)($u['games'] ?? ''), true) ?: [], 'links' => json_decode((string)($u['links'] ?? ''), true) ?: [],
        'accent' => $u['accent'] ?? '', 'banner' => $u['banner'] ?? '', 'tagline' => $u['tagline'] ?? '', 'banned' => !empty($u['banned']),
        'persona' => (object)(json_decode((string)($u['persona'] ?? ''), true) ?: []), 'badges' => json_decode((string)($u['badges'] ?? ''), true) ?: [],
        'role' => $u['role'] ?? '', 'tg' => isset($u['tg_chat']),
    ];
}

/**
 * Переносит поля профиля аккаунта в карточку игрока (по userId) внутри документа сайта.
 * Возвращает 'created' | 'updated' | 'none'. Карточку создаёт только при $create.
 */
function applyUserToPlayers(array &$db, array $u, bool $create): string
{
    $idx = null;
    foreach ($db['players'] as $i => $p) if (($p['userId'] ?? '') === $u['id']) $idx = $i;
    if ($idx === null && !$create) return 'none';
    $nick = $u['nick'] !== '' ? $u['nick'] : $u['login'];
    $faculty = '';
    foreach ($db['orgs'] ?? [] as $o) if ($o['id'] === $u['org_id']) $faculty = $o['short'] ?? $o['name'];
    $pub = !empty($u['show_contact']);
    [$mmr, $mmrOk] = shownMmr($u);
    $want = [
        'nick' => $nick, 'name' => $u['name'], 'role' => $u['position'],
        'mmr' => $mmr, 'mmrVerified' => $mmrOk, 'rankTier' => $u['rank_tier'] !== null ? (int)$u['rank_tier'] : null,
        'leaderboard' => $u['leaderboard_rank'] !== null ? (int)$u['leaderboard_rank'] : null, 'steamId' => $u['steam_id'] !== null ? (string)$u['steam_id'] : '',
        'lft' => !empty($u['lft']) ? true : null, 'lftNote' => !empty($u['lft']) ? $u['lft_note'] : '',
        'games' => json_decode((string)($u['games'] ?? ''), true) ?: null, 'links' => json_decode((string)($u['links'] ?? ''), true) ?: null,
        'accent' => $u['accent'], 'banner' => $u['banner'], 'tagline' => $u['tagline'],
        'persona' => json_decode((string)($u['persona'] ?? ''), true) ?: null, 'badges' => json_decode((string)($u['badges'] ?? ''), true) ?: null,
        'steamOk' => !empty($u['steam_verified']) ? true : null,
        'csPremier' => isset($u['cs_premier']) ? (int)$u['cs_premier'] : null, 'faceitLevel' => isset($u['faceit_level']) ? (int)$u['faceit_level'] : null,
        'faceitElo' => isset($u['faceit_elo']) ? (int)$u['faceit_elo'] : null, 'dlBadge' => isset($u['dl_badge']) ? (int)$u['dl_badge'] : null,
        'twitch' => $u['twitch'], 'about' => $u['bio'], 'faculty' => $faculty,
        'contact' => $pub ? $u['contact'] : '', 'discord' => $u['discord'], // Discord обязателен и виден всегда: по нему капитаны ищут игроков
        'avatar' => (int)$u['avatar_v'] > 0 ? (int)$u['avatar_v'] : null,
    ];
    if ($idx === null) {
        $new = ['id' => 'pu_' . $u['id'], 'userId' => $u['id']];
        foreach ($want as $k => $v) if ($v !== '' && $v !== null && $v !== []) $new[$k] = $v;
        $db['players'][] = $new;
        return 'created';
    }
    $old = $db['players'][$idx];
    $p = $old;
    foreach ($want as $k => $v) {
        if ($v === '' || $v === null || $v === []) unset($p[$k]);
        else $p[$k] = $v;
    }
    if ($p == $old) return 'none';
    $db['players'][$idx] = $p;
    return 'updated';
}

const TEAM_MEDIA = ['logo' => [300_000, 1024], 'banner' => [1_500_000, 2400]];

/** Управлять командой может её владелец (подал заявку) или капитан, чья карточка привязана к аккаунту. */
function canManageTeam(array $db, array $t, ?string $uid): bool
{
    if (!$uid) return false;
    if (($t['ownerId'] ?? '') === $uid) return true;
    foreach ($db['players'] as $p) if ($p['id'] === ($t['captainId'] ?? '') && ($p['userId'] ?? '') === $uid) return true;
    return false;
}

/** Проставляет командам версии логотипа и баннера из team_media (картинки живут вне документа). */
function applyTeamMedia(array &$db): void
{
    $v = [];
    foreach (q('SELECT team_id, kind, v FROM team_media')->fetchAll() as $r) $v[$r['team_id']][$r['kind']] = (int)$r['v'];
    foreach ($db['teams'] as &$t) {
        foreach (array_keys(TEAM_MEDIA) as $k) {
            if (isset($v[$t['id']][$k])) $t[$k] = $v[$t['id']][$k];
            else unset($t[$k]);
        }
    }
}

/** Индекс карточки игрока, привязанной к аккаунту, или null. */
function userCard(array $db, string $userId): ?int
{
    foreach ($db['players'] as $i => $p) if ($userId !== '' && ($p['userId'] ?? '') === $userId) return $i;
    return null;
}

function needDiscord(string $uid): void
{
    if (trim((string)q('SELECT discord FROM users WHERE id=?', [$uid])->fetchColumn()) === '') fail(422, 'Сначала укажите Discord в профиле (Кабинет)');
}

/** Обновление профиля: правки существующей карточки не меняют rev (админ не ловит конфликтов), новая карточка меняет. */
function syncUserPlayer(array $u): void
{
    docTx(function (&$d, &$changed) use ($u) {
        $res = applyUserToPlayers($d['db'], $u, true);
        if ($res === 'created') $d['rev']++;
        if ($res !== 'none') $changed = true;
    });
}

// ---------- Dota 2: ранг и ММР через OpenDota ----------

/** Steam32 account id из числа (32/64 бит) или ссылки Dotabuff / OpenDota / Stratz / steamcommunity.com/profiles. */
function parseSteamId(string $s): int
{
    $s = trim($s);
    if (preg_match('#steamcommunity\.com/id/#i', $s)) fail(422, 'Короткая ссылка Steam (/id/…) не подходит: вставьте ссылку Dotabuff или числовой ID');
    if (preg_match('#(?:players|profiles?)/(\d{1,20})#i', $s, $m)) $s = $m[1];
    if (!preg_match('/^\d{1,20}$/', $s)) fail(422, 'Steam ID: число или ссылка на профиль Dotabuff / OpenDota');
    $n = (int)$s;
    if ($n > 76561197960265728) $n -= 76561197960265728;
    if ($n <= 0 || $n > 4294967295) fail(422, 'Некорректный Steam ID');
    return $n;
}

/** Примерный ММР по медали (rank_tier = медаль*10 + звезда), если OpenDota не дал computed_mmr. */
function rankMmr(?int $tier): ?int
{
    if (!$tier) return null;
    $medal = intdiv($tier, 10);
    $star = max(1, min(5, $tier % 10));
    if ($medal >= 8) return 5620;
    if ($medal < 1) return null;
    if ($medal === 7) return 4620 + ($star - 1) * 200 + 100;
    return ($medal - 1) * 770 + ($star - 1) * 154 + 77;
}

/** Диапазон ММР медали; computed_mmr у OpenDota считается по лобби и часто завышен в 1,5–2 раза. */
function medalRange(?int $tier): ?array
{
    $m = $tier ? intdiv($tier, 10) : 0;
    if ($m < 1) return null;
    if ($m >= 8) return [5620, 20000];
    if ($m === 7) return [4620, 5619];
    return [($m - 1) * 770, $m * 770 - 1];
}

function inMedal(?int $mmr, ?int $tier): bool
{
    $r = medalRange($tier);
    return $mmr !== null && $r !== null && $mmr >= $r[0] && $mmr <= $r[1];
}

/** ММР для карточки: свой, если он сходится с медалью, иначе оценка по медали. [ммр, подтверждён] */
function shownMmr(array $u): array
{
    $tier = $u['rank_tier'] !== null ? (int)$u['rank_tier'] : null;
    $own = $u['mmr'] !== null ? (int)$u['mmr'] : null;
    if ($tier && inMedal($own, $tier)) return [$own, true];
    if ($u['dota_mmr'] !== null) return [(int)$u['dota_mmr'], true];
    return [$own, null];
}

/** $strict=false: без профиля в Dota/при сбое OpenDota Steam всё равно сохраняется (CS2, Deadlock). */
function dotaRefresh(string $uid, int $acc, bool $strict = true): void
{
    statsLater($acc);
    $ch = curl_init("https://api.opendota.com/api/players/$acc");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, CURLOPT_HTTPHEADER => ['Accept: application/json']]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $res = json_decode((string)$raw, true);
    $down = $code !== 200 || !is_array($res);
    if (!$strict && ($down || empty($res['profile']))) {
        q('UPDATE users SET steam_id=?, rank_tier=NULL, leaderboard_rank=NULL, dota_mmr=NULL, dota_name=\'\', dota_at=? WHERE id=?', [$acc, $down ? null : now(), $uid]);
        q('DELETE FROM kv WHERE k=?', ["gs:$acc"]);
        return;
    }
    if ($down) fail(502, 'OpenDota не ответил, попробуйте позже');
    if (empty($res['profile'])) fail(422, 'Профиль не найден на OpenDota. В Dota 2 включите «Общедоступная история матчей» и сыграйте матч');
    $tier = isset($res['rank_tier']) ? (int)$res['rank_tier'] : null;
    $cm = isset($res['computed_mmr']) ? (int)round((float)$res['computed_mmr']) : null;
    $mmr = inMedal($cm, $tier) ? $cm : rankMmr($tier);
    q('UPDATE users SET steam_id=?, rank_tier=?, leaderboard_rank=?, dota_mmr=?, dota_name=?, dota_at=? WHERE id=?', [
        $acc, $tier, isset($res['leaderboard_rank']) ? (int)$res['leaderboard_rank'] : null, $mmr, str((string)($res['profile']['personaname'] ?? ''), 64), now(), $uid,
    ]);
    q('DELETE FROM kv WHERE k=?', ["gs:$acc"]);
}

// ---------- персонализация профиля ----------

const GAME_IDS = ['dota2', 'cs2', 'deadlock', 'valorant', 'lol', 'apex', 'fortnite', 'other'];
const BANNERS = ['stripes', 'grid', 'dots', 'waves', 'glow', 'aurora', 'mesh', 'carbon', 'void'];

/** Персонализация профиля (рамка, эффекты, ник): только значения из списков. */
const PERSONA = [
    'frame' => ['accent', 'gradient', 'rainbow', 'neon', 'gold', 'ice', 'fire'],
    'effect' => ['pulse', 'glow', 'spin', 'float'],
    'nickFx' => ['gradient', 'glow', 'shimmer'],
];
/** Бейджи, которые выдаёт организатор. */
const BADGES = ['team', 'moderator', 'partner', 'caster', 'streamer', 'mvp', 'founder'];

function cleanPersona(mixed $p): array
{
    if (!is_array($p)) return [];
    $o = [];
    foreach (PERSONA as $k => $vals) if (in_array($p[$k] ?? '', $vals, true)) $o[$k] = $p[$k];
    $emoji = trim((string)($p['emoji'] ?? ''));
    if ($emoji !== '' && mb_strlen($emoji) <= 4 && !preg_match('/[\p{L}\p{N}<>&"\']/u', $emoji)) $o['emoji'] = $emoji;
    if (preg_match('/^#[0-9a-f]{6}$/i', (string)($p['accent2'] ?? ''))) $o['accent2'] = strtolower((string)$p['accent2']);
    if (isset($p['grad']) && is_numeric($p['grad'])) $o['grad'] = ((int)$p['grad'] % 360 + 360) % 360;
    return $o;
}

/** Внешняя ссылка: только http(s), без пробелов. */
function extUrl(mixed $v): string
{
    $s = str($v, 200);
    return preg_match('#^https?://[^\s<>"]{3,}$#i', $s) ? $s : '';
}

/** Игровые профили: до 6 разных игр. */
function cleanGames(mixed $v): array
{
    $out = [];
    foreach (is_array($v) ? $v : [] as $x) {
        if (!is_array($x) || !in_array($x['g'] ?? '', GAME_IDS, true) || isset($out[$x['g']])) continue;
        $out[$x['g']] = array_filter(['g' => $x['g'], 'rank' => str($x['rank'] ?? '', 40), 'role' => str($x['role'] ?? '', 32), 'url' => extUrl($x['url'] ?? ''), 'main' => !empty($x['main']) ? true : null], fn($y) => $y !== '' && $y !== null);
        if (count($out) >= 6) break;
    }
    return array_values($out);
}

/** Свои контакты/ссылки: до 8 пар «подпись — URL». */
function cleanLinks(mixed $v): array
{
    $out = [];
    foreach (is_array($v) ? $v : [] as $x) {
        if (!is_array($x)) continue;
        $url = extUrl($x['url'] ?? '');
        if ($url === '') continue;
        $out[] = ['label' => str($x['label'] ?? '', 32) ?: (string)parse_url($url, PHP_URL_HOST), 'url' => $url];
        if (count($out) >= 8) break;
    }
    return $out;
}

// ---------- статистика по Steam: Dota 2 (OpenDota), CS2 (Leetify: FACEIT/Premier), Deadlock (deadlock-api) ----------

/** Параллельные GET-запросы; для каждого ключа — декодированный JSON или null. */
function fetchMany(array $urls, int $timeout = 10): array
{
    $mh = curl_multi_init();
    $hs = [];
    foreach ($urls as $k => $u) {
        $ch = curl_init($u);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, CURLOPT_USERAGENT => 'cup-league/1.0', CURLOPT_HTTPHEADER => ['Accept: application/json']]);
        curl_multi_add_handle($mh, $ch);
        $hs[$k] = $ch;
    }
    do {
        $st = curl_multi_exec($mh, $running);
        if ($running && curl_multi_select($mh, 1.0) === -1) usleep(50000);
    } while ($running > 0 && $st === CURLM_OK);
    $out = [];
    foreach ($hs as $k => $ch) {
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $out[$k] = $code === 200 ? json_decode((string)curl_multi_getcontent($ch), true) : null;
        curl_multi_remove_handle($mh, $ch);
    }
    curl_multi_close($mh);
    return $out;
}

function kvGet(string $k): mixed
{
    $v = q('SELECT v FROM kv WHERE k=? AND exp>?', [$k, time()])->fetchColumn();
    return $v === false ? null : json_decode((string)$v, true);
}

function kvSet(string $k, mixed $v, int $ttl): void
{
    q('REPLACE INTO kv (k, v, exp) VALUES (?,?,?)', [$k, json_encode($v, JSON_UNESCAPED_UNICODE), time() + $ttl]);
}

/** Справочник героев Dota 2: id => [имя, картинка]. */
function dotaHeroes(): array
{
    $h = kvGet('od:heroes');
    if (is_array($h)) return $h;
    $raw = fetchMany(['h' => 'https://cdn.jsdelivr.net/npm/dotaconstants/build/heroes.json'], 10)['h'];
    if (!is_array($raw)) return [];
    $h = [];
    foreach ($raw as $x) $h[(string)$x['id']] = [$x['localized_name'] ?? '', 'https://cdn.cloudflare.steamstatic.com' . strtok((string)($x['img'] ?? ''), '?')];
    kvSet('od:heroes', $h, 365 * 86400);
    return $h;
}

function gameStats(int $acc): array
{
    $s64 = (string)($acc + 76561197960265728);
    $r = fetchMany([
        'wl' => "https://api.opendota.com/api/players/$acc/wl",
        'heroes' => "https://api.opendota.com/api/players/$acc/heroes",
        'recent' => "https://api.opendota.com/api/players/$acc/recentMatches",
        'leetify' => "https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=$s64",
        'dlheroes' => "https://api.deadlock-api.com/v1/players/$acc/hero-stats",
        'dlhist' => "https://api.deadlock-api.com/v1/players/$acc/match-history?only_stored_history=true",
    ]);
    $out = ['dota' => null, 'cs2' => null, 'deadlock' => null, 'at' => gmdate('c')];

    $wl = $r['wl'];
    if (is_array($wl) && ((int)($wl['win'] ?? 0) + (int)($wl['lose'] ?? 0)) > 0) {
        $hn = dotaHeroes();
        $hero = fn($id) => ['id' => (int)$id, 'name' => $hn[(string)$id][0] ?? "#$id", 'img' => $hn[(string)$id][1] ?? ''];
        $top = array_slice(array_filter(is_array($r['heroes']) ? $r['heroes'] : [], fn($x) => ($x['games'] ?? 0) > 0), 0, 5);
        $rec = array_slice(is_array($r['recent']) ? $r['recent'] : [], 0, 20);
        $avg = fn(string $k) => $rec ? round(array_sum(array_map(fn($m) => (float)($m[$k] ?? 0), $rec)) / count($rec), 1) : null;
        $out['dota'] = [
            'win' => (int)$wl['win'], 'lose' => (int)$wl['lose'],
            'heroes' => array_map(fn($x) => $hero($x['hero_id']) + ['games' => (int)$x['games'], 'win' => (int)$x['win']], $top),
            'recent' => array_map(fn($m) => $hero($m['hero_id']) + [
                'match' => (int)$m['match_id'], 'k' => (int)$m['kills'], 'd' => (int)$m['deaths'], 'a' => (int)$m['assists'],
                'won' => ($m['player_slot'] < 128) === (bool)$m['radiant_win'], 'at' => gmdate('c', (int)$m['start_time']), 'min' => intdiv((int)$m['duration'], 60),
                'gpm' => (int)($m['gold_per_min'] ?? 0), 'xpm' => (int)($m['xp_per_min'] ?? 0), 'lh' => (int)($m['last_hits'] ?? 0), 'dmg' => (int)($m['hero_damage'] ?? 0),
            ], $rec),
            'avg' => $rec ? ['k' => $avg('kills'), 'd' => $avg('deaths'), 'a' => $avg('assists'), 'gpm' => (int)$avg('gold_per_min'), 'xpm' => (int)$avg('xp_per_min'), 'lh' => (int)$avg('last_hits'), 'dmg' => (int)$avg('hero_damage'), 'n' => count($rec), 'won' => count(array_filter($rec, fn($m) => ($m['player_slot'] < 128) === (bool)$m['radiant_win']))] : null,
        ];
    }

    $lt = $r['leetify'];
    if (is_array($lt) && !empty($lt['ranks'])) {
        $rk = $lt['ranks'];
        $out['cs2'] = [
            'premier' => isset($rk['premier']) ? (int)$rk['premier'] : null, 'faceit' => isset($rk['faceit']) ? (int)$rk['faceit'] : null,
            'faceitElo' => isset($rk['faceit_elo']) ? (int)$rk['faceit_elo'] : null, 'leetify' => isset($rk['leetify']) ? round((float)$rk['leetify'], 2) : null,
            'winrate' => isset($lt['winrate']) ? round((float)$lt['winrate'] * 100) : null, 'matches' => (int)($lt['total_matches'] ?? 0),
            'aim' => isset($lt['rating']['aim']) ? round((float)$lt['rating']['aim']) : null, 'utility' => isset($lt['rating']['utility']) ? round((float)$lt['rating']['utility']) : null,
            'positioning' => isset($lt['rating']['positioning']) ? round((float)$lt['rating']['positioning']) : null,
            'hs' => isset($lt['stats']['accuracy_head']) ? round((float)$lt['stats']['accuracy_head']) : null,
            'recent' => array_map(fn($m) => ['map' => preg_replace('/^(de|cs)_/', '', (string)($m['map_name'] ?? '')), 'won' => ($m['outcome'] ?? '') === 'win', 'score' => is_array($m['score'] ?? null) ? implode(':', $m['score']) : '', 'at' => $m['finished_at'] ?? null], array_slice(is_array($lt['recent_matches'] ?? null) ? $lt['recent_matches'] : [], 0, 5)),
        ];
        if (!$out['cs2']['premier'] && !$out['cs2']['faceit'] && !$out['cs2']['matches']) $out['cs2'] = null;
    }

    $dh = is_array($r['dlheroes']) ? $r['dlheroes'] : [];
    if ($dh) {
        $t = ['matches' => 0, 'wins' => 0, 'k' => 0, 'd' => 0, 'a' => 0];
        foreach ($dh as $x) {
            $t['matches'] += (int)($x['matches_played'] ?? 0);
            $t['wins'] += (int)($x['wins'] ?? 0);
            $t['k'] += (int)($x['kills'] ?? 0);
            $t['d'] += (int)($x['deaths'] ?? 0);
            $t['a'] += (int)($x['assists'] ?? 0);
        }
        $badge = null;
        foreach (is_array($r['dlhist']) ? $r['dlhist'] : [] as $m) if (!empty($m['ranked_display_badge'])) { $badge = (int)$m['ranked_display_badge']; break; }
        if ($t['matches'] > 0) $out['deadlock'] = $t + ['badge' => $badge];
    }
    return $out;
}

/** Пересчёт статистики: кэш gs:<acc> + Premier/FACEIT/Deadlock в users и карточках игроков (для списков). */
function statsRefresh(int $acc): array
{
    $c = gameStats($acc);
    kvSet("gs2:$acc", $c, 6 * 3600);
    $cs = $c['cs2'];
    // FACEIT без Leetify приходит из браузера (POST faceit): пустой ответ Leetify его не затирает
    q('UPDATE users SET cs_premier=?, faceit_level=COALESCE(?, faceit_level), faceit_elo=COALESCE(?, faceit_elo), dl_badge=? WHERE steam_id=?', [$cs['premier'] ?? null, $cs['faceit'] ?? null, $cs['faceitElo'] ?? null, $c['deadlock']['badge'] ?? null, $acc]);
    $us = q('SELECT * FROM users WHERE steam_id=?', [$acc])->fetchAll();
    if ($us) docTx(function (&$d, &$changed) use ($us) {
        foreach ($us as $u) if (applyUserToPlayers($d['db'], $u, false) !== 'none') $changed = true;
    });
    return $c;
}

/** statsRefresh после отправки ответа (внешние API медленные, пользователь не ждёт). */
function statsLater(int $acc): void
{
    static $seen = [];
    if (isset($seen[$acc])) return;
    $seen[$acc] = true;
    register_shutdown_function(function () use ($acc) {
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        try {
            statsRefresh($acc);
        } catch (Throwable) {
        }
    });
}

// ---------- вход через Steam (OpenID 2.0) ----------

const STEAM_OP = 'https://steamcommunity.com/openid/login';

/** Адрес API этого сайта: https://host/api/ (хост ограничен vhost'ами веб-сервера). */
function selfApi(): string
{
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    if (!preg_match('/^[a-z0-9.-]{1,100}$/', $host)) fail(400, 'bad host');
    $path = (string)strtok((string)($_SERVER['REQUEST_URI'] ?? '/api/'), '?');
    return "https://$host$path";
}

function steamBack(string $err = '', string $to = 'account'): never
{
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    header('Location: https://' . $host . '/' . ($err !== '' ? '?steam=' . rawurlencode($err) : '') . '#/' . $to, true, 302);
    exit;
}

/** Steam32 id пользователя, подтверждённый у Steam (check_authentication), либо null. */
function steamVerify(string $returnTo): ?int
{
    $p = [];
    foreach (explode('&', (string)($_SERVER['QUERY_STRING'] ?? '')) as $kv) {
        [$k, $v] = array_pad(explode('=', $kv, 2), 2, '');
        $k = urldecode($k);
        if (str_starts_with($k, 'openid.')) $p[$k] = urldecode($v);
    }
    if (($p['openid.mode'] ?? '') !== 'id_res' || ($p['openid.op_endpoint'] ?? '') !== STEAM_OP) return null;
    if (!str_starts_with($p['openid.return_to'] ?? '', $returnTo)) return null;
    if (!preg_match('#^https://steamcommunity\.com/openid/id/(\d{17})$#', $p['openid.claimed_id'] ?? '', $m)) return null;
    $p['openid.mode'] = 'check_authentication';
    $ch = curl_init(STEAM_OP);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_POSTFIELDS => http_build_query($p)]);
    $res = (string)curl_exec($ch);
    if (!preg_match('/^is_valid:true$/m', $res)) return null;
    return (int)$m[1] - 76561197960265728;
}

/** Создаёт заявку (сайт или Discord-бот), возвращает её id. */
function insertApplication(array $b, string $userId): string
{
    $requestedKind = (string)($b['kind'] ?? 'team');
    $kind = in_array($requestedKind, ['team', 'organization', 'player'], true) ? $requestedKind : 'team';
    foreach (docRead()['db']['orgs'] ?? [] as $o) if ($o['id'] === ($b['orgId'] ?? '') && !empty($o['closed'])) $b['orgId'] = '';
    $row = [
        'id' => uid('app'), 'kind' => $kind, 'tournament_id' => str($b['tournamentId'] ?? '', 64),
        'user_id' => $userId, 'org_id' => str($b['orgId'] ?? '', 64), 'faculty' => str($b['faculty'] ?? '', 80),
        'contact' => str($b['contact'] ?? '', 120, true), 'comment' => str($b['comment'] ?? '', 500), 'created_at' => now(),
        'team_name' => null, 'team_tag' => null, 'captain' => null, 'players' => null, 'nick' => null, 'role' => null, 'twitch' => null, 'course' => null,
    ];
    if ($kind === 'organization') {
        $org = is_array($b['organization'] ?? null) ? $b['organization'] : [];
        $row['team_name'] = str($org['name'] ?? '', 120, true);
        $row['team_tag'] = mb_strtoupper(str($org['short'] ?? '', 24, true));
        $orgKind = (string)($org['kind'] ?? 'other');
        $row['role'] = in_array($orgKind, ['institute', 'club', 'department', 'other'], true) ? $orgKind : 'other';
        $row['twitch'] = str($org['site'] ?? '', 200);
        $row['players'] = json_encode(['description' => str($org['description'] ?? '', 500)], JSON_UNESCAPED_UNICODE);
    } elseif ($kind === 'team') {
        $row['team_name'] = str($b['team']['name'] ?? '', 60, true);
        $row['team_tag'] = mb_strtoupper(str($b['team']['tag'] ?? '', 4, true));
        $players = [];
        foreach (array_slice(is_array($b['players'] ?? null) ? $b['players'] : [], 0, 8) as $p) {
            $nick = str($p['nick'] ?? '', 32);
            if ($nick !== '') $players[] = array_filter(['nick' => $nick, 'role' => str($p['role'] ?? '', 32), 'twitch' => str($p['twitch'] ?? '', 40), 'discord' => str($p['discord'] ?? '', 40)], fn($x) => $x !== '') + ['role' => '', 'twitch' => ''];
        }
        if (count($players) < 1) fail(422, 'Укажите состав');
        $row['players'] = json_encode($players, JSON_UNESCAPED_UNICODE);
        $row['captain'] = str($b['captain'] ?? $players[0]['nick'], 32);
    } else {
        $row['nick'] = str($b['nick'] ?? '', 32, true);
        $row['role'] = str($b['role'] ?? '', 32);
        $row['twitch'] = str($b['twitch'] ?? '', 40);
        $row['course'] = max(0, min(9, (int)($b['course'] ?? 0)));
    }
    if ((int)q("SELECT COUNT(*) FROM applications WHERE status='pending'")->fetchColumn() > 500) fail(503, 'Очередь заявок переполнена');
    $cols = array_keys($row);
    q('INSERT INTO applications (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')', array_values($row));
    return $row['id'];
}

/** Переносит заявку в документ сайта: команда/карточка игрока и место в турнире. $strict — проверки для автоприёма без модератора. */
function applyApplication(array $app, bool $strict): ?string
{
    return docTx(function (&$d, &$changed) use ($app, $strict) {
        $tid = null;
        $db = &$d['db'];
        if ($app['kind'] === 'organization') {
            $db['orgs'] ??= [];
            if ($strict) foreach ($db['orgs'] as $org) if (mb_strtolower((string)$org['name']) === mb_strtolower((string)$app['organization']['name'])) fail(409, 'Организация с таким названием уже есть');
            $tid = uid('org');
            $db['orgs'][] = array_filter([
                'id' => $tid,
                'name' => $app['organization']['name'],
                'short' => $app['organization']['short'],
                'kind' => $app['organization']['kind'],
                'description' => $app['organization']['description'],
                'site' => $app['organization']['site'],
            ], fn($x) => $x !== '');
        } elseif ($app['kind'] === 'team') {
            if ($strict) {
                if (mb_strlen($app['team']['name']) < 2) fail(422, 'Название: от 2 символов');
                foreach ($db['teams'] as $o) if (mb_strtolower($o['name']) === mb_strtolower($app['team']['name'])) fail(409, 'Команда с таким названием уже есть');
                $mine = userCard($db, (string)($app['userId'] ?? ''));
                if ($mine !== null && !empty($db['players'][$mine]['teamId'])) fail(409, 'Вы уже состоите в команде — одну карточку нельзя вести в двух');
                foreach ($db['tournaments'] as $t) {
                    if ($t['id'] !== $app['tournamentId']) continue;
                    if (!in_array($t['status'], ['registration', 'upcoming'], true)) fail(409, 'Регистрация на этот турнир закрыта');
                    if (count($t['teams']) >= (int)$t['maxTeams']) fail(409, 'В турнире нет свободных мест');
                }
            }
            $tid = uid('team');
            $pids = [];
            foreach ($app['players'] as $i => $p) {
                $card = array_filter(['nick' => $p['nick'], 'role' => $p['role'] ?: ($i === 0 ? 'Капитан' : 'Игрок'), 'teamId' => $tid, 'faculty' => $app['faculty'], 'twitch' => $p['twitch'] ?? '', 'discord' => $p['discord'] ?? '', 'userId' => $i === 0 ? ($app['userId'] ?: '') : '']);
                // у аккаунта уже есть карточка — переводим её в команду, а не создаём дубль
                $own = $i === 0 ? userCard($db, (string)($app['userId'] ?? '')) : null;
                if ($own !== null) {
                    $db['players'][$own] = ['teamId' => $tid, 'role' => $card['role']] + $db['players'][$own] + $card;
                    $pids[] = $db['players'][$own]['id'];
                    continue;
                }
                $pid = uid('p');
                $pids[] = $pid;
                $db['players'][] = ['id' => $pid] + $card;
            }
            $captain = $pids[0];
            foreach ($app['players'] as $i => $p) if ($p['nick'] === $app['captain']) $captain = $pids[$i];
            $palette = ['#0054b8', '#e4002b', '#00a86b', '#ff7a00', '#7a5cff', '#00b2ff', '#d6006f', '#8a9a00'];
            $db['teams'][] = ['id' => $tid, 'name' => $app['team']['name'], 'tag' => $app['team']['tag'], 'color' => $palette[random_int(0, count($palette) - 1)], 'faculty' => $app['faculty'], 'captainId' => $captain, 'contact' => $app['contact'], 'orgId' => $app['orgId'], 'ownerId' => $app['userId']];
            foreach ($db['tournaments'] as &$t) {
                if ($t['id'] === $app['tournamentId'] && count($t['teams']) < (int)$t['maxTeams']) $t['teams'][] = $tid;
            }
        } else {
            $card = array_filter(['nick' => $app['nick'], 'role' => $app['role'] ?: 'Свободный игрок', 'faculty' => $app['faculty'], 'course' => $app['course'] ?: null, 'twitch' => $app['twitch'], 'about' => $app['comment'], 'contact' => $app['contact'], 'userId' => $app['userId'] ?: '']);
            $own = userCard($db, (string)($app['userId'] ?? ''));
            if ($own !== null) $db['players'][$own] += $card;
            else $db['players'][] = ['id' => uid('p')] + $card;
        }
        $d['rev']++;
        $changed = true;
        return $tid;
    });
}

function appOut(array $r): array
{
    $a = [
        'id' => $r['id'], 'kind' => $r['kind'], 'status' => $r['status'], 'createdAt' => iso($r['created_at']),
        'tournamentId' => $r['tournament_id'], 'contact' => $r['contact'], 'faculty' => $r['faculty'], 'orgId' => $r['org_id'],
        'userId' => $r['user_id'], 'comment' => $r['comment'], 'note' => $r['note'], 'decidedAt' => iso($r['decided_at']),
    ];
    if ($r['kind'] === 'organization') {
        $orgData = json_decode((string)$r['players'], true) ?: [];
        $a['organization'] = ['name' => $r['team_name'], 'short' => $r['team_tag'], 'kind' => $r['role'] ?: 'other', 'site' => $r['twitch'], 'description' => $orgData['description'] ?? ''];
    } elseif ($r['kind'] === 'team') {
        $a['team'] = ['name' => $r['team_name'], 'tag' => $r['team_tag']];
        $a['players'] = json_decode((string)$r['players'], true) ?: [];
        $a['captain'] = $r['captain'];
    } else {
        $a['nick'] = $r['nick'];
        $a['role'] = $r['role'];
        $a['twitch'] = $r['twitch'];
        $a['course'] = (int)$r['course'];
    }
    return $a;
}

// php index.php close-org <orgId>: сделать организацию закрытой и показать её участников
if (PHP_SAPI === 'cli' && ($argv[1] ?? '') === 'close-org') {
    docTx(function (&$d, &$changed) use ($argv) {
        foreach ($d['db']['orgs'] as &$o) if ($o['id'] === ($argv[2] ?? '')) { $o['closed'] = true; $changed = true; }
        unset($o);
    });
    foreach (q('SELECT login, nick FROM users WHERE org_id=?', [$argv[2] ?? ''])->fetchAll() as $u) echo "{$u['login']} ({$u['nick']})\n";
    exit;
}

// php index.php set-org <login> [orgId]: назначить или снять организацию
if (PHP_SAPI === 'cli' && ($argv[1] ?? '') === 'set-org') {
    q('UPDATE users SET org_id=? WHERE login=?', [$argv[3] ?? '', $argv[2] ?? '']);
    $u = q('SELECT * FROM users WHERE login=?', [$argv[2] ?? ''])->fetch();
    if ($u) syncUserPlayer($u);
    echo $u ? "ok\n" : "no user\n";
    exit;
}

// php index.php heroes: справочник героев с долгим таймаутом (с jsDelivr: api.opendota.com отдаёт его серверу слишком медленно)
if (PHP_SAPI === 'cli' && ($argv[1] ?? '') === 'heroes') {
    $raw = fetchMany(['h' => 'https://cdn.jsdelivr.net/npm/dotaconstants/build/heroes.json'], 600)['h'];
    if (!is_array($raw)) exit("fail\n");
    $h = [];
    foreach ($raw as $x) $h[(string)$x['id']] = [$x['localized_name'] ?? '', 'https://cdn.cloudflare.steamstatic.com' . strtok((string)($x['img'] ?? ''), '?')];
    kvSet('od:heroes', $h, 365 * 86400);
    q("DELETE FROM kv WHERE k LIKE 'gs2:%'");
    echo count($h), " heroes\n";
    exit;
}

// php index.php sync-players: обновить карточки всех игроков с аккаунтом
if (PHP_SAPI === 'cli' && ($argv[1] ?? '') === 'sync-players') {
    foreach (q('SELECT * FROM users')->fetchAll() as $u) syncUserPlayer($u);
    echo "ok\n";
    exit;
}

// php index.php fix-mmr: пересчитать ММР по медали и обновить карточки игроков
if (PHP_SAPI === 'cli' && ($argv[1] ?? '') === 'fix-mmr') {
    foreach (q('SELECT * FROM users WHERE rank_tier IS NOT NULL')->fetchAll() as $u) {
        $tier = (int)$u['rank_tier'];
        if ($u['dota_mmr'] !== null && !inMedal((int)$u['dota_mmr'], $tier)) {
            q('UPDATE users SET dota_mmr=? WHERE id=?', [rankMmr($tier), $u['id']]);
            echo "{$u['login']}: {$u['dota_mmr']} -> " . rankMmr($tier) . "\n";
        }
        syncUserPlayer(q('SELECT * FROM users WHERE id=?', [$u['id']])->fetch());
    }
    exit;
}

// php index.php cron | failover-watch | notify-test (features.php)
if (PHP_SAPI === 'cli' && fxCli($argv)) exit;

$r = $_GET['r'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

try {
    throttle("$method $r");
    // резервный сервер: данные приходят с основного каждую минуту, запись здесь потерялась бы
    if (readonlyMode() && ($method !== 'GET' || in_array($r, ['steamlogin', 'steamcb'], true))) fail(503, 'Сайт временно работает на резервном сервере в режиме только чтения. Попробуйте позже.');
    switch ("$method $r") {
        case 'GET db':
            ok(docRead() + (readonlyMode() ? ['readonly' => true] : []));

        case 'PUT db':
            requireAdmin();
            $b = body();
            if (!is_array($b['db'] ?? null) || !isset($b['db']['teams'], $b['db']['tournaments'], $b['db']['matches'])) fail(422, 'invalid db');
            $doc = docTx(function (&$d, &$changed) use ($b) {
                if (isset($b['rev']) && (int)$b['rev'] !== $d['rev']) fail(409, 'Данные на сервере изменились. Обновите страницу.');
                // поля профилей аккаунтов принадлежат пользователям: админский черновик их не затирает
                $ids = [];
                foreach ($b['db']['players'] ?? [] as $pl) if (!empty($pl['userId'])) $ids[] = (string)$pl['userId'];
                if ($ids) {
                    $in = implode(',', array_fill(0, count($ids), '?'));
                    foreach (q("SELECT * FROM users WHERE id IN ($in)", $ids)->fetchAll() as $u) applyUserToPlayers($b['db'], $u, false);
                }
                applyTeamMedia($b['db']);
                $GLOBALS['FX_OLD_DB'] = $d['db'];
                $d = ['rev' => $d['rev'] + 1, 'db' => $b['db'], 'updatedAt' => gmdate('c')];
                $changed = true;
                return $d;
            });
            snapshot($doc);
            fxAfterPublish($GLOBALS['FX_OLD_DB'] ?? null, $doc['db']);
            ok(['rev' => $doc['rev'], 'updatedAt' => $doc['updatedAt']]);

        case 'GET me':
            ok(['admin' => isAdmin(), 'role' => isAdmin() ? 'admin' : userRole(), 'password' => !empty($_SESSION['admin']), 'configured' => !empty($CFG['admin_password_hash'])]);

        case 'GET obsauth':
            ok(['authorized' => obsCanOperate(), 'manageAll' => isAdmin()]);

        case 'GET obskey':
            fail(410, 'Общий ключ устарел. Создайте индивидуальный в панели OBS.');

        case 'GET obskeys':
            ok(obsKeyList());

        case 'POST obskeys-create':
            ok(obsKeyCreate(body()));

        case 'POST obskeys-revoke':
            ok(obsKeyRevoke(body()));

        case 'POST obsaccess':
            csrf();
            if (!obsKeyValid((string)(body()['key'] ?? ''))) fail(403, 'Ключ OBS недействителен или отозван');
            ok(['authorized' => true]);

        case 'POST login':
            $b = body();
            $hash = (string)($CFG['admin_password_hash'] ?? '');
            if ($hash === '' || !password_verify((string)($b['password'] ?? ''), $hash)) fail(401, 'Неверный пароль');
            session_start();
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            ok(['admin' => true]);

        case 'POST logout':
            if (isAdmin()) unset($_SESSION['admin']);
            ok(['admin' => false]);

        case 'POST signup':
            csrf();
            $b = body();
            if (!empty($b['website'])) ok(['ok' => true]);
            $login = strtolower(str($b['login'] ?? '', 24, true));
            if (!preg_match('/^[a-z0-9_.-]{3,24}$/', $login)) fail(422, 'Логин: 3–24 символа, латиница, цифры, _ . -');
            $pw = (string)($b['password'] ?? '');
            if (mb_strlen($pw) < 8 || mb_strlen($pw) > 128) fail(422, 'Пароль: от 8 символов');
            if ((int)q('SELECT COUNT(*) FROM users')->fetchColumn() > 5000) fail(503, 'Регистрация временно закрыта');
            $id = uid('u');
            try {
                q('INSERT INTO users (id, login, pass_hash, name, created_at) VALUES (?,?,?,?,?)', [$id, $login, password_hash($pw, PASSWORD_DEFAULT), str($b['name'] ?? '', 60), now()]);
            } catch (PDOException $e) {
                if ($e->getCode() === '23000') fail(409, 'Логин занят');
                throw $e;
            }
            session_start();
            session_regenerate_id(true);
            $_SESSION['uid'] = $id;
            ok(['user' => publicUser(q('SELECT * FROM users WHERE id=?', [$id])->fetch())]);

        case 'POST signin':
            csrf();
            $b = body();
            $u = q('SELECT * FROM users WHERE login=?', [strtolower(str($b['login'] ?? '', 24))])->fetch();
            $okpw = password_verify((string)($b['password'] ?? ''), $u['pass_hash'] ?? password_hash('dummy', PASSWORD_DEFAULT));
            if (!$u || !$okpw) fail(401, 'Неверный логин или пароль');
            if (!empty($u['banned'])) fail(403, 'Аккаунт заблокирован организатором');
            session_start();
            session_regenerate_id(true);
            $_SESSION['uid'] = $u['id'];
            ok(['user' => publicUser($u)]);

        case 'POST signout':
            sess();
            unset($_SESSION['uid']);
            ok(['user' => null]);

        case 'GET account':
            $uid = currentUserId();
            $u = $uid ? q('SELECT * FROM users WHERE id=?', [$uid])->fetch() : false;
            ok(['user' => $u ? publicUser($u) : null]);

        case 'POST account':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'login required');
            $b = body();
            $orgId = str($b['orgId'] ?? '', 64);
            if ($orgId !== '') {
                $okOrg = false;
                $cur = (string)q('SELECT org_id FROM users WHERE id=?', [$uid])->fetchColumn();
                foreach (docRead()['db']['orgs'] ?? [] as $o) if ($o['id'] === $orgId) $okOrg = empty($o['closed']) || $orgId === $cur;
                if (!$okOrg) fail(403, 'В эту организацию добавляет только организатор');
            }
            if (str($b['discord'] ?? '', 64) === '') fail(422, 'Укажите Discord: по нему с вами свяжутся капитаны и организаторы');
            $mmr = $b['mmr'] ?? null;
            $mmr = ($mmr === null || $mmr === '') ? null : max(0, min(20000, (int)$mmr));
            q('UPDATE users SET name=?, nick=?, org_id=?, contact=?, twitch=?, bio=?, position=?, mmr=?, discord=?, show_contact=? WHERE id=?', [
                str($b['name'] ?? '', 60), str($b['nick'] ?? '', 32), $orgId, str($b['contact'] ?? '', 120), str($b['twitch'] ?? '', 40), str($b['bio'] ?? '', 500),
                str($b['position'] ?? '', 32), $mmr, str($b['discord'] ?? '', 64), empty($b['showContact']) ? 0 : 1, $uid,
            ]);
            q('UPDATE users SET lft=?, lft_note=? WHERE id=?', [empty($b['lft']) ? 0 : 1, str($b['lftNote'] ?? '', 200), $uid]);
            $games = cleanGames($b['games'] ?? []);
            $links = cleanLinks($b['links'] ?? []);
            $accent = preg_match('/^#[0-9a-f]{6}$/i', (string)($b['accent'] ?? '')) ? strtolower((string)$b['accent']) : '';
            $banner = in_array($b['banner'] ?? '', BANNERS, true) ? $b['banner'] : '';
            $persona = cleanPersona($b['persona'] ?? []);
            q('UPDATE users SET persona=? WHERE id=?', [$persona ? json_encode($persona, JSON_UNESCAPED_UNICODE) : null, $uid]);
            q('UPDATE users SET games=?, links=?, accent=?, banner=?, tagline=? WHERE id=?', [
                $games ? json_encode($games, JSON_UNESCAPED_UNICODE) : null, $links ? json_encode($links, JSON_UNESCAPED_UNICODE) : null, $accent, $banner, str($b['tagline'] ?? '', 80), $uid,
            ]);
            $u = q('SELECT * FROM users WHERE id=?', [$uid])->fetch();
            if (!$u) fail(404, 'not found');
            $warn = '';
            if (array_key_exists('steam', $b)) {
                $steam = trim((string)$b['steam']);
                try {
                    if ($steam === '') {
                        if ($u['steam_id'] !== null) q('UPDATE users SET steam_verified=0, steam_id=NULL, rank_tier=NULL, leaderboard_rank=NULL, dota_mmr=NULL, dota_name=\'\', dota_at=NULL, cs_premier=NULL, faceit_level=NULL, faceit_elo=NULL, dl_badge=NULL WHERE id=?', [$uid]);
                    } elseif (!empty($u['steam_verified'])) {
                        if ((string)parseSteamId($steam) !== (string)$u['steam_id']) fail(422, 'Steam привязан через вход, сменить его нельзя');
                    } else {
                        $acc = parseSteamId($steam);
                        if (q('SELECT 1 FROM users WHERE steam_id=? AND steam_verified=1 AND id<>?', [$acc, $uid])->fetchColumn()) fail(409, 'Этот Steam уже привязан к другому аккаунту');
                        if ((string)$acc !== (string)$u['steam_id'] || $u['dota_at'] === null) dotaRefresh($uid, $acc, false);
                    }
                } catch (ApiError $e) {
                    $warn = 'Профиль сохранён, но ММР не обновлён: ' . $e->getMessage();
                }
                $u = q('SELECT * FROM users WHERE id=?', [$uid])->fetch();
            }
            syncUserPlayer($u);
            ok(['user' => publicUser($u), 'warning' => $warn]);

        case 'GET gamestats':
            $acc = (int)($_GET['steam'] ?? 0);
            if ($acc <= 0 || !q('SELECT 1 FROM users WHERE steam_id=?', [$acc])->fetchColumn()) fail(404, 'not found');
            $c = kvGet("gs2:$acc");
            if (!is_array($c)) {
                $c = statsRefresh($acc);
                q('DELETE FROM kv WHERE exp < ? AND k LIKE ?', [time(), 'gs%:%']);
            }
            header('Cache-Control: public, max-age=600');
            ok($c);

        case 'GET steamlogin':
            $n = bin2hex(random_bytes(16));
            q('REPLACE INTO kv (k, v, exp) VALUES (?,?,?)', ["steam:$n", currentUserId() ?? '', time() + 600]);
            // вход организатора или судьи: после Steam вернуть в панель
            if (($_GET['to'] ?? '') === 'admin') q('REPLACE INTO kv (k, v, exp) VALUES (?,?,?)', ["steamto:$n", '"admin"', time() + 600]);
            $back = selfApi() . "?r=steamcb&n=$n";
            $host = parse_url($back, PHP_URL_HOST);
            header('Location: ' . STEAM_OP . '?' . http_build_query([
                'openid.ns' => 'http://specs.openid.net/auth/2.0', 'openid.mode' => 'checkid_setup',
                'openid.return_to' => $back, 'openid.realm' => "https://$host/",
                'openid.identity' => 'http://specs.openid.net/auth/2.0/identifier_select',
                'openid.claimed_id' => 'http://specs.openid.net/auth/2.0/identifier_select',
            ]), true, 302);
            exit;

        case 'GET steamcb':
            $n = str($_GET['n'] ?? '', 32);
            $st = q('SELECT v FROM kv WHERE k=? AND exp>?', ["steam:$n", time()])->fetchColumn();
            q('DELETE FROM kv WHERE k=? OR (k LIKE ? AND exp<?)', ["steam:$n", 'steam:%', time()]);
            if ($n === '' || $st === false) steamBack('expired');
            $acc = steamVerify(selfApi() . "?r=steamcb&n=$n");
            if (!$acc) steamBack('failed');
            $owner = q('SELECT id FROM users WHERE steam_id=? AND steam_verified=1', [$acc])->fetchColumn();
            $uid = (string)$st;
            if ($uid !== '') {
                if ($owner && $owner !== $uid) steamBack('taken');
            } elseif ($owner) {
                $uid = (string)$owner;
            } else {
                if ((int)q('SELECT COUNT(*) FROM users')->fetchColumn() > 5000) steamBack('closed');
                $uid = uid('u');
                q('INSERT INTO users (id, login, pass_hash, name, created_at) VALUES (?,?,?,?,?)', [$uid, "steam_$acc", password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), '', now()]);
            }
            q('UPDATE users SET steam_id=NULL, steam_verified=0, rank_tier=NULL, leaderboard_rank=NULL, dota_mmr=NULL, dota_name=\'\', dota_at=NULL, cs_premier=NULL, faceit_level=NULL, faceit_elo=NULL, dl_badge=NULL WHERE steam_id=? AND id<>?', [$acc, $uid]);
            q('UPDATE users SET steam_id=?, steam_verified=1 WHERE id=?', [$acc, $uid]);
            try {
                dotaRefresh($uid, $acc, false);
            } catch (ApiError) {
            }
            q("UPDATE users SET nick=dota_name WHERE id=? AND nick='' AND dota_name<>''", [$uid]);
            session_start();
            session_regenerate_id(true);
            $_SESSION['uid'] = $uid;
            syncUserPlayer(q('SELECT * FROM users WHERE id=?', [$uid])->fetch());
            $to = q('SELECT v FROM kv WHERE k=?', ["steamto:$n"])->fetchColumn();
            q('DELETE FROM kv WHERE k=? OR (k LIKE ? AND exp<?)', ["steamto:$n", 'steamto:%', time()]);
            steamBack('', $to !== false ? 'admin' : 'account');

        case 'POST dotasync':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'login required');
            $u = q('SELECT * FROM users WHERE id=?', [$uid])->fetch();
            if (!$u || $u['steam_id'] === null) fail(422, 'Сначала укажите Steam ID');
            if ($u['dota_at'] !== null && strtotime((string)$u['dota_at'] . ' UTC') > time() - 600) fail(429, 'Обновлять ранг можно раз в 10 минут');
            dotaRefresh($uid, (int)$u['steam_id']);
            $u = q('SELECT * FROM users WHERE id=?', [$uid])->fetch();
            syncUserPlayer($u);
            ok(['user' => publicUser($u)]);

        case 'POST avatar':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'login required');
            $b = body();
            if (!empty($b['remove'])) {
                q('UPDATE users SET avatar=NULL, avatar_mime=\'\', avatar_v=0 WHERE id=?', [$uid]);
            } else {
                if (!preg_match('#^data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', (string)($b['data'] ?? ''), $m)) fail(422, 'Нужен JPEG, PNG или WebP');
                $bin = base64_decode($m[1], true);
                if ($bin === false || strlen($bin) > 300_000) fail(413, 'Файл больше 300 КБ');
                $info = @getimagesizefromstring($bin);
                $mime = $info['mime'] ?? '';
                if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true) || $info[0] > 2048 || $info[1] > 2048) fail(422, 'Некорректное изображение');
                q('UPDATE users SET avatar=?, avatar_mime=?, avatar_v=avatar_v+1 WHERE id=?', [$bin, $mime, $uid]);
            }
            $u = q('SELECT * FROM users WHERE id=?', [$uid])->fetch();
            syncUserPlayer($u);
            ok(['user' => publicUser($u)]);

        case 'POST teammedia':
            csrf();
            $b = body();
            $tid = str($b['team'] ?? '', 64);
            $kind = (string)($b['kind'] ?? '');
            if (!isset(TEAM_MEDIA[$kind])) fail(422, 'bad kind');
            $team = null;
            $cur = docRead()['db'];
            foreach ($cur['teams'] as $t) if ($t['id'] === $tid) $team = $t;
            if (!$team) fail(404, 'Команда не найдена');
            if (!isAdmin() && !canManageTeam($cur, $team, currentUserId())) fail(403, 'Менять оформление может владелец команды или организатор');
            if (!empty($b['remove'])) {
                q('DELETE FROM team_media WHERE team_id=? AND kind=?', [$tid, $kind]);
            } else {
                [$max, $side] = TEAM_MEDIA[$kind];
                if (!preg_match('#^data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', (string)($b['data'] ?? ''), $m)) fail(422, 'Нужен JPEG, PNG или WebP');
                $bin = base64_decode($m[1], true);
                if ($bin === false || strlen($bin) > $max) fail(413, 'Файл больше ' . intdiv($max, 1000) . ' КБ');
                $info = @getimagesizefromstring($bin);
                $mime = $info['mime'] ?? '';
                if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true) || $info[0] > $side || $info[1] > $side) fail(422, 'Некорректное изображение');
                // версия = время загрузки: после «Убрать» и новой загрузки URL не совпадёт со старым (картинки кэшируются как immutable)
                q('INSERT INTO team_media (team_id, kind, mime, data, v) VALUES (?,?,?,?,UNIX_TIMESTAMP()) ON DUPLICATE KEY UPDATE mime=VALUES(mime), data=VALUES(data), v=GREATEST(v+1, UNIX_TIMESTAMP())', [$tid, $kind, $mime, $bin]);
            }
            // версия картинки в документе меняется без rev: черновик админа её не затрёт (PUT db берёт версии из team_media)
            docTx(function (&$d, &$changed) {
                $before = $d['db']['teams'];
                applyTeamMedia($d['db']);
                $changed = $before != $d['db']['teams'];
            });
            $v = q('SELECT v FROM team_media WHERE team_id=? AND kind=?', [$tid, $kind])->fetchColumn();
            ok(['v' => $v === false ? 0 : (int)$v]);

        case 'GET teammedia':
            $row = q('SELECT data, mime FROM team_media WHERE team_id=? AND kind=?', [str($_GET['t'] ?? '', 64), (string)($_GET['k'] ?? '')])->fetch();
            if (!$row) {
                http_response_code(404);
                exit;
            }
            header('Content-Type: ' . $row['mime']);
            header('Cache-Control: public, max-age=31536000, immutable');
            header('X-Content-Type-Options: nosniff');
            echo $row['data'];
            exit;

        case 'GET avatar':
            $row = q('SELECT avatar, avatar_mime FROM users WHERE id=?', [str($_GET['id'] ?? '', 32)])->fetch();
            if (!$row || $row['avatar'] === null || $row['avatar'] === '') {
                http_response_code(404);
                exit;
            }
            header('Content-Type: ' . $row['avatar_mime']);
            header('Cache-Control: public, max-age=31536000, immutable');
            header('X-Content-Type-Options: nosniff');
            echo $row['avatar'];
            exit;

        case 'POST myteam':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'login required');
            $b = body();
            $tid = docTx(function (&$d, &$changed) use ($uid, $b) {
                $want = (string)($b['team'] ?? '');
                foreach ($d['db']['teams'] as &$t) {
                    if (($want === '' || $t['id'] === $want) && canManageTeam($d['db'], $t, $uid)) {
                        $act = (string)($b['action'] ?? '');
                        if ($act !== '') {
                            $tid = $t['id'];
                            $members = fn() => array_filter($d['db']['players'], fn($p) => ($p['teamId'] ?? '') === $tid);
                            if ($act === 'addplayer') {
                                $nick = str($b['nick'] ?? '', 32);
                                if (mb_strlen($nick) < 2) fail(422, 'Ник: от 2 символов');
                                if (count($members()) >= 10) fail(409, 'В составе уже 10 игроков');
                                foreach ($members() as $p) if (mb_strtolower($p['nick'] ?? '') === mb_strtolower($nick)) fail(409, 'Такой игрок уже в составе');
                                $d['db']['players'][] = ['id' => $tid . '-' . bin2hex(random_bytes(3)), 'nick' => $nick, 'role' => str($b['role'] ?? '', 32) ?: 'Игрок', 'teamId' => $tid];
                            } elseif ($act === 'invite') {
                                if (count($members()) >= 10) fail(409, 'В составе уже 10 игроков');
                                $nick = mb_strtolower(trim((string)($b['nick'] ?? '')));
                                if ($nick === '') fail(422, 'Укажите ник игрока с аккаунтом');
                                $found = null;
                                foreach ($d['db']['players'] as $i => $p) {
                                    if (empty($p['userId']) || mb_strtolower($p['nick'] ?? '') !== $nick) continue;
                                    $has = !empty($p['teamId']) && count(array_filter($d['db']['teams'], fn($x) => $x['id'] === $p['teamId'])) > 0;
                                    if ($has) fail(409, 'Игрок уже состоит в команде, пусть сначала выйдет');
                                    $found = $i;
                                }
                                if ($found === null) fail(404, 'Аккаунт с таким ником не найден. Игрок должен зарегистрироваться на сайте');
                                $d['db']['players'][$found]['teamId'] = $tid;
                            } elseif ($act === 'removeplayer') {
                                $pid = (string)($b['id'] ?? '');
                                if ($pid === ($t['captainId'] ?? '')) fail(409, 'Капитана убрать нельзя: сначала передайте капитанство');
                                foreach ($d['db']['players'] as $i => $p) {
                                    if ($p['id'] !== $pid || ($p['teamId'] ?? '') !== $tid) continue;
                                    if (!empty($p['userId'])) unset($d['db']['players'][$i]['teamId']);
                                    else unset($d['db']['players'][$i]);
                                }
                                $d['db']['players'] = array_values($d['db']['players']);
                            } elseif ($act === 'setcaptain') {
                                $pid = (string)($b['id'] ?? '');
                                $np = null;
                                foreach ($members() as $p) if ($p['id'] === $pid) $np = $p;
                                if (!$np) fail(404, 'Игрок не найден в составе');
                                $t['captainId'] = $pid;
                                // владельцем становится новый капитан с аккаунтом, иначе владелец остаётся прежним
                                if (!empty($np['userId'])) $t['ownerId'] = $np['userId'];
                            } else {
                                fail(422, 'Неизвестное действие');
                            }
                            $d['rev']++;
                            $changed = true;
                            return $tid;
                        }
                        if (isset($b['name'])) {
                            $name = str($b['name'], 40);
                            if (mb_strlen($name) < 2) fail(422, 'Название: от 2 символов');
                            foreach ($d['db']['teams'] as $o) if ($o['id'] !== $t['id'] && mb_strtolower($o['name']) === mb_strtolower($name)) fail(409, 'Команда с таким названием уже есть');
                            $t['name'] = $name;
                        }
                        if (isset($b['tag'])) {
                            $tag = mb_strtoupper(str($b['tag'], 4));
                            if ($tag === '') fail(422, 'Укажите тег команды');
                            $t['tag'] = $tag;
                        }
                        if (preg_match('/^#[0-9a-fA-F]{6}$/', (string)($b['color'] ?? ''))) $t['color'] = strtolower($b['color']);
                        // роли игроков состава без своего аккаунта (у остальных роль — из их профиля)
                        foreach (is_array($b['roles'] ?? null) ? $b['roles'] : [] as $pid => $role) {
                            foreach ($d['db']['players'] as &$p) {
                                if ($p['id'] === (string)$pid && ($p['teamId'] ?? '') === $t['id'] && empty($p['userId'])) {
                                    $r = str($role, 32);
                                    if ($r === '') unset($p['role']);
                                    else $p['role'] = $r;
                                }
                            }
                            unset($p);
                        }
                        $t['about'] = str($b['about'] ?? '', 800);
                        $t['contact'] = str($b['contact'] ?? '', 120);
                        $t['slogan'] = str($b['slogan'] ?? '', 60);
                        $t['founded'] = preg_match('/^(19|20)\d\d$/', (string)($b['founded'] ?? '')) ? (string)$b['founded'] : '';
                        foreach (['slogan', 'founded'] as $k) if ($t[$k] === '') unset($t[$k]);
                        foreach (['playFrom', 'playTo'] as $k) {
                            if (!array_key_exists($k, $b)) continue;
                            if (preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string)$b[$k])) $t[$k] = (string)$b[$k];
                            else unset($t[$k]);
                        }
                        if (array_key_exists('timeNote', $b)) {
                            $tn = str($b['timeNote'], 200);
                            if ($tn !== '') $t['timeNote'] = $tn;
                            else unset($t['timeNote']);
                        }
                        $links = [];
                        foreach (array_slice(is_array($b['links'] ?? null) ? $b['links'] : [], 0, 6) as $l) {
                            $url = str($l['url'] ?? '', 200);
                            if (preg_match('#^https?://#i', $url)) $links[] = ['label' => str($l['label'] ?? '', 40) ?: $url, 'url' => $url];
                        }
                        $t['links'] = $links;
                        $d['rev']++;
                        $changed = true;
                        return $t['id'];
                    }
                }
                fail(404, 'У вас нет команды');
            });
            ok(['ok' => true, 'teamId' => $tid]);

        case 'POST ask':
            csrf();
            $b = body();
            if (!empty($b['website'])) ok(['ok' => true]); // ловушка для ботов
            rateLimit('ask', 5);
            if ((int)q('SELECT COUNT(*) FROM questions WHERE answer IS NULL')->fetchColumn() > 300) fail(503, 'Слишком много неотвеченных вопросов');
            q('INSERT INTO questions (id, user_id, name, contact, text, created_at) VALUES (?,?,?,?,?,?)', [
                uid('q'), currentUserId() ?? '', str($b['name'] ?? '', 60), str($b['contact'] ?? '', 120), str($b['text'] ?? '', 1000, true), now(),
            ]);
            ok(['ok' => true]);

        case 'GET faqq':
            ok(array_map(fn($r) => ['id' => $r['id'], 'q' => $r['text'], 'a' => $r['answer'], 'at' => iso($r['answered_at'])], q("SELECT * FROM questions WHERE published=1 AND answer IS NOT NULL ORDER BY answered_at DESC LIMIT 100")->fetchAll()));

        case 'GET questions':
            requireAdmin();
            ok(array_map(fn($r) => ['id' => $r['id'], 'name' => $r['name'], 'contact' => $r['contact'], 'text' => $r['text'], 'answer' => $r['answer'], 'published' => (bool)$r['published'], 'createdAt' => iso($r['created_at'])], q('SELECT * FROM questions ORDER BY (answer IS NULL) DESC, created_at DESC LIMIT 300')->fetchAll()));

        case 'POST answerq':
            requireAdmin();
            $b = body();
            $a = mb_substr(trim((string)($b['answer'] ?? '')), 0, 2000);
            q('UPDATE questions SET answer=?, published=?, answered_at=? WHERE id=?', [$a === '' ? null : $a, $a !== '' && !empty($b['published']) ? 1 : 0, now(), (string)($b['id'] ?? '')]);
            ok(['ok' => true]);

        case 'POST delq':
            requireAdmin();
            q('DELETE FROM questions WHERE id=?', [(string)(body()['id'] ?? '')]);
            ok(['ok' => true]);

        case 'POST claimteam':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'login required');
            $want = (string)(body()['team'] ?? '');
            needDiscord($uid);
            $nick = mb_strtolower(trim((string)q('SELECT nick FROM users WHERE id=?', [$uid])->fetchColumn()));
            docTx(function (&$d, &$changed) use ($uid, $want, $nick) {
                $db = &$d['db'];
                foreach ($db['teams'] as $t) {
                    if ($t['id'] !== $want) continue;
                    if (canManageTeam($db, $t, $uid)) fail(409, 'Это уже ваша команда');
                    $ci = null;
                    foreach ($db['players'] as $i => $p) if ($p['id'] === ($t['captainId'] ?? '')) $ci = $i;
                    if (!empty($t['ownerId']) || ($ci !== null && !empty($db['players'][$ci]['userId']))) fail(409, 'У команды уже есть управляющий. Если это ошибка, напишите организатору');
                    if ($ci === null) {
                        // организатор не назначил капитана: капитаном становится тот, чей ник есть в составе
                        foreach ($db['players'] as $i => $p) if (($p['teamId'] ?? '') === $t['id'] && empty($p['userId']) && $nick !== '' && $nick === mb_strtolower(trim($p['nick']))) $ci = $i;
                        if ($ci === null) fail(403, 'Вашего ника из профиля нет в составе команды. Поправьте ник в «Профиле» или напишите организатору');
                    }
                    $cap = $db['players'][$ci];
                    if ($nick === '' || $nick !== mb_strtolower(trim($cap['nick']))) fail(403, 'Ник в профиле должен совпадать с ником капитана в составе: «' . $cap['nick'] . '»');
                    foreach ($db['teams'] as &$tt) if ($tt['id'] === $t['id']) $tt['captainId'] = $cap['id'];
                    unset($tt);
                    $mine = userCard($db, $uid);
                    if ($mine !== null && !empty($db['players'][$mine]['teamId'])) fail(409, 'Ваша карточка уже в другой команде');
                    // своя карточка без команды (создана профилем) сливается в карточку капитана
                    $db['players'] = array_values(array_filter($db['players'], fn($p) => !(($p['userId'] ?? '') === $uid && empty($p['teamId']))));
                    foreach ($db['players'] as &$p) if ($p['id'] === $cap['id']) $p['userId'] = $uid;
                    unset($p);
                    $d['rev']++;
                    $changed = true;
                    return;
                }
                fail(404, 'Команда не найдена');
            });
            ok(['ok' => true]);

        case 'GET users':
            requireAdmin();
            ok(array_map('publicUser', q('SELECT * FROM users ORDER BY created_at DESC')->fetchAll()));

        case 'POST resetpw':
            requireAdmin();
            $b = body();
            $pw = (string)($b['password'] ?? '');
            if (mb_strlen($pw) < 8 || mb_strlen($pw) > 128) fail(422, 'Пароль: от 8 символов');
            $st = q('UPDATE users SET pass_hash=? WHERE id=?', [password_hash($pw, PASSWORD_DEFAULT), (string)($b['id'] ?? '')]);
            if ($st->rowCount() === 0) fail(404, 'not found');
            ok(['ok' => true]);

        case 'POST banuser':
            requireAdmin();
            $b = body();
            q('UPDATE users SET banned=? WHERE id=?', [!empty($b['banned']) ? 1 : 0, (string)($b['id'] ?? '')]);
            ok(['ok' => true]);

        case 'POST setbadges':
            requireAdmin();
            $b = body();
            $list = array_values(array_intersect(BADGES, (array)($b['badges'] ?? [])));
            q('UPDATE users SET badges=? WHERE id=?', [$list ? json_encode($list) : null, (string)($b['id'] ?? '')]);
            $u = q('SELECT * FROM users WHERE id=?', [(string)($b['id'] ?? '')])->fetch();
            if ($u) syncUserPlayer($u);
            ok(['ok' => true]);

        case 'POST setorg':
            requireAdmin();
            $b = body();
            q('UPDATE users SET org_id=? WHERE id=?', [str($b['orgId'] ?? '', 64), (string)($b['id'] ?? '')]);
            $u = q('SELECT * FROM users WHERE id=?', [(string)($b['id'] ?? '')])->fetch();
            if ($u) syncUserPlayer($u);
            ok(['ok' => true]);

        case 'POST deluser':
            requireAdmin();
            q('DELETE FROM users WHERE id=?', [(string)(body()['id'] ?? '')]);
            ok(['ok' => true]);

        case 'POST apply':
            $b = body();
            if (!empty($b['website'])) ok(['ok' => true]); // ловушка для ботов
            $set = (array)docRead()['db']['settings'];
            if (($set['registrationOpen'] ?? true) === false) fail(403, 'Приём заявок сейчас закрыт');
            $uid = currentUserId() ?? '';
            if ($uid !== '') needDiscord($uid);
            $id = insertApplication($b, $uid);
            $res = ['ok' => true, 'id' => $id];
            // с аккаунтом заявка проходит сама, без анкеты у организатора; без аккаунта остаётся на модерации
            if ($uid !== '' && ($set['autoApprove'] ?? true) !== false) {
                try {
                    $createdId = applyApplication(appOut(q('SELECT * FROM applications WHERE id=?', [$id])->fetch()), true);
                    if (($b['kind'] ?? '') === 'organization') $res['orgId'] = $createdId;
                    elseif (($b['kind'] ?? '') === 'team') $res['teamId'] = $createdId;
                } catch (Throwable $e) {
                    q('DELETE FROM applications WHERE id=?', [$id]);
                    throw $e;
                }
                q("UPDATE applications SET status='approved', decided_at=?, note='авто' WHERE id=?", [now(), $id]);
                $res['auto'] = true;
            }
            fxAppNotify($id, !empty($res['auto']));
            ok($res);

        case 'GET applications':
            requireAdmin();
            ok(array_map('appOut', q('SELECT * FROM applications ORDER BY created_at DESC, id DESC')->fetchAll()));

        case 'POST decide':
            requireAdmin();
            $b = body();
            $id = (string)($b['id'] ?? '');
            $action = ($b['action'] ?? '') === 'approve' ? 'approve' : 'reject';
            $a = q('SELECT * FROM applications WHERE id=?', [$id])->fetch();
            if (!$a) fail(404, 'not found');
            if ($a['status'] !== 'pending') fail(409, 'Заявка уже обработана');
            $app = appOut($a);
            if ($action === 'approve') applyApplication($app, false);
            q('UPDATE applications SET status=?, decided_at=?, note=? WHERE id=? AND status=\'pending\'', [$action === 'approve' ? 'approved' : 'rejected', now(), str($b['note'] ?? '', 300), $id]);
            ok(['ok' => true]);

        case 'GET twitch':
            $channels = array_slice(array_filter(array_map(fn($c) => strtolower(preg_replace('/[^a-z0-9_]/i', '', $c)), explode(',', (string)($_GET['channels'] ?? '')))), 0, 20);
            if (!$channels) ok(['configured' => true, 'streams' => []]);
            if (empty($CFG['twitch_client_id']) || empty($CFG['twitch_client_secret'])) ok(['configured' => false, 'streams' => []]);
            $cacheKey = 'streams:' . implode(',', $channels);
            $c = q('SELECT v FROM kv WHERE k=? AND exp>?', [$cacheKey, time()])->fetchColumn();
            if ($c !== false) ok(['configured' => true, 'streams' => json_decode($c, true)]);
            $token = q('SELECT v FROM kv WHERE k=? AND exp>?', ['twitch-token', time() + 60])->fetchColumn();
            if ($token === false) {
                $ch = curl_init('https://id.twitch.tv/oauth2/token');
                curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_POSTFIELDS => http_build_query([
                    'client_id' => $CFG['twitch_client_id'], 'client_secret' => $CFG['twitch_client_secret'], 'grant_type' => 'client_credentials',
                ])]);
                $res = json_decode((string)curl_exec($ch), true);
                if (empty($res['access_token'])) fail(502, 'twitch auth failed');
                $token = $res['access_token'];
                q('REPLACE INTO kv (k, v, exp) VALUES (?,?,?)', ['twitch-token', $token, time() + (int)$res['expires_in']]);
            }
            $qs = implode('&', array_map(fn($c) => 'user_login=' . urlencode($c), $channels));
            $ch = curl_init("https://api.twitch.tv/helix/streams?$qs");
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_HTTPHEADER => ['Client-Id: ' . $CFG['twitch_client_id'], "Authorization: Bearer $token"]]);
            $res = json_decode((string)curl_exec($ch), true);
            $streams = array_map(fn($s) => [
                'channel' => strtolower($s['user_login']),
                'title' => $s['title'],
                'game' => $s['game_name'],
                'viewers' => $s['viewer_count'],
                'startedAt' => $s['started_at'],
                'thumbnail' => str_replace(['{width}', '{height}'], ['640', '360'], $s['thumbnail_url']),
            ], $res['data'] ?? []);
            q('DELETE FROM kv WHERE exp < ? AND k LIKE ?', [time(), 'streams:%']);
            q('REPLACE INTO kv (k, v, exp) VALUES (?,?,?)', [$cacheKey, json_encode($streams, JSON_UNESCAPED_UNICODE), time() + 60]);
            ok(['configured' => true, 'streams' => $streams]);

        default:
            fxRoute("$method $r");
            fail(404, 'unknown route');
    }
} catch (ApiError $e) {
    http_response_code($e->status);
    echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('cup api: ' . $e);
    http_response_code(500);
    echo json_encode(['error' => 'internal error']);
}
