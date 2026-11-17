<?php
declare(strict_types=1);

/*
 * Турнирные функции поверх документа сайта: режим «только чтение» на резервном сервере, чек-ин,
 * отчёты капитанов со скриншотом, игры из OpenDota, уведомления в Discord/Telegram, превью для соцсетей,
 * статистика турнира, уровень FACEIT из браузера. Подключается из index.php:
 * маршруты — fxRoute(), консольные команды (cron, failover-watch) — fxCli().
 */

const FX_EVENTS = [
    'apps' => 'Новые заявки',
    'results' => 'Результаты матчей',
    'soon' => 'Матч через 15 минут',
    'checkin' => 'Чек-ин и технические поражения',
    'reports' => 'Отчёты капитанов и споры',
    'failover' => 'Переключение на резервный сервер',
    'monitor' => 'Мониторинг серверов и бэкапов',
    'picks' => 'Жеребьёвка и выбор сторон',
];
const FX_SHOT_MAX = 1_400_000;
const FX_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FX_FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function readonlyMode(): bool
{
    global $CFG;
    return !empty($CFG['readonly']);
}

function fxSite(): string
{
    global $CFG;
    return rtrim((string)($CFG['site_url'] ?? 'https://cup.rut-miit.su'), '/');
}

function fxTz(): DateTimeZone
{
    global $CFG;
    return new DateTimeZone((string)($CFG['tz'] ?? 'Europe/Moscow'));
}

/** Начало матча: строка datetime-local (время Москвы) → unix, null если время не задано. */
function matchTs(?string $date): ?int
{
    if (!$date || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/', $date)) return null;
    $dt = DateTime::createFromFormat('!Y-m-d\TH:i', substr($date, 0, 16), fxTz());
    return $dt ? $dt->getTimestamp() : null;
}

function fxTime(int $ts, string $fmt = 'd.m H:i'): string
{
    return (new DateTime('@' . $ts))->setTimezone(fxTz())->format($fmt);
}

// ---------- сетка: порт src/lib/bracket.ts (кто играет в слоте) ----------

function fxDefs(array $st): array
{
    $size = (int)($st['size'] ?? 0);
    if ($size < 2) return [];
    $k = (int)round(log($size, 2));
    $defs = [];
    if (($st['type'] ?? '') === 'single') {
        for ($r = 1; $r <= $k; $r++) {
            $count = intdiv($size, 2 ** $r);
            for ($m = 1; $m <= $count; $m++) {
                $prev = fn(int $i) => 'R' . ($r - 1) . "-$i";
                $defs[] = [
                    'key' => $r === $k ? 'F' : "R$r-$m", 'final' => $r === $k,
                    'a' => $r === 1 ? ['seed', 2 * $m - 2] : ['winner', $prev(2 * $m - 1)],
                    'b' => $r === 1 ? ['seed', 2 * $m - 1] : ['winner', $prev(2 * $m)],
                ];
            }
        }
        if (!empty($st['thirdPlace']) && $k >= 2) $defs[] = ['key' => '3RD', 'final' => false, 'a' => ['loser', 'R' . ($k - 1) . '-1'], 'b' => ['loser', 'R' . ($k - 1) . '-2']];
        return $defs;
    }
    for ($r = 1; $r <= $k; $r++) {
        $count = intdiv($size, 2 ** $r);
        for ($m = 1; $m <= $count; $m++) {
            $defs[] = [
                'key' => "UB$r-$m", 'final' => false,
                'a' => $r === 1 ? ['seed', 2 * $m - 2] : ['winner', 'UB' . ($r - 1) . '-' . (2 * $m - 1)],
                'b' => $r === 1 ? ['seed', 2 * $m - 1] : ['winner', 'UB' . ($r - 1) . '-' . (2 * $m)],
            ];
        }
    }
    for ($i = 1; $i <= $k - 1; $i++) {
        $count = intdiv($size, 2 ** ($i + 1));
        $odd = 2 * $i - 1;
        $even = 2 * $i;
        for ($m = 1; $m <= $count; $m++) {
            $defs[] = [
                'key' => "LB$odd-$m", 'final' => false,
                'a' => $i === 1 ? ['loser', 'UB1-' . (2 * $m - 1)] : ['winner', 'LB' . ($odd - 1) . '-' . (2 * $m - 1)],
                'b' => $i === 1 ? ['loser', 'UB1-' . (2 * $m)] : ['winner', 'LB' . ($odd - 1) . '-' . (2 * $m)],
            ];
        }
        for ($m = 1; $m <= $count; $m++) {
            $defs[] = ['key' => "LB$even-$m", 'final' => false, 'a' => ['winner', "LB$odd-$m"], 'b' => ['loser', 'UB' . ($i + 1) . '-' . ($count + 1 - $m)]];
        }
    }
    $defs[] = ['key' => 'GF', 'final' => true, 'a' => ['winner', "UB$k-1"], 'b' => ['winner', 'LB' . (2 * ($k - 1)) . '-1']];
    return $defs;
}

function fxResolve(array $st, array $recs): array
{
    $by = [];
    foreach ($recs as $r) $by[$r['key']] = $r;
    $seeds = is_array($st['seeds'] ?? null) ? $st['seeds'] : [];
    $done = [];
    $take = function (array $src) use (&$done, $seeds) {
        if ($src[0] === 'seed') return $seeds[$src[1]] ?? null;
        $m = $done[$src[1]] ?? null;
        return $m ? ($src[0] === 'winner' ? $m['winner'] : $m['loser']) : null;
    };
    foreach (fxDefs($st) as $def) {
        $a = $take($def['a']);
        $b = $take($def['b']);
        $rec = $by[$def['key']] ?? null;
        $bo = $def['final'] ? (int)($st['finalBo'] ?? $st['bo'] ?? 1) : (int)($st['bo'] ?? 1);
        $w = $l = null;
        $status = 'waiting';
        if ($a === 'BYE' || $b === 'BYE') {
            if ($a === 'BYE' && $b === 'BYE') [$w, $l, $status] = ['BYE', 'BYE', 'bye'];
            elseif ($a === 'BYE' && $b) [$w, $l, $status] = [$b, 'BYE', 'bye'];
            elseif ($b === 'BYE' && $a) [$w, $l, $status] = [$a, 'BYE', 'bye'];
        } elseif ($a && $b) {
            $status = $rec['status'] ?? 'scheduled';
            if ($status === 'finished' && isset($rec['scoreA'], $rec['scoreB']) && $rec['scoreA'] !== $rec['scoreB']) {
                $aw = $rec['scoreA'] > $rec['scoreB'];
                [$w, $l] = $aw ? [$a, $b] : [$b, $a];
            }
        }
        $done[$def['key']] = ['key' => $def['key'], 'a' => $a, 'b' => $b, 'bo' => $bo, 'rec' => $rec, 'status' => $status, 'winner' => $w, 'loser' => $l];
    }
    return $done;
}

/** Все матчи с известными соперниками: "tid|sid|key" => описание. */
function fxMatches(array $db, ?string $tid = null): array
{
    $out = [];
    foreach ($db['tournaments'] as $t) {
        if ($tid !== null && $t['id'] !== $tid) continue;
        foreach ($t['stages'] ?? [] as $st) {
            $recs = array_values(array_filter($db['matches'], fn($m) => ($m['tournamentId'] ?? '') === $t['id'] && ($m['stageId'] ?? '') === $st['id']));
            $rows = [];
            if (($st['type'] ?? '') === 'groups') {
                foreach ($recs as $r) if (!empty($r['teamA']) && !empty($r['teamB'])) $rows[] = ['key' => $r['key'], 'a' => $r['teamA'], 'b' => $r['teamB'], 'bo' => (int)($st['bo'] ?? 1), 'rec' => $r, 'status' => $r['status'] ?? 'scheduled', 'group' => true];
            } else {
                foreach (fxResolve($st, $recs) as $m) if ($m['a'] && $m['b'] && $m['a'] !== 'BYE' && $m['b'] !== 'BYE') $rows[] = $m + ['group' => false];
            }
            foreach ($rows as $m) {
                $m += ['tid' => $t['id'], 'sid' => $st['id'], 'tour' => $t['short'] ?? $t['name'], 'stage' => $st['name'] ?? ''];
                $m['ts'] = matchTs($m['rec']['date'] ?? null);
                $m['mid'] = sha1("{$m['tid']}|{$m['sid']}|{$m['key']}");
                $out["{$m['tid']}|{$m['sid']}|{$m['key']}"] = $m;
            }
        }
    }
    return $out;
}

function fxFind(array $db, string $t, string $s, string $k): array
{
    $m = fxMatches($db, $t)["$t|$s|$k"] ?? null;
    if (!$m) fail(404, 'Матч не найден или соперники ещё не определены');
    return $m;
}

function fxTeam(array $db, ?string $id): array
{
    foreach ($db['teams'] as $t) if ($t['id'] === $id) return $t;
    return ['id' => (string)$id, 'name' => 'TBD', 'tag' => ''];
}

function fxName(array $db, ?string $id): string
{
    return fxTeam($db, $id)['name'];
}

/** За какую сторону матча пользователь может действовать: 'a', 'b' или null. */
function fxSide(array $db, array $m, ?string $uid): ?string
{
    if (!$uid) return null;
    if (canManageTeam($db, fxTeam($db, $m['a']), $uid)) return 'a';
    if (canManageTeam($db, fxTeam($db, $m['b']), $uid)) return 'b';
    return null;
}

function fxTitle(array $db, array $m): string
{
    return fxName($db, $m['a']) . ' — ' . fxName($db, $m['b']) . " ({$m['tour']}" . ($m['stage'] !== '' ? ", {$m['stage']}" : '') . ')';
}

function fxLink(array $m): string
{
    return fxSite() . '/api/?r=share&m=' . rawurlencode("{$m['tid']}|{$m['sid']}|{$m['key']}");
}

/** Счёт серии допустим: в сетке ничьих нет, кто-то набрал побед до конца серии. */
function fxCheckScore(array $m, int $sa, int $sb): void
{
    $bo = max(1, $m['bo']);
    $win = intdiv($bo, 2) + 1;
    if ($sa < 0 || $sb < 0 || $sa + $sb > $bo) fail(422, "Счёт не подходит для Bo$bo");
    if ($m['group']) {
        if (max($sa, $sb) < $win && $sa + $sb !== $bo) fail(422, "Серия Bo$bo не доиграна");
        return;
    }
    if (max($sa, $sb) !== $win || min($sa, $sb) >= $win) fail(422, "В Bo$bo победитель набирает $win");
}

/** Меняет запись матча в документе (rev++ — открытый черновик админа получит конфликт) и сообщает о новом результате. */
function fxSetResult(array $m, array $patch): void
{
    $doc = docTx(function (&$d, &$changed) use ($m, $patch) {
        $old = $d['db'];
        $found = false;
        foreach ($d['db']['matches'] as &$r) {
            if (($r['tournamentId'] ?? '') === $m['tid'] && ($r['stageId'] ?? '') === $m['sid'] && ($r['key'] ?? '') === $m['key']) {
                $r = array_merge($r, $patch);
                $found = true;
            }
        }
        unset($r);
        if (!$found) $d['db']['matches'][] = ['tournamentId' => $m['tid'], 'stageId' => $m['sid'], 'key' => $m['key']] + $patch;
        $d['rev']++;
        $d['updatedAt'] = gmdate('c');
        $changed = true;
        $GLOBALS['FX_OLD_DB'] = $old;
        return $d;
    });
    snapshot($doc);
    fxAfterPublish($GLOBALS['FX_OLD_DB'], $doc['db']);
}

/** Уведомления о результатах, которые появились или изменились при публикации. */
function fxAfterPublish(?array $old, array $new): void
{
    if (!$old) return;
    fx2LogDiff($old, $new);
    $was = fxMatches($old);
    foreach (fxMatches($new) as $id => $m) {
        $r = $m['rec'];
        if (($r['status'] ?? '') !== 'finished' || !isset($r['scoreA'], $r['scoreB'])) continue;
        $o = $was[$id]['rec'] ?? null;
        if ($o && ($o['status'] ?? '') === 'finished' && ($o['scoreA'] ?? null) === $r['scoreA'] && ($o['scoreB'] ?? null) === $r['scoreB']) continue;
        if (!fxOnce("n:res:{$m['mid']}:{$r['scoreA']}:{$r['scoreB']}", 30 * 86400)) continue;
        notify('results', "🏁 {$m['tour']}" . ($m['stage'] !== '' ? " · {$m['stage']}" : '') . ': ' . fxName($new, $m['a']) . " {$r['scoreA']}:{$r['scoreB']} " . fxName($new, $m['b']) . (!empty($r['note']) ? "\n{$r['note']}" : ''), fxLink($m));
    }
}

/** true только при первом вызове с этим ключом за $ttl секунд (защита от повторных уведомлений). */
function fxOnce(string $k, int $ttl): bool
{
    q('DELETE FROM kv WHERE k=? AND exp<?', [$k, time()]);
    return q('INSERT IGNORE INTO kv (k, v, exp) VALUES (?,?,?)', [$k, '1', time() + $ttl])->rowCount() === 1;
}

// ---------- уведомления: Discord webhook и Telegram-бот ----------

function hooksCfg(): array
{
    $h = kvGet('cfg:hooks');
    $h = (is_array($h) ? $h : []) + ['discord' => '', 'tgToken' => '', 'tgChat' => '', 'events' => [], 'backupDiscord' => '', 'backupTgChat' => ''];
    $h['events'] = (array)$h['events'];
    return $h;
}

/** Ставит сообщение в очередь; отправка после ответа клиенту (внешние API медленные). */
function notify(string $ev, string $text, ?string $url = null): void
{
    static $queue = null;
    $h = hooksCfg();
    if (($h['events'][$ev] ?? true) === false) return;
    if ($h['discord'] === '' && ($h['tgToken'] === '' || $h['tgChat'] === '')) return;
    if ($queue === null) {
        $queue = [];
        register_shutdown_function(function () use (&$queue, $h) {
            if (PHP_SAPI !== 'cli') {
                if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
                if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
            }
            foreach ($queue as [$t, $u]) {
                try {
                    hooksSend($h, $t, $u);
                } catch (Throwable $e) {
                    error_log('cup notify: ' . $e->getMessage());
                }
            }
        });
    }
    $queue[] = [$text, $url];
}

function httpPost(string $url, array $json): array
{
    global $CFG;
    $ch = curl_init($url);
    $o = [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_USERAGENT => 'cup-league/1.0',
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_POSTFIELDS => json_encode($json, JSON_UNESCAPED_UNICODE),
    ];
    if (!empty($CFG['hooks_proxy'])) $o[CURLOPT_PROXY] = (string)$CFG['hooks_proxy'];
    curl_setopt_array($ch, $o);
    $body = (string)curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    return ['code' => $code, 'info' => $code ? mb_substr($body, 0, 200) : curl_error($ch)];
}

function hooksSend(array $h, string $text, ?string $url): array
{
    $full = $url ? "$text\n$url" : $text;
    $res = [];
    if ($h['discord'] !== '') $res['discord'] = httpPost($h['discord'], ['content' => mb_substr($full, 0, 1900), 'allowed_mentions' => ['parse' => []]]);
    if ($h['tgToken'] !== '' && $h['tgChat'] !== '') $res['telegram'] = httpPost("https://api.telegram.org/bot{$h['tgToken']}/sendMessage", ['chat_id' => $h['tgChat'], 'text' => mb_substr($full, 0, 4000)]);
    return $res;
}

function fxAppNotify(string $id, bool $auto): void
{
    $a = q('SELECT * FROM applications WHERE id=?', [$id])->fetch();
    if (!$a) return;
    $what = $a['kind'] === 'team' ? "команда {$a['team_name']} [{$a['team_tag']}]" : "игрок {$a['nick']}";
    notify('apps', ($auto ? '🆕 Зарегистрирована ' : '📝 Заявка на модерации: ') . $what, fxSite() . ($auto ? '/#/teams' : '/#/admin'));
}

// ---------- игры Dota 2 из OpenDota ----------

/** Сокращённые данные матча OpenDota: стороны, герои, KDA игроков, MVP победившей команды. */
function fxGameData(array $od): array
{
    $ps = [];
    foreach ($od['players'] ?? [] as $p) {
        $ps[] = [
            'acc' => (int)($p['account_id'] ?? 0), 'rad' => (int)($p['player_slot'] ?? 0) < 128, 'hero' => (int)($p['hero_id'] ?? 0),
            'name' => mb_substr((string)($p['personaname'] ?? ''), 0, 32),
            'k' => (int)($p['kills'] ?? 0), 'd' => (int)($p['deaths'] ?? 0), 'a' => (int)($p['assists'] ?? 0),
            'lh' => (int)($p['last_hits'] ?? 0), 'gpm' => (int)($p['gold_per_min'] ?? 0), 'xpm' => (int)($p['xp_per_min'] ?? 0),
            'dmg' => (int)($p['hero_damage'] ?? 0), 'nw' => (int)($p['net_worth'] ?? 0),
        ];
    }
    $radWin = !empty($od['radiant_win']);
    $mvp = null;
    $best = -INF;
    foreach ($ps as $p) {
        if ($p['rad'] !== $radWin) continue;
        $score = $p['k'] * 3 + $p['a'] * 1.5 - $p['d'] * 2 + $p['gpm'] / 60 + $p['dmg'] / 2500;
        if ($score > $best) [$best, $mvp] = [$score, $p['acc'] ?: $p['hero']];
    }
    return [
        'radiantWin' => $radWin, 'duration' => (int)($od['duration'] ?? 0), 'start' => (int)($od['start_time'] ?? 0),
        'score' => [(int)($od['radiant_score'] ?? 0), (int)($od['dire_score'] ?? 0)], 'players' => $ps, 'mvp' => $mvp,
    ];
}

/** Загружает игру по match_id и привязывает к матчу турнира. $radiant: 'a'|'b' — кто играл за Radiant, если не определилось по Steam. */
function fxAddGame(array $db, array $m, int $matchId, ?string $radiant): array
{
    $other = q('SELECT mid, team_radiant FROM match_games WHERE match_id=?', [$matchId])->fetch();
    if ($other && $other['mid'] !== $m['mid']) fail(409, 'Эта игра уже привязана к другому матчу');
    // повторная загрузка той же игры сохраняет стороны, если их не указали заново
    if ($other && $radiant === null) $radiant = $other['team_radiant'] === $m['a'] ? 'a' : 'b';
    $od = fetchMany(['m' => "https://api.opendota.com/api/matches/$matchId"], 25)['m'];
    if (!is_array($od) || empty($od['players'])) fail(502, 'OpenDota не отдала игру: проверьте Match ID или повторите через пару минут, пока матч обрабатывается');
    $g = fxGameData($od);
    $byAcc = [];
    foreach ($db['players'] as $p) if (!empty($p['steamId']) && in_array($p['teamId'] ?? '', [$m['a'], $m['b']], true)) $byAcc[(int)$p['steamId']] = $p['teamId'];
    $cnt = [$m['a'] => 0, $m['b'] => 0];
    foreach ($g['players'] as $p) if (isset($byAcc[$p['acc']])) $cnt[$byAcc[$p['acc']]] += $p['rad'] ? 1 : -1;
    if ($radiant === 'a' || $radiant === 'b') $rad = $m[$radiant];
    elseif ($cnt[$m['a']] !== $cnt[$m['b']]) $rad = $cnt[$m['a']] > $cnt[$m['b']] ? $m['a'] : $m['b'];
    else fail(422, 'Не удалось определить стороны по Steam игроков: укажите, кто играл за Radiant');
    $dire = $rad === $m['a'] ? $m['b'] : $m['a'];
    $g['radiant'] = $rad;
    $g['dire'] = $dire;
    q('REPLACE INTO match_games (match_id, mid, tid, sid, mkey, team_radiant, team_dire, winner, data, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
        $matchId, $m['mid'], $m['tid'], $m['sid'], $m['key'], $rad, $dire, $g['radiantWin'] ? $rad : $dire, json_encode($g, JSON_UNESCAPED_UNICODE), now(),
    ]);
    q('DELETE FROM kv WHERE k=?', ["fx:ts:{$m['tid']}"]);
    return $g;
}

/** Пересчёт серии по привязанным играм: счёт, карты-игры, статус. Сыгранный матч не откатывается в live. */
function fxRecalc(array $m): void
{
    $rows = q('SELECT match_id, winner, data FROM match_games WHERE mid=? ORDER BY JSON_VALUE(data, "$.start"), match_id', [$m['mid']])->fetchAll();
    $sa = $sb = 0;
    $maps = [];
    foreach ($rows as $i => $r) {
        $aw = $r['winner'] === $m['a'];
        $aw ? $sa++ : $sb++;
        $maps[] = ['name' => 'Игра ' . ($i + 1), 'a' => $aw ? 1 : 0, 'b' => $aw ? 0 : 1, 'matchId' => (int)$r['match_id']];
    }
    $win = intdiv(max(1, $m['bo']), 2) + 1;
    $patch = ['maps' => $maps];
    if ($rows && ($m['rec']['status'] ?? '') !== 'finished') {
        $patch += ['scoreA' => $sa, 'scoreB' => $sb, 'status' => (max($sa, $sb) >= $win || $sa + $sb >= $m['bo']) ? 'finished' : 'live'];
    }
    if (!$rows) $patch = ['maps' => []];
    $GLOBALS['FX_SRC'] = 'opendota';
    fxSetResult($m, $patch);
}

/** Импорт игр из отчётов капитанов после ответа (OpenDota отвечает до 25 с). */
function fxImportLater(array $m, array $ids): void
{
    if (!$ids) return;
    register_shutdown_function(function () use ($m, $ids) {
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        $db = docRead()['db'];
        foreach ($ids as $id) {
            try {
                fxAddGame($db, $m, (int)$id, null);
            } catch (Throwable) {
            }
        }
        try {
            fxRecalc(fxFind(docRead()['db'], $m['tid'], $m['sid'], $m['key']));
        } catch (Throwable) {
        }
    });
}

function fxMatchIds(mixed $v): array
{
    preg_match_all('/\b(\d{9,12})\b/', is_string($v) ? $v : implode(' ', array_map('strval', (array)$v)), $mm);
    return array_slice(array_values(array_unique($mm[1])), 0, 7);
}

// ---------- превью для соцсетей (Open Graph) ----------

function fxShareTarget(array $db): array
{
    if (isset($_GET['m'])) {
        $p = explode('|', (string)$_GET['m'], 3);
        if (count($p) !== 3) fail(404, 'not found');
        $all = fxMatches($db, $p[0]);
        $m = $all[implode('|', $p)] ?? null;
        if (!$m) fail(404, 'not found');
        $r = $m['rec'] ?? [];
        $score = isset($r['scoreA'], $r['scoreB']) && in_array($r['status'] ?? '', ['live', 'finished'], true) ? "{$r['scoreA']}:{$r['scoreB']}" : '';
        $when = $m['ts'] ? fxTime($m['ts']) . ' МСК' : '';
        $st = ['finished' => 'Матч завершён', 'live' => 'Идёт сейчас'][$r['status'] ?? ''] ?? ($when !== '' ? "Начало $when" : 'Время уточняется');
        return [
            'kind' => 'match', 'a' => fxTeam($db, $m['a']), 'b' => fxTeam($db, $m['b']), 'score' => $score, 'status' => $st,
            'title' => fxName($db, $m['a']) . ($score !== '' ? " $score " : ' vs ') . fxName($db, $m['b']),
            'desc' => "{$m['tour']}" . ($m['stage'] !== '' ? " · {$m['stage']}" : '') . " · Bo{$m['bo']} · $st",
            'top' => "{$m['tour']}" . ($m['stage'] !== '' ? " · {$m['stage']}" : ''),
            'hash' => "/t/{$m['tid']}/m/{$m['sid']}/{$m['key']}", 'q' => 'm=' . rawurlencode(implode('|', $p)), 'v' => substr(sha1($score . $st), 0, 8),
        ];
    }
    if (isset($_GET['team'])) {
        $t = null;
        foreach ($db['teams'] as $x) if ($x['id'] === (string)$_GET['team']) $t = $x;
        if (!$t) fail(404, 'not found');
        $roster = array_values(array_map(fn($p) => $p['nick'], array_filter($db['players'], fn($p) => ($p['teamId'] ?? '') === $t['id'])));
        $lv = array_filter(array_map(fn($p) => (int)($p['faceitLevel'] ?? 0), array_filter($db['players'], fn($p) => ($p['teamId'] ?? '') === $t['id'])));
        return [
            'kind' => 'team', 'a' => $t, 'roster' => $roster, 'title' => $t['name'] . (($t['tag'] ?? '') !== '' ? " [{$t['tag']}]" : ''),
            'desc' => 'Состав: ' . ($roster ? implode(', ', $roster) : 'не заявлен') . ($lv ? ' · средний FACEIT ' . round(array_sum($lv) / count($lv), 1) : ''),
            'top' => 'Команда', 'hash' => "/teams/{$t['id']}", 'q' => 'team=' . rawurlencode($t['id']), 'v' => substr(sha1(implode(',', $roster) . ($t['logo'] ?? '')), 0, 8),
        ];
    }
    $t = null;
    foreach ($db['tournaments'] as $x) if ($x['id'] === (string)($_GET['t'] ?? '')) $t = $x;
    if (!$t) fail(404, 'not found');
    $st = ['upcoming' => 'Скоро', 'registration' => 'Идёт регистрация', 'live' => 'Идёт турнир', 'finished' => 'Турнир завершён'][$t['status']] ?? '';
    return [
        'kind' => 'tour', 'title' => $t['name'], 'status' => $st, 'teams' => count($t['teams'] ?? []), 'max' => (int)($t['maxTeams'] ?? 0), 'prize' => (string)($t['prize'] ?? ''),
        'desc' => "$st · команд: " . count($t['teams'] ?? []) . '/' . (int)($t['maxTeams'] ?? 0) . (($t['prize'] ?? '') !== '' ? " · призовой фонд {$t['prize']}" : ''),
        'top' => 'Турнир', 'hash' => "/t/{$t['id']}", 'q' => 't=' . rawurlencode($t['id']), 'v' => substr(sha1($st . count($t['teams'] ?? [])), 0, 8),
    ];
}

function fxSharePage(array $db): never
{
    $x = fxShareTarget($db);
    $e = fn(string $s) => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $site = fxSite();
    $to = "$site/#{$x['hash']}";
    $img = "$site/api/?r=ogimg&{$x['q']}&v={$x['v']}";
    $self = "$site/api/?r=share&{$x['q']}";
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: public, max-age=300');
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>', $e($x['title']), ' — Киберлига РУТ (МИИТ)</title>',
        '<meta property="og:type" content="website"><meta property="og:site_name" content="Киберлига РУТ (МИИТ)">',
        '<meta property="og:title" content="', $e($x['title']), '"><meta property="og:description" content="', $e($x['desc']), '">',
        '<meta property="og:url" content="', $e($self), '"><meta property="og:image" content="', $e($img), '">',
        '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image"><meta name="description" content="', $e($x['desc']), '">',
        '<script>location.replace(', json_encode($to, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG), ')</script></head>',
        '<body style="font-family:sans-serif"><p><a href="', $e($to), '">', $e($x['title']), '</a></p></body></html>';
    exit;
}

function fxLogo(?array $t, int $size): ?GdImage
{
    if (!$t || empty($t['id'])) return null;
    $raw = q("SELECT data FROM team_media WHERE team_id=? AND kind='logo'", [$t['id']])->fetchColumn();
    $src = $raw !== false ? @imagecreatefromstring((string)$raw) : false;
    if (!$src) return null;
    $dst = imagecreatetruecolor($size, $size);
    imagealphablending($dst, false);
    imagesavealpha($dst, true);
    imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
    imagealphablending($dst, true);
    $w = imagesx($src);
    $h = imagesy($src);
    $k = min($size / $w, $size / $h);
    $nw = (int)round($w * $k);
    $nh = (int)round($h * $k);
    imagecopyresampled($dst, $src, intdiv($size - $nw, 2), intdiv($size - $nh, 2), 0, 0, $nw, $nh, $w, $h);
    return $dst;
}

function fxHex(GdImage $im, string $hex, int $alpha = 0): int
{
    $hex = preg_match('/^#[0-9a-f]{6}$/i', $hex) ? $hex : '#0054b8';
    return imagecolorallocatealpha($im, hexdec(substr($hex, 1, 2)), hexdec(substr($hex, 3, 2)), hexdec(substr($hex, 5, 2)), $alpha);
}

/** Текст по центру точки $cx, ужимается по ширине до $maxW. */
function fxText(GdImage $im, string $s, float $size, int $cx, int $y, int $color, int $maxW, bool $bold = true): void
{
    $f = $bold ? FX_FONT_B : FX_FONT;
    while ($size > 10) {
        $bb = imagettfbbox($size, 0, $f, $s);
        if ($bb[2] - $bb[0] <= $maxW) break;
        $size -= 2;
    }
    $bb = imagettfbbox($size, 0, $f, $s);
    while ($bb[2] - $bb[0] > $maxW && mb_strlen($s) > 2) {
        $s = mb_substr($s, 0, -2) . '…';
        $bb = imagettfbbox($size, 0, $f, $s);
    }
    imagettftext($im, $size, 0, $cx - intdiv($bb[2] - $bb[0], 2), $y, $color, $f, $s);
}

function fxBadge(GdImage $im, ?array $t, int $cx, int $cy, int $size): void
{
    $logo = fxLogo($t, $size);
    if ($logo) {
        imagecopy($im, $logo, $cx - intdiv($size, 2), $cy - intdiv($size, 2), 0, 0, $size, $size);
        return;
    }
    imagefilledellipse($im, $cx, $cy, $size, $size, fxHex($im, (string)($t['color'] ?? '#0054b8')));
    $tag = (string)(($t['tag'] ?? '') !== '' ? $t['tag'] : mb_substr((string)($t['name'] ?? '?'), 0, 2));
    fxText($im, mb_strtoupper($tag), $size / 4.2, $cx, $cy + (int)($size / 9), imagecolorallocate($im, 255, 255, 255), (int)($size * 0.8));
}

function fxOgImage(array $db): never
{
    $x = fxShareTarget($db);
    $W = 1200;
    $H = 630;
    $im = imagecreatetruecolor($W, $H);
    imageantialias($im, true);
    for ($y = 0; $y < $H; $y++) {
        $k = $y / $H;
        imageline($im, 0, $y, $W, $y, imagecolorallocate($im, (int)(12 + 16 * $k), (int)(22 + 36 * $k), (int)(48 + 92 * $k)));
    }
    imagefilledrectangle($im, 0, 0, $W, 10, fxHex($im, '#0054b8'));
    imagefilledrectangle($im, 0, $H - 70, $W, $H, imagecolorallocatealpha($im, 0, 0, 0, 80));
    $white = imagecolorallocate($im, 255, 255, 255);
    $soft = imagecolorallocate($im, 182, 203, 244);
    fxText($im, mb_strtoupper($x['top']), 26, intdiv($W, 2), 70, $soft, 1100);
    if ($x['kind'] === 'match') {
        fxBadge($im, $x['a'], 260, 270, 230);
        fxBadge($im, $x['b'], $W - 260, 270, 230);
        fxText($im, $x['a']['name'], 34, 260, 450, $white, 380);
        fxText($im, $x['b']['name'], 34, $W - 260, 450, $white, 380);
        fxText($im, $x['score'] !== '' ? str_replace(':', ' : ', $x['score']) : 'VS', $x['score'] !== '' ? 96 : 80, intdiv($W, 2), 310, $white, 340);
        fxText($im, $x['status'], 26, intdiv($W, 2), 530, $soft, 1000, false);
    } elseif ($x['kind'] === 'team') {
        fxBadge($im, $x['a'], 250, 320, 300);
        $name = $x['a']['name'];
        $f = FX_FONT_B;
        $sz = 56;
        while ($sz > 24 && (imagettfbbox($sz, 0, $f, $name)[2] > 640)) $sz -= 4;
        imagettftext($im, $sz, 0, 460, 260, $white, $f, $name);
        if (($x['a']['tag'] ?? '') !== '') imagettftext($im, 30, 0, 460, 320, $soft, $f, '[' . $x['a']['tag'] . ']');
        $y = 380;
        foreach (array_slice($x['roster'], 0, 5) as $n) {
            imagettftext($im, 24, 0, 460, $y, $white, FX_FONT, '• ' . mb_substr($n, 0, 28));
            $y += 36;
        }
    } else {
        fxText($im, $x['title'], 64, intdiv($W, 2), 250, $white, 1080);
        fxText($im, $x['status'], 34, intdiv($W, 2), 340, $soft, 1000, false);
        fxText($im, "Команд: {$x['teams']}/{$x['max']}" . ($x['prize'] !== '' ? " · Призовой фонд {$x['prize']}" : ''), 30, intdiv($W, 2), 420, $white, 1080, false);
    }
    fxText($im, 'КИБЕРЛИГА РУТ (МИИТ) · ' . preg_replace('#^https?://#', '', fxSite()), 22, intdiv($W, 2), $H - 26, $soft, 1100);
    header('Content-Type: image/png');
    header('Cache-Control: public, max-age=600');
    imagepng($im, null, 6);
    exit;
}

// ---------- статистика турнира по играм OpenDota ----------

function fxTourStats(array $db, string $tid): array
{
    $c = kvGet("fx:ts:$tid");
    if (is_array($c)) return $c;
    $rows = q('SELECT match_id, team_radiant, team_dire, data FROM match_games WHERE tid=?', [$tid])->fetchAll();
    $cards = [];
    foreach ($db['players'] as $p) if (!empty($p['steamId'])) $cards[(int)$p['steamId']] = $p;
    $hn = $rows ? dotaHeroes() : [];
    $heroes = $players = [];
    $tot = ['games' => count($rows), 'radiantWins' => 0, 'duration' => 0, 'kills' => 0, 'longest' => null, 'bloodiest' => null];
    foreach ($rows as $r) {
        $g = json_decode((string)$r['data'], true) ?: [];
        if (!empty($g['radiantWin'])) $tot['radiantWins']++;
        $tot['duration'] += (int)($g['duration'] ?? 0);
        $kills = array_sum($g['score'] ?? [0, 0]);
        $tot['kills'] += $kills;
        if (!$tot['longest'] || $g['duration'] > $tot['longest']['duration']) $tot['longest'] = ['matchId' => (int)$r['match_id'], 'duration' => (int)$g['duration']];
        if (!$tot['bloodiest'] || $kills > $tot['bloodiest']['kills']) $tot['bloodiest'] = ['matchId' => (int)$r['match_id'], 'kills' => $kills];
        foreach ($g['players'] ?? [] as $p) {
            $won = $p['rad'] === !empty($g['radiantWin']);
            $h = (string)$p['hero'];
            $heroes[$h] ??= ['id' => (int)$h, 'name' => $hn[$h][0] ?? "#$h", 'img' => $hn[$h][1] ?? '', 'picks' => 0, 'wins' => 0];
            $heroes[$h]['picks']++;
            if ($won) $heroes[$h]['wins']++;
            if (!$p['acc']) continue;
            $card = $cards[$p['acc']] ?? null;
            $key = (string)$p['acc'];
            $players[$key] ??= ['acc' => $p['acc'], 'playerId' => $card['id'] ?? null, 'nick' => $card['nick'] ?? $p['name'], 'teamId' => $card['teamId'] ?? ($p['rad'] ? $r['team_radiant'] : $r['team_dire']), 'games' => 0, 'wins' => 0, 'k' => 0, 'd' => 0, 'a' => 0, 'gpm' => 0, 'xpm' => 0, 'dmg' => 0, 'mvp' => 0, 'heroes' => []];
            $pl = &$players[$key];
            $pl['games']++;
            if ($won) $pl['wins']++;
            foreach (['k', 'd', 'a', 'gpm', 'xpm', 'dmg'] as $f) $pl[$f] += (int)$p[$f];
            if (($g['mvp'] ?? null) === $p['acc']) $pl['mvp']++;
            $pl['heroes'][$h] = ($pl['heroes'][$h] ?? 0) + 1;
            unset($pl);
        }
    }
    foreach ($players as &$pl) {
        $n = max(1, $pl['games']);
        $pl['kda'] = round(($pl['k'] + $pl['a']) / max(1, $pl['d']), 2);
        foreach (['gpm', 'xpm', 'dmg'] as $f) $pl[$f] = (int)round($pl[$f] / $n);
        arsort($pl['heroes']);
        $pl['heroes'] = array_map(fn($id) => ['id' => (int)$id, 'name' => $hn[(string)$id][0] ?? "#$id", 'img' => $hn[(string)$id][1] ?? ''], array_slice(array_keys($pl['heroes']), 0, 3));
    }
    unset($pl);
    usort($heroes, fn($a, $b) => $b['picks'] <=> $a['picks'] ?: $b['wins'] <=> $a['wins']);
    $players = array_values($players);
    usort($players, fn($a, $b) => $b['kda'] <=> $a['kda'] ?: $b['games'] <=> $a['games']);
    $out = ['totals' => $tot, 'heroes' => array_slice($heroes, 0, 24), 'players' => array_slice($players, 0, 30), 'at' => gmdate('c')];
    kvSet("fx:ts:$tid", $out, 300);
    return $out;
}

// ---------- FACEIT: уровень, найденный браузером, сохраняется для списков ----------

function faceitLevelFor(int $elo): int
{
    foreach ([500 => 1, 750 => 2, 900 => 3, 1050 => 4, 1200 => 5, 1350 => 6, 1530 => 7, 1750 => 8, 2000 => 9] as $max => $lv) if ($elo <= $max) return $lv;
    return 10;
}

// ---------- маршруты ----------

function fxBody(): array
{
    static $b = null;
    return $b ??= body();
}

function fxMatchArg(array $src): array
{
    return [str($src['t'] ?? '', 64, true), str($src['s'] ?? '', 64, true), str($src['k'] ?? '', 100, true)];
}

function fxReportOut(array $r, bool $full): array
{
    $o = ['id' => $r['id'], 'teamId' => $r['team_id'], 'scoreA' => (int)$r['score_a'], 'scoreB' => (int)$r['score_b'], 'status' => $r['status'], 'createdAt' => iso($r['created_at']), 'games' => fxMatchIds((string)$r['game_ids'])];
    if ($full) $o += ['t' => $r['tid'], 's' => $r['sid'], 'k' => $r['mkey'], 'teamA' => $r['team_a'], 'teamB' => $r['team_b'], 'userId' => $r['user_id'], 'shot' => !empty($r['has_shot'])];
    return $o;
}

/** Маршруты функций; если маршрут не наш, возвращает управление (дальше 404). */
function fxRoute(string $route): void
{
    fx2Route($route);
    switch ($route) {
        case 'GET share':
            fxSharePage(docRead()['db']);

        case 'GET ogimg':
            fxOgImage(docRead()['db']);

        case 'GET matchinfo':
            [$t, $s, $k] = fxMatchArg($_GET);
            $db = docRead()['db'];
            $m = fxFind($db, $t, $s, $k);
            $uid = currentUserId();
            $side = fxSide($db, $m, $uid);
            $admin = isReferee();
            $checkins = [];
            foreach (q('SELECT team_id, at FROM match_checkins WHERE mid=?', [$m['mid']])->fetchAll() as $c) $checkins[$c['team_id']] = iso($c['at']);
            $games = [];
            $hn = null;
            foreach (q('SELECT match_id, team_radiant, team_dire, winner, data FROM match_games WHERE mid=?', [$m['mid']])->fetchAll() as $g) {
                $d = json_decode((string)$g['data'], true) ?: [];
                $hn ??= dotaHeroes();
                $d['players'] = array_map(fn($p) => $p + ['heroName' => $hn[(string)$p['hero']][0] ?? '', 'heroImg' => $hn[(string)$p['hero']][1] ?? ''], $d['players'] ?? []);
                $games[] = ['matchId' => (int)$g['match_id'], 'radiant' => $g['team_radiant'], 'dire' => $g['team_dire'], 'winner' => $g['winner']] + $d;
            }
            usort($games, fn($x, $y) => ($x['start'] ?? 0) <=> ($y['start'] ?? 0));
            $reports = [];
            foreach (q('SELECT id, team_id, score_a, score_b, status, created_at, game_ids FROM match_reports WHERE mid=? AND status<>\'rejected\' ORDER BY created_at', [$m['mid']])->fetchAll() as $r) $reports[] = fxReportOut($r, false);
            $ts = $m['ts'];
            ok([
                'mid' => $m['mid'], 'a' => $m['a'], 'b' => $m['b'], 'bo' => $m['bo'], 'status' => $m['status'], 'side' => $side, 'admin' => $admin,
                'start' => $ts ? gmdate('c', $ts) : null, 'checkinOpen' => $ts ? gmdate('c', $ts - 1800) : null, 'now' => gmdate('c'),
                'checkins' => (object)$checkins, 'games' => $games, 'reports' => $side || $admin ? $reports : array_map(fn($r) => ['teamId' => $r['teamId'], 'status' => $r['status']], $reports),
                'autoForfeit' => !empty($db['settings']['autoForfeit']),
            ]);

        case 'POST checkin':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'Войдите в аккаунт');
            [$t, $s, $k] = fxMatchArg(fxBody());
            $db = docRead()['db'];
            $m = fxFind($db, $t, $s, $k);
            $side = fxSide($db, $m, $uid);
            if (!$side) fail(403, 'Чек-ин проходит капитан или владелец команды');
            if ($m['status'] === 'finished') fail(409, 'Матч уже сыгран');
            if (!$m['ts']) fail(409, 'Время матча ещё не назначено');
            if (time() < $m['ts'] - 1800) fail(409, 'Чек-ин открывается за 30 минут до начала (' . fxTime($m['ts'] - 1800, 'H:i') . ' МСК)');
            if (time() > $m['ts']) fail(409, 'Чек-ин закрыт: матч уже начался');
            $team = $m[$side];
            $new = q('INSERT IGNORE INTO match_checkins (mid, team_id, user_id, at) VALUES (?,?,?,?)', [$m['mid'], $team, $uid, now()])->rowCount() === 1;
            if ($new) notify('checkin', '✅ ' . fxName($db, $team) . ' прошла чек-ин: ' . fxTitle($db, $m), fxLink($m));
            ok(['ok' => true]);

        case 'POST report':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'Войдите в аккаунт');
            $b = fxBody();
            [$t, $s, $k] = fxMatchArg($b);
            $db = docRead()['db'];
            $m = fxFind($db, $t, $s, $k);
            $side = fxSide($db, $m, $uid);
            if (!$side) fail(403, 'Результат отправляет капитан или владелец одной из команд');
            if ($m['status'] === 'finished') fail(409, 'Результат матча уже внесён');
            $sa = (int)($b['scoreA'] ?? -1);
            $sb = (int)($b['scoreB'] ?? -1);
            fxCheckScore($m, $sa, $sb);
            if (!preg_match('#^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$#', (string)($b['shot'] ?? ''), $sm)) fail(422, 'Приложите скриншот итогов (PNG, JPG или WebP)');
            $shot = base64_decode($sm[2], true);
            if ($shot === false || strlen($shot) > FX_SHOT_MAX) fail(413, 'Скриншот больше 1,4 МБ');
            if (!@getimagesizefromstring($shot)) fail(422, 'Файл скриншота повреждён');
            rateLimit('report', 20, 3600);
            $team = $m[$side];
            $ids = fxMatchIds($b['games'] ?? '');
            q("DELETE FROM match_reports WHERE mid=? AND team_id=? AND status IN ('pending','conflict')", [$m['mid'], $team]);
            $id = uid('rep');
            q('INSERT INTO match_reports (id, mid, tid, sid, mkey, team_id, user_id, team_a, team_b, score_a, score_b, game_ids, shot, shot_mime, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
                $id, $m['mid'], $m['tid'], $m['sid'], $m['key'], $team, $uid, $m['a'], $m['b'], $sa, $sb, implode(',', $ids), $shot, "image/{$sm[1]}", 'pending', now(),
            ]);
            $other = q("SELECT * FROM match_reports WHERE mid=? AND team_id=? AND status IN ('pending','conflict') ORDER BY created_at DESC LIMIT 1", [$m['mid'], $m[$side === 'a' ? 'b' : 'a']])->fetch();
            $state = 'waiting';
            if ($other && (int)$other['score_a'] === $sa && (int)$other['score_b'] === $sb) {
                $GLOBALS['FX_SRC'] = 'reports';
                fxSetResult($m, ['scoreA' => $sa, 'scoreB' => $sb, 'status' => 'finished']);
                q("UPDATE match_reports SET status='applied' WHERE id IN (?,?)", [$id, $other['id']]);
                fxImportLater($m, array_values(array_unique(array_merge($ids, fxMatchIds((string)$other['game_ids'])))));
                $state = 'applied';
            } elseif ($other) {
                q("UPDATE match_reports SET status='conflict' WHERE id IN (?,?)", [$id, $other['id']]);
                notify('reports', '⚠️ Спор по результату ' . fxTitle($db, $m) . ': ' . fxName($db, $other['team_id']) . " — {$other['score_a']}:{$other['score_b']}, " . fxName($db, $team) . " — $sa:$sb. Решите в админке.", fxSite() . '/#/admin');
                $state = 'conflict';
            } else {
                notify('reports', '📨 ' . fxName($db, $team) . " отправила результат $sa:$sb: " . fxTitle($db, $m) . '. Ждём подтверждения соперника.', fxLink($m));
            }
            ok(['ok' => true, 'state' => $state]);

        case 'GET reportshot':
            $r = q('SELECT tid, team_a, team_b, shot, shot_mime FROM match_reports WHERE id=?', [str($_GET['id'] ?? '', 32)])->fetch();
            if (!$r || $r['shot'] === null) fail(404, 'not found');
            if (!isReferee()) {
                $db = docRead()['db'];
                $uid = currentUserId();
                if (!canManageTeam($db, fxTeam($db, $r['team_a']), $uid) && !canManageTeam($db, fxTeam($db, $r['team_b']), $uid)) fail(403, 'forbidden');
            }
            header('Content-Type: ' . $r['shot_mime']);
            header('Cache-Control: private, max-age=86400');
            echo $r['shot'];
            exit;

        case 'GET reports':
            requireReferee();
            ok(array_map(fn($r) => fxReportOut($r, true), q('SELECT id, mid, tid, sid, mkey, team_id, user_id, team_a, team_b, score_a, score_b, game_ids, status, created_at, shot IS NOT NULL AS has_shot FROM match_reports ORDER BY created_at DESC LIMIT 300')->fetchAll()));

        case 'POST reportdecide':
            requireReferee();
            $b = fxBody();
            $r = q('SELECT * FROM match_reports WHERE id=?', [str($b['id'] ?? '', 32)])->fetch();
            if (!$r) fail(404, 'not found');
            if (($b['action'] ?? '') === 'apply') {
                $m = fxFind(docRead()['db'], $r['tid'], $r['sid'], $r['mkey']);
                $GLOBALS['FX_SRC'] = 'decide';
                fxSetResult($m, ['scoreA' => (int)$r['score_a'], 'scoreB' => (int)$r['score_b'], 'status' => 'finished']);
                q("UPDATE match_reports SET status='rejected' WHERE mid=? AND id<>? AND status IN ('pending','conflict')", [$r['mid'], $r['id']]);
                q("UPDATE match_reports SET status='applied' WHERE id=?", [$r['id']]);
                fxImportLater($m, fxMatchIds((string)$r['game_ids']));
            } else {
                q("UPDATE match_reports SET status='rejected' WHERE id=?", [$r['id']]);
            }
            ok(['ok' => true]);

        case 'POST addgame':
            csrf();
            $b = fxBody();
            [$t, $s, $k] = fxMatchArg($b);
            $db = docRead()['db'];
            $m = fxFind($db, $t, $s, $k);
            if (!isReferee() && !fxSide($db, $m, currentUserId())) fail(403, 'Игры добавляют организатор, судья и капитаны команд матча');
            if (!isReferee()) rateLimit('addgame', 15, 3600);
            $ids = fxMatchIds((string)($b['matchId'] ?? ''));
            if (!$ids) fail(422, 'Укажите Match ID (число из клиента Dota или ссылки OpenDota/Dotabuff)');
            $known = (int)q('SELECT COUNT(*) FROM match_games WHERE mid=?', [$m['mid']])->fetchColumn();
            if (!q('SELECT 1 FROM match_games WHERE match_id=?', [(int)$ids[0]])->fetchColumn() && $known >= $m['bo']) fail(409, "В серии Bo{$m['bo']} не может быть больше {$m['bo']} игр");
            $g = fxAddGame($db, $m, (int)$ids[0], in_array($b['radiant'] ?? '', ['a', 'b'], true) ? $b['radiant'] : null);
            fxRecalc(fxFind(docRead()['db'], $t, $s, $k));
            ok(['ok' => true, 'radiant' => $g['radiant'], 'radiantWin' => $g['radiantWin']]);

        case 'POST delgame':
            requireReferee();
            $b = fxBody();
            $row = q('SELECT tid, sid, mkey FROM match_games WHERE match_id=?', [(int)($b['matchId'] ?? 0)])->fetch();
            if (!$row) fail(404, 'not found');
            q('DELETE FROM match_games WHERE match_id=?', [(int)$b['matchId']]);
            q('DELETE FROM kv WHERE k=?', ["fx:ts:{$row['tid']}"]);
            try {
                fxRecalc(fxFind(docRead()['db'], $row['tid'], $row['sid'], $row['mkey']));
            } catch (ApiError) {
            }
            ok(['ok' => true]);

        case 'GET tstats':
            $tid = str($_GET['t'] ?? '', 64, true);
            header('Cache-Control: public, max-age=120');
            ok(fxTourStats(docRead()['db'], $tid));

        case 'POST faceit':
            csrf();
            $b = fxBody();
            $acc = (int)($b['steam'] ?? 0);
            $elo = (int)($b['elo'] ?? 0);
            $lv = (int)($b['level'] ?? 0);
            if ($acc <= 0 || $elo < 100 || $elo > 5000 || $lv !== faceitLevelFor($elo)) fail(422, 'bad faceit data');
            if (!q('SELECT 1 FROM users WHERE steam_id=?', [$acc])->fetchColumn()) fail(404, 'not found');
            if (!fxOnce("fc:$acc:$lv:$elo", 3600)) ok(['ok' => true, 'same' => true]);
            q('UPDATE users SET faceit_level=?, faceit_elo=? WHERE steam_id=?', [$lv, $elo, $acc]);
            $us = q('SELECT * FROM users WHERE steam_id=?', [$acc])->fetchAll();
            docTx(function (&$d, &$changed) use ($us) {
                foreach ($us as $u) if (applyUserToPlayers($d['db'], $u, false) !== 'none') $changed = true;
            });
            ok(['ok' => true]);

        case 'GET hooks':
            requireAdmin();
            $h = hooksCfg();
            ok([
                'discord' => $h['discord'] !== '' ? preg_replace('#/[^/]{6}([^/]*)$#', '/******', $h['discord']) : '', 'tgToken' => $h['tgToken'] !== '' ? substr($h['tgToken'], 0, 6) . '…' : '',
                'tgChat' => $h['tgChat'], 'events' => (object)$h['events'], 'labels' => FX_EVENTS,
                'backupDiscord' => $h['backupDiscord'] !== '' ? preg_replace('#/[^/]{6}([^/]*)$#', '/******', $h['backupDiscord']) : '', 'backupTgChat' => $h['backupTgChat'], 'bot' => fx2Bot(),
            ]);

        case 'POST hooks':
            requireAdmin();
            $b = fxBody();
            $h = hooksCfg();
            foreach (['discord', 'tgToken', 'backupDiscord'] as $f) {
                if (!array_key_exists($f, $b)) continue;
                $v = trim((string)$b[$f]);
                if ($v === '-') $h[$f] = '';
                elseif ($v !== '' && !str_contains($v, '***') && !str_ends_with($v, '…')) $h[$f] = $v;
            }
            if ($h['discord'] !== '' && !preg_match('#^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/\d+/[\w-]+$#', $h['discord'])) fail(422, 'Ссылка Discord-вебхука вида https://discord.com/api/webhooks/…');
            if ($h['backupDiscord'] !== '' && !preg_match('#^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/\d+/[\w-]+$#', $h['backupDiscord'])) fail(422, 'Вебхук для бэкапов: ссылка вида https://discord.com/api/webhooks/…');
            if ($h['tgToken'] !== '' && !preg_match('/^\d{5,}:[\w-]{30,}$/', $h['tgToken'])) fail(422, 'Токен Telegram-бота вида 123456:ABC… (от @BotFather)');
            if (array_key_exists('tgChat', $b)) $h['tgChat'] = str($b['tgChat'], 64);
            if (array_key_exists('backupTgChat', $b)) $h['backupTgChat'] = str($b['backupTgChat'], 64);
            if ($h['backupTgChat'] !== '' && !preg_match('/^(-?\d{5,}|@[A-Za-z0-9_]{5,})$/', $h['backupTgChat'])) fail(422, 'Chat ID для бэкапов: число (-100…) или @канал');
            if ($h['tgChat'] !== '' && !preg_match('/^(-?\d{5,}|@[A-Za-z0-9_]{5,})$/', $h['tgChat'])) fail(422, 'Chat ID: число (-100…) или @канал');
            $ev = [];
            foreach (FX_EVENTS as $k => $_) $ev[$k] = !isset($b['events'][$k]) ? ($h['events'][$k] ?? true) !== false : (bool)$b['events'][$k];
            $h['events'] = $ev;
            kvSet('cfg:hooks', $h, 50 * 365 * 86400);
            ok(['ok' => true]);

        case 'POST hooktest':
            requireAdmin();
            $h = hooksCfg();
            if ($h['discord'] === '' && ($h['tgToken'] === '' || $h['tgChat'] === '')) fail(422, 'Сначала сохраните вебхук Discord или бота Telegram');
            ok(hooksSend($h, '🔔 Проверка уведомлений сайта ' . fxSite(), null));
    }
}

// ---------- консольные команды ----------

/** Каждую минуту на основном сервере: напоминания, открытие чек-ина, технические поражения. */
function fxCron(): void
{
    if (readonlyMode()) return;
    $db = docRead()['db'];
    $auto = !empty($db['settings']['autoForfeit']);
    $now = time();
    foreach (fxMatches($db) as $m) {
        if (!$m['ts'] || $m['status'] === 'finished') continue;
        $left = $m['ts'] - $now;
        if ($left <= 1800 && $left > 1500 && fxOnce("n:ci:{$m['mid']}", 86400)) notify('checkin', '🕐 Открыт чек-ин до ' . fxTime($m['ts'], 'H:i') . ' МСК: ' . fxTitle($db, $m) . '. Капитанам — кнопка «Чек-ин» на странице матча.', fxLink($m));
        if ($left <= 900 && $left > 0 && fxOnce("n:soon:{$m['mid']}", 86400)) notify('soon', '⏰ Через ' . max(1, intdiv($left + 59, 60)) . ' мин: ' . fxTitle($db, $m) . ' · Bo' . $m['bo'] . (!empty($m['rec']['stream']) ? "\nТрансляция: {$m['rec']['stream']}" : ''), fxLink($m));
        if ($left <= 0 && $left > -900 && $m['status'] === 'scheduled') {
            $in = q('SELECT team_id FROM match_checkins WHERE mid=?', [$m['mid']])->fetchAll(PDO::FETCH_COLUMN);
            $in = array_values(array_intersect($in, [$m['a'], $m['b']]));
            if (count($in) === 2 || !fxOnce("n:ff:{$m['mid']}", 7 * 86400)) continue;
            if (count($in) === 1 && $auto) {
                $win = intdiv(max(1, $m['bo']), 2) + 1;
                $aw = $in[0] === $m['a'];
                $loser = $aw ? $m['b'] : $m['a'];
                $GLOBALS['FX_SRC'] = 'forfeit';
                fxSetResult($m, ['scoreA' => $aw ? $win : 0, 'scoreB' => $aw ? 0 : $win, 'status' => 'finished', 'note' => 'Техническое поражение: ' . fxName($db, $loser) . ' не прошла чек-ин']);
                notify('checkin', '🚫 Техническое поражение ' . fxName($db, $loser) . ' (не прошла чек-ин): ' . fxTitle($db, $m), fxLink($m));
            } else {
                $who = count($in) === 1 ? 'Чек-ин прошла только ' . fxName($db, $in[0]) : 'Ни одна команда не прошла чек-ин';
                notify('checkin', "⚠️ $who: " . fxTitle($db, $m) . '. Решение за организатором.', fxSite() . '/#/admin');
            }
        }
    }
    q('DELETE FROM kv WHERE exp<? AND (k LIKE ? OR k LIKE ?)', [$now, 'n:%', 'fc:%']);
}

/** Резервный сервер: сообщает, когда DNS сайта переключился на него или обратно. */
function fxFailoverWatch(): void
{
    global $CFG;
    $self = (string)($CFG['self_ip'] ?? '');
    $host = (string)($CFG['failover_host'] ?? 'cup.rut-miit.su');
    if ($self === '') exit("self_ip not set\n");
    $ips = [];
    $doh = fetchMany(['c' => 'https://cloudflare-dns.com/dns-query?ct=application/dns-json&type=A&name=' . rawurlencode($host), 'g' => 'https://dns.google/resolve?type=A&name=' . rawurlencode($host)], 8);
    foreach ($doh as $r) foreach ($r['Answer'] ?? [] as $a) if ((int)($a['type'] ?? 0) === 1) $ips[] = (string)$a['data'];
    if (!$ips) foreach (dns_get_record($host, DNS_A) ?: [] as $a) $ips[] = (string)$a['ip'];
    if (!$ips) exit("no dns answer\n");
    $state = in_array($self, $ips, true) ? 'reserve' : 'primary';
    $file = (string)($CFG['failover_state'] ?? '/var/lib/cup-failover.state');
    $prev = is_file($file) ? trim((string)file_get_contents($file)) : '';
    if ($prev !== $state) {
        file_put_contents($file, $state);
        if ($prev !== '') notify('failover', $state === 'reserve'
            ? "🔴 $host переключён на резервный сервер ($self): основной не отвечает. Сайт работает в режиме только чтения."
            : "🟢 $host снова на основном сервере (" . implode(', ', array_unique($ips)) . ').');
    }
    echo "$state\n";
}

/** true, если команда наша. */
function fxCli(array $argv): bool
{
    if (fx2Cli($argv)) return true;
    switch ($argv[1] ?? '') {
        case 'cron':
            fxCron();
            return true;
        case 'failover-watch':
            fxFailoverWatch();
            return true;
        case 'notify-test':
            print_r(hooksSend(hooksCfg(), '🔔 Проверка уведомлений ' . fxSite() . ' (' . gethostname() . ')', null));
            return true;
    }
    return false;
}
