<?php
declare(strict_types=1);

/*
 * Вторая очередь функций: роли аккаунтов (организатор и судья, вход через Steam), health и взаимный мониторинг серверов,
 * бэкапы в Discord/Telegram, календарь .ics, кабинет капитана, Telegram-бот, жеребьёвка и выбор сторон перед играми,
 * журнал изменений результатов, рейтинг Эло. Подключается из index.php после features.php:
 * маршруты — fx2Route() (из fxRoute), консольные команды — fx2Cli() (из fxCli).
 */

const ROLES = ['admin' => 'Организатор', 'referee' => 'Судья', 'obs_operator' => 'Оператор эфира'];
const PICK_CHOICES = ['radiant' => 'Radiant', 'dire' => 'Dire', 'first' => 'первый пик', 'second' => 'второй пик'];
const PICK_PAIRS = ['radiant' => 'dire', 'dire' => 'radiant', 'first' => 'second', 'second' => 'first'];
const LOG_SRC = [
    'admin' => 'админка', 'reports' => 'отчёты капитанов', 'decide' => 'решение по спору', 'opendota' => 'игры OpenDota',
    'forfeit' => 'неявка на чек-ин', 'referee' => 'судья', 'auto' => 'автоматически',
];
const ELO_START = 1000;
const ELO_K = 32;

// ---------- роли ----------

/** Роль аккаунта текущей сессии: 'admin', 'referee' или ''. */
function userRole(): string
{
    static $cache = [];
    $uid = currentUserId();
    if (!$uid) return '';
    return $cache[$uid] ??= (string)(q('SELECT role FROM users WHERE id=?', [$uid])->fetchColumn() ?: '');
}

/** Судья ведёт результаты: отчёты капитанов, игры OpenDota, счёт, жеребьёвку. Организатор — тоже судья. */
function isReferee(): bool
{
    return isAdmin() || userRole() === 'referee';
}

function requireReferee(): void
{
    if (!isReferee()) fail(401, 'login required');
    csrf();
}

/** Кто меняет результат — для журнала. */
function fx2Actor(): string
{
    if (isset($GLOBALS['FX_ACTOR'])) return (string)$GLOBALS['FX_ACTOR'];
    if (PHP_SAPI === 'cli') return 'Система';
    $uid = currentUserId();
    $u = $uid ? q('SELECT login, nick, role FROM users WHERE id=?', [$uid])->fetch() : null;
    if ($u && isset(ROLES[$u['role']])) return ROLES[$u['role']] . ' ' . ($u['nick'] !== '' ? $u['nick'] : $u['login']);
    if (!empty($_SESSION['admin'])) return 'Организатор';
    if ($u) return 'Капитан ' . ($u['nick'] !== '' ? $u['nick'] : $u['login']);
    return 'Сайт';
}

// ---------- журнал изменений результатов ----------

/** Пишет в result_log каждое изменение статуса или счёта матча между двумя версиями документа. */
function fx2LogDiff(array $old, array $new): void
{
    $idx = function (array $db): array {
        $out = [];
        foreach ($db['matches'] ?? [] as $m) $out[($m['tournamentId'] ?? '') . '|' . ($m['stageId'] ?? '') . '|' . ($m['key'] ?? '')] = $m;
        return $out;
    };
    $o = $idx($old);
    $n = $idx($new);
    $f = fn(array $r) => [(string)($r['status'] ?? 'scheduled'), isset($r['scoreA']) ? (int)$r['scoreA'] : null, isset($r['scoreB']) ? (int)$r['scoreB'] : null];
    $src = (string)($GLOBALS['FX_SRC'] ?? (PHP_SAPI === 'cli' ? 'auto' : 'admin'));
    $actor = null;
    foreach ($n + $o as $id => $_) {
        $a = $o[$id] ?? [];
        $b = $n[$id] ?? [];
        [$s1, $a1, $b1] = $f($a);
        [$s2, $a2, $b2] = $f($b);
        if ($s1 === $s2 && $a1 === $a2 && $b1 === $b2) continue;
        // новый пустой слот без счёта в журнал не идёт
        if (!$a && $s2 === 'scheduled' && $a2 === null && $b2 === null) continue;
        [$t, $s, $k] = explode('|', $id, 3);
        $actor ??= mb_substr(fx2Actor(), 0, 80);
        q('INSERT INTO result_log (mid, tid, sid, mkey, actor, source, old_status, old_a, old_b, new_status, new_a, new_b, note, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
            sha1($id), $t, $s, $k, $actor, $src, $s1, $a1, $b1, $b ? $s2 : 'deleted', $a2, $b2, mb_substr((string)($b['note'] ?? ''), 0, 300), now(),
        ]);
    }
    // рейтинг зависит и от настроек сезона, поэтому сбрасывается при любой публикации
    q('DELETE FROM kv WHERE k=?', ['fx:elo']);
}

function fx2LogOut(array $r): array
{
    $st = fn(?string $s) => ['scheduled' => 'не сыгран', 'live' => 'идёт', 'finished' => 'сыгран', 'deleted' => 'удалён'][$s ?? ''] ?? (string)$s;
    return [
        'id' => (int)$r['id'], 't' => $r['tid'], 's' => $r['sid'], 'k' => $r['mkey'], 'actor' => $r['actor'], 'source' => LOG_SRC[$r['source']] ?? $r['source'],
        'from' => ['status' => $st($r['old_status']), 'a' => $r['old_a'] !== null ? (int)$r['old_a'] : null, 'b' => $r['old_b'] !== null ? (int)$r['old_b'] : null],
        'to' => ['status' => $st($r['new_status']), 'a' => $r['new_a'] !== null ? (int)$r['new_a'] : null, 'b' => $r['new_b'] !== null ? (int)$r['new_b'] : null],
        'note' => $r['note'], 'at' => iso($r['at']),
    ];
}

// ---------- рейтинг Эло по сыгранным сериям сезона ----------

function fx2Elo(array $db): array
{
    $c = kvGet('fx:elo');
    if (is_array($c)) return $c;
    $season = (string)($db['settings']['seasonStart'] ?? '');
    $rows = [];
    foreach ($db['tournaments'] as $t) {
        if ($season !== '' && (string)($t['startDate'] ?? '') < $season) continue;
        $base = strtotime(($t['startDate'] ?? '2000-01-01') . ' 12:00 UTC') ?: 0;
        $i = 0;
        foreach (fxMatches($db, $t['id']) as $m) {
            $r = $m['rec'] ?? [];
            $i++;
            if (($r['status'] ?? '') !== 'finished' || !isset($r['scoreA'], $r['scoreB']) || (int)$r['scoreA'] === (int)$r['scoreB']) continue;
            $rows[] = $m + ['order' => $m['ts'] ?? $base + $i];
        }
    }
    usort($rows, fn($x, $y) => $x['order'] <=> $y['order']);
    $known = array_column($db['teams'], null, 'id');
    $R = [];
    foreach ($rows as $m) {
        if (!isset($known[$m['a']], $known[$m['b']])) continue;
        foreach ([$m['a'], $m['b']] as $id) $R[$id] ??= ['teamId' => $id, 'elo' => (float)ELO_START, 'games' => 0, 'wins' => 0, 'losses' => 0, 'mapsWon' => 0, 'mapsLost' => 0, 'form' => [], 'peak' => (float)ELO_START];
        $sa = (int)$m['rec']['scoreA'];
        $sb = (int)$m['rec']['scoreB'];
        $ra = $R[$m['a']]['elo'];
        $rb = $R[$m['b']]['elo'];
        $ea = 1 / (1 + 10 ** (($rb - $ra) / 400));
        $res = $sa > $sb ? 1 : 0;
        // разгромная серия весит чуть больше: 2:0 в Bo3 — ×1.25, 2:1 — ×1
        $mult = $m['bo'] > 1 ? 1 + 0.25 * (abs($sa - $sb) - 1) / max(1, intdiv($m['bo'], 2)) : 1;
        $d = ELO_K * $mult * ($res - $ea);
        foreach ([[$m['a'], $d, $res, $sa, $sb], [$m['b'], -$d, 1 - $res, $sb, $sa]] as [$id, $delta, $won, $mw, $ml]) {
            $x = &$R[$id];
            $x['elo'] += $delta;
            $x['peak'] = max($x['peak'], $x['elo']);
            $x['games']++;
            $won ? $x['wins']++ : $x['losses']++;
            $x['mapsWon'] += $mw;
            $x['mapsLost'] += $ml;
            $x['form'][] = ['r' => $won ? 'W' : 'L', 'vs' => $id === $m['a'] ? $m['b'] : $m['a'], 'score' => "$mw:$ml", 'delta' => (int)round($delta), 'tid' => $m['tid'], 's' => $m['sid'], 'k' => $m['key']];
            unset($x);
        }
    }
    foreach ($R as &$x) {
        $x['elo'] = (int)round($x['elo']);
        $x['peak'] = (int)round($x['peak']);
        $x['form'] = array_slice(array_reverse($x['form']), 0, 5);
    }
    unset($x);
    $list = array_values($R);
    usort($list, fn($a, $b) => $b['elo'] <=> $a['elo'] ?: $b['wins'] <=> $a['wins']);
    $out = ['season' => $season, 'seasonName' => (string)($db['settings']['seasonName'] ?? ''), 'series' => count($rows), 'teams' => $list, 'start' => ELO_START, 'at' => gmdate('c')];
    kvSet('fx:elo', $out, 300);
    return $out;
}

// ---------- календарь .ics ----------

function fx2IcsText(string $s): string
{
    return str_replace(["\\", ';', ',', "\r", "\n"], ["\\\\", '\;', '\,', '', '\n'], $s);
}

/** Строки длиннее 75 октетов переносятся (RFC 5545), не разрывая UTF-8. */
function fx2IcsFold(string $line): string
{
    $out = '';
    $cur = '';
    foreach (mb_str_split($line) as $ch) {
        if (strlen($cur) + strlen($ch) > ($out === '' ? 75 : 74)) {
            $out .= ($out === '' ? '' : "\r\n ") . $cur;
            $cur = '';
        }
        $cur .= $ch;
    }
    return $out . ($out === '' ? '' : "\r\n ") . $cur;
}

function fx2Ics(array $db): never
{
    $team = str($_GET['team'] ?? '', 100);
    $tid = str($_GET['t'] ?? '', 64);
    if ($team === '' && $tid === '') fail(422, 'Укажите команду или турнир');
    $name = $team !== '' ? fxName($db, $team) : '';
    if ($tid !== '') foreach ($db['tournaments'] as $t) if ($t['id'] === $tid) $name = ($name !== '' ? "$name · " : '') . ($t['short'] ?? $t['name']);
    $host = (string)parse_url(fxSite(), PHP_URL_HOST);
    $L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kiberliga RUT MIIT//cup//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'X-WR-CALNAME:' . fx2IcsText("Киберлига: $name"), 'X-WR-TIMEZONE:Europe/Moscow', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
    $stamp = gmdate('Ymd\THis\Z');
    foreach (fxMatches($db, $tid !== '' ? $tid : null) as $m) {
        if (!$m['ts'] || ($team !== '' && !in_array($team, [$m['a'], $m['b']], true))) continue;
        $r = $m['rec'] ?? [];
        $score = ($r['status'] ?? '') === 'finished' && isset($r['scoreA'], $r['scoreB']) ? " ({$r['scoreA']}:{$r['scoreB']})" : '';
        $url = fxSite() . "/#/t/{$m['tid']}/m/{$m['sid']}/{$m['key']}";
        array_push($L, 'BEGIN:VEVENT', "UID:{$m['mid']}@$host", "DTSTAMP:$stamp",
            'DTSTART:' . gmdate('Ymd\THis\Z', $m['ts']), 'DTEND:' . gmdate('Ymd\THis\Z', $m['ts'] + max(1, $m['bo']) * 55 * 60),
            'SUMMARY:' . fx2IcsText(fxName($db, $m['a']) . ' — ' . fxName($db, $m['b']) . $score),
            'DESCRIPTION:' . fx2IcsText("{$m['tour']}" . ($m['stage'] !== '' ? " · {$m['stage']}" : '') . " · Bo{$m['bo']}\nЧек-ин за 30 минут до начала.\n$url"),
            'LOCATION:' . fx2IcsText((string)($r['stream'] ?? '') !== '' ? (string)$r['stream'] : 'Онлайн'), 'URL:' . $url,
            'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:' . fx2IcsText('Открыт чек-ин: ' . fxName($db, $m['a']) . ' — ' . fxName($db, $m['b'])), 'END:VALARM',
            'END:VEVENT');
    }
    $L[] = 'END:VCALENDAR';
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: inline; filename="kiberliga.ics"');
    header('Cache-Control: public, max-age=600');
    echo implode("\r\n", array_map('fx2IcsFold', $L)), "\r\n";
    exit;
}

// ---------- кабинет капитана ----------

/** Команды аккаунта: [управляет (владелец/капитан), состоит в составе]. */
function fx2MyTeams(array $db, string $uid): array
{
    $manage = $member = [];
    foreach ($db['teams'] as $t) if (canManageTeam($db, $t, $uid)) $manage[] = $t['id'];
    foreach ($db['players'] as $p) if (($p['userId'] ?? '') === $uid && !empty($p['teamId'])) $member[] = $p['teamId'];
    return [$manage, array_values(array_unique(array_merge($manage, $member)))];
}

function fx2Bot(): ?string
{
    $b = kvGet('cfg:tgbot');
    return is_array($b) && !empty($b['username']) ? (string)$b['username'] : null;
}

function fx2MyMatches(array $db, string $uid): array
{
    [$manage, $all] = fx2MyTeams($db, $uid);
    $list = array_filter(fxMatches($db), fn($m) => in_array($m['a'], $all, true) || in_array($m['b'], $all, true));
    $mids = array_column($list, 'mid');
    $ci = $rep = [];
    if ($mids) {
        $in = implode(',', array_fill(0, count($mids), '?'));
        foreach (q("SELECT mid, team_id FROM match_checkins WHERE mid IN ($in)", $mids)->fetchAll() as $r) $ci[$r['mid']][$r['team_id']] = true;
        foreach (q("SELECT mid, team_id, status FROM match_reports WHERE mid IN ($in) AND status<>'rejected' ORDER BY created_at", $mids)->fetchAll() as $r) $rep[$r['mid']][$r['team_id']] = $r['status'];
    }
    $out = [];
    foreach ($list as $m) {
        $side = in_array($m['a'], $all, true) ? 'a' : 'b';
        $my = $m[$side];
        $opp = $m[$side === 'a' ? 'b' : 'a'];
        $r = $m['rec'] ?? [];
        $out[] = [
            't' => $m['tid'], 's' => $m['sid'], 'k' => $m['key'], 'tour' => $m['tour'], 'stage' => $m['stage'], 'a' => $m['a'], 'b' => $m['b'], 'bo' => $m['bo'],
            'status' => $m['status'], 'scoreA' => isset($r['scoreA']) ? (int)$r['scoreA'] : null, 'scoreB' => isset($r['scoreB']) ? (int)$r['scoreB'] : null,
            'start' => $m['ts'] ? gmdate('c', $m['ts']) : null, 'team' => $my, 'manage' => in_array($my, $manage, true),
            'checkedIn' => !empty($ci[$m['mid']][$my]), 'oppCheckedIn' => !empty($ci[$m['mid']][$opp]),
            'report' => $rep[$m['mid']][$my] ?? null, 'oppReport' => $rep[$m['mid']][$opp] ?? null,
        ];
    }
    $rank = fn($x) => ['live' => 0, 'scheduled' => 1, 'finished' => 2][$x['status']] ?? 1;
    usort($out, function ($x, $y) use ($rank) {
        $c = $rank($x) <=> $rank($y);
        if ($c) return $c;
        if ($x['status'] === 'finished') return strcmp((string)$y['start'], (string)$x['start']);
        return strcmp($x['start'] ?? '9999', $y['start'] ?? '9999');
    });
    $tg = q('SELECT tg_chat FROM users WHERE id=?', [$uid])->fetchColumn();
    return [
        'teams' => array_map(fn($id) => ['id' => $id, 'name' => fxName($db, $id), 'manage' => in_array($id, $manage, true)], $all),
        'matches' => $out, 'tg' => ['linked' => $tg !== null && $tg !== false, 'bot' => fx2Bot()], 'now' => gmdate('c'),
    ];
}

// ---------- Telegram: бот с командами и личные напоминания ----------

/** Вызов Bot API с полным ответом (httpPost обрезает тело). */
function tgCall(string $method, array $params): array
{
    global $CFG;
    $h = hooksCfg();
    if ($h['tgToken'] === '') return ['ok' => false, 'description' => 'бот не настроен'];
    $ch = curl_init("https://api.telegram.org/bot{$h['tgToken']}/$method");
    $o = [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_USERAGENT => 'cup-league/1.0',
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_POSTFIELDS => json_encode($params, JSON_UNESCAPED_UNICODE),
    ];
    if (!empty($CFG['hooks_proxy'])) $o[CURLOPT_PROXY] = (string)$CFG['hooks_proxy'];
    curl_setopt_array($ch, $o);
    $body = curl_exec($ch);
    $j = json_decode((string)$body, true);
    return is_array($j) ? $j : ['ok' => false, 'description' => curl_error($ch) ?: 'нет ответа'];
}

/** Аккаунты, которые отвечают за команду: владелец и капитан с привязанной карточкой. */
function fx2TeamUsers(array $db, string $teamId): array
{
    $t = fxTeam($db, $teamId);
    $ids = [];
    if (!empty($t['ownerId'])) $ids[] = $t['ownerId'];
    foreach ($db['players'] as $p) if ($p['id'] === ($t['captainId'] ?? '') && !empty($p['userId'])) $ids[] = $p['userId'];
    return array_values(array_unique($ids));
}

function fx2Dm(array $db, string $teamId, string $text): void
{
    $ids = fx2TeamUsers($db, $teamId);
    if (!$ids) return;
    $in = implode(',', array_fill(0, count($ids), '?'));
    foreach (q("SELECT tg_chat FROM users WHERE id IN ($in) AND tg_chat IS NOT NULL", $ids)->fetchAll(PDO::FETCH_COLUMN) as $chat) {
        $r = tgCall('sendMessage', ['chat_id' => (int)$chat, 'text' => mb_substr($text, 0, 4000), 'disable_web_page_preview' => true]);
        // пользователь заблокировал бота — отвязываем, чтобы не стучаться впустую
        if (empty($r['ok']) && (int)($r['error_code'] ?? 0) === 403) q('UPDATE users SET tg_chat=NULL WHERE tg_chat=?', [$chat]);
    }
}

function fx2MatchUrl(array $m): string
{
    return fxSite() . "/#/t/{$m['tid']}/m/{$m['sid']}/{$m['key']}";
}

function fx2Help(): string
{
    return "Команды:\n/next — ближайшие матчи (ваших команд, если аккаунт привязан)\n/today — матчи сегодня\n/checkin — пройти чек-ин за свою команду\n/stop — отвязать аккаунт";
}

function fx2MatchLine(array $db, array $m): string
{
    $r = $m['rec'] ?? [];
    $when = $m['ts'] ? fxTime($m['ts'], 'd.m H:i') . ' МСК' : 'время не назначено';
    $score = in_array($r['status'] ?? '', ['live', 'finished'], true) && isset($r['scoreA'], $r['scoreB']) ? " {$r['scoreA']}:{$r['scoreB']}" : '';
    $live = ($r['status'] ?? '') === 'live' ? '🔴 идёт · ' : '';
    return "$live$when — " . fxName($db, $m['a']) . ' vs ' . fxName($db, $m['b']) . "$score\n{$m['tour']}" . ($m['stage'] !== '' ? " · {$m['stage']}" : '') . " · Bo{$m['bo']}\n" . fx2MatchUrl($m);
}

function fx2NextText(?string $uid): string
{
    $db = docRead()['db'];
    $teams = $uid ? fx2MyTeams($db, $uid)[1] : [];
    $list = array_filter(fxMatches($db), fn($m) => $m['status'] !== 'finished' && ($m['ts'] ?? 0) > time() - 4 * 3600 && (!$teams || in_array($m['a'], $teams, true) || in_array($m['b'], $teams, true)));
    usort($list, fn($x, $y) => ($x['ts'] ?? PHP_INT_MAX) <=> ($y['ts'] ?? PHP_INT_MAX));
    if (!$list) return $teams ? 'У ваших команд нет назначенных матчей.' : 'Ближайших матчей нет.';
    return ($teams ? "Матчи ваших команд:\n\n" : "Ближайшие матчи:\n\n") . implode("\n\n", array_map(fn($m) => fx2MatchLine($db, $m), array_slice($list, 0, 5)));
}

function fx2TodayText(): string
{
    $db = docRead()['db'];
    $day = fxTime(time(), 'Y-m-d');
    $list = array_filter(fxMatches($db), fn($m) => $m['ts'] && fxTime($m['ts'], 'Y-m-d') === $day);
    usort($list, fn($x, $y) => $x['ts'] <=> $y['ts']);
    return $list ? "Сегодня:\n\n" . implode("\n\n", array_map(fn($m) => fx2MatchLine($db, $m), $list)) : 'Сегодня матчей нет.';
}

function fx2BotCheckin(string $uid): string
{
    $db = docRead()['db'];
    $now = time();
    $lines = [];
    foreach (fxMatches($db) as $m) {
        if (!$m['ts'] || $m['status'] === 'finished' || $now < $m['ts'] - 1800 || $now > $m['ts']) continue;
        $side = fxSide($db, $m, $uid);
        if (!$side) continue;
        $team = $m[$side];
        $new = q('INSERT IGNORE INTO match_checkins (mid, team_id, user_id, at) VALUES (?,?,?,?)', [$m['mid'], $team, $uid, now()])->rowCount() === 1;
        if ($new) notify('checkin', '✅ ' . fxName($db, $team) . ' прошла чек-ин (Telegram): ' . fxTitle($db, $m), fxLink($m));
        $lines[] = ($new ? '✅ Чек-ин пройден: ' : '✓ Уже отмечены: ') . fxName($db, $team) . ' — ' . fxTitle($db, $m) . ', начало в ' . fxTime($m['ts'], 'H:i') . ' МСК';
    }
    return $lines ? implode("\n", $lines) : 'Сейчас нет матчей с открытым чек-ином у команд, где вы капитан или владелец. Чек-ин открывается за 30 минут до начала.';
}

/** Обработка входящего сообщения бота; ответ уходит прямо в ответе на вебхук. */
function fx2TgUpdate(array $u): array
{
    $msg = $u['message'] ?? null;
    if (!is_array($msg) || ($msg['chat']['type'] ?? '') !== 'private') return ['ok' => true];
    $chat = (int)($msg['chat']['id'] ?? 0);
    $say = fn(string $t) => ['method' => 'sendMessage', 'chat_id' => $chat, 'text' => mb_substr($t, 0, 4000), 'disable_web_page_preview' => true];
    [$cmd, $arg] = array_pad(preg_split('/\s+/', trim((string)($msg['text'] ?? '')), 2) ?: [''], 2, '');
    $cmd = strtolower((string)preg_replace('/@.*$/', '', $cmd));
    $user = q('SELECT id, login, nick FROM users WHERE tg_chat=? AND banned=0', [$chat])->fetch();
    $link = fxSite() . '/#/my';
    switch ($cmd) {
        case '/start':
            if (preg_match('/^[a-f0-9]{16}$/', $arg)) {
                $uid = q('SELECT v FROM kv WHERE k=? AND exp>?', ["tglink:$arg", time()])->fetchColumn();
                q('DELETE FROM kv WHERE k=?', ["tglink:$arg"]);
                if ($uid === false) return $say("Ссылка устарела. Получите новую в кабинете: $link");
                q('UPDATE users SET tg_chat=NULL WHERE tg_chat=?', [$chat]);
                q('UPDATE users SET tg_chat=? WHERE id=?', [$chat, $uid]);
                $l = q('SELECT login, nick FROM users WHERE id=?', [$uid])->fetch();
                return $say('Готово: аккаунт ' . ($l['nick'] !== '' ? $l['nick'] : $l['login']) . " привязан. Напомню о чек-ине за 30 минут до матчей ваших команд.\n\n" . fx2Help());
            }
            return $say("Бот Киберлиги РУТ (МИИТ).\n\n" . fx2Help() . ($user ? '' : "\n\nЧтобы получать напоминания и проходить чек-ин отсюда, привяжите аккаунт в кабинете: $link"));
        case '/help':
            return $say(fx2Help());
        case '/stop':
            if ($user) q('UPDATE users SET tg_chat=NULL WHERE id=?', [$user['id']]);
            return $say($user ? 'Аккаунт отвязан, напоминаний больше не будет.' : 'Аккаунт и так не привязан.');
        case '/next':
            return $say(fx2NextText($user ? $user['id'] : null));
        case '/today':
            return $say(fx2TodayText());
        case '/checkin':
            return $say($user ? fx2BotCheckin($user['id']) : "Сначала привяжите аккаунт в кабинете: $link");
    }
    return $say("Не знаю такой команды.\n\n" . fx2Help());
}

// ---------- жеребьёвка и выбор стороны / очерёдности пика ----------

/**
 * Выбор перед каждой игрой серии: в первой игре выбирающего определяет монетка, дальше выбирает проигравший прошлую игру.
 * Выбирающий берёт сторону или очерёдность пика (c1), соперник — оставшееся (c2).
 */
function fx2PickState(array $m): array
{
    $rows = q('SELECT game, chooser, c1, c2, toss FROM match_picks WHERE mid=? ORDER BY game', [$m['mid']])->fetchAll();
    $wins = q('SELECT winner FROM match_games WHERE mid=? ORDER BY JSON_VALUE(data, "$.start"), match_id', [$m['mid']])->fetchAll(PDO::FETCH_COLUMN);
    $r = $m['rec'] ?? [];
    $maps = is_array($r['maps'] ?? null) ? array_values($r['maps']) : [];
    $played = max(count($wins), count($maps), in_array($r['status'] ?? '', ['live', 'finished'], true) ? (int)($r['scoreA'] ?? 0) + (int)($r['scoreB'] ?? 0) : 0);
    $n = $played + 1;
    $by = [];
    foreach ($rows as $x) $by[(int)$x['game']] = $x;
    $next = null;
    if ($m['status'] !== 'finished' && $n <= $m['bo']) {
        $row = $by[$n] ?? null;
        $chooser = $row['chooser'] ?? null;
        if (!$row && $n > 1) {
            $w = $wins[$n - 2] ?? null;
            if (!$w && isset($maps[$n - 2])) $w = (int)($maps[$n - 2]['a'] ?? 0) > (int)($maps[$n - 2]['b'] ?? 0) ? $m['a'] : $m['b'];
            if ($w) $chooser = $w === $m['a'] ? $m['b'] : $m['a'];
        }
        $step = $chooser === null ? 'toss' : (empty($row['c1']) ? 'c1' : (empty($row['c2']) ? 'c2' : 'done'));
        $next = ['game' => $n, 'chooser' => $chooser, 'toss' => $row ? (bool)$row['toss'] : false, 'c1' => $row['c1'] ?? null, 'c2' => $row['c2'] ?? null, 'step' => $step];
    }
    $list = [];
    foreach ($rows as $x) {
        if (empty($x['c1']) || empty($x['c2'])) continue;
        $list[] = ['game' => (int)$x['game'], 'chooser' => $x['chooser'], 'toss' => (bool)$x['toss'], 'c1' => $x['c1'], 'c2' => $x['c2'], 'result' => fx2PickResult($m, $x['chooser'], $x['c1'], $x['c2'])];
    }
    return ['next' => $next, 'games' => $list, 'played' => $played];
}

/** Итог выбора по командам: сторона и очерёдность пика. */
function fx2PickResult(array $m, string $chooser, string $c1, string $c2): array
{
    $other = $chooser === $m['a'] ? $m['b'] : $m['a'];
    $isSide = in_array($c1, ['radiant', 'dire'], true);
    return [
        $chooser => ['side' => $isSide ? $c1 : PICK_PAIRS[$c2], 'order' => $isSide ? PICK_PAIRS[$c2] : $c1],
        $other => ['side' => $isSide ? PICK_PAIRS[$c1] : $c2, 'order' => $isSide ? $c2 : PICK_PAIRS[$c1]],
    ];
}

function fx2PickLine(array $db, array $m, array $res): string
{
    $out = [];
    foreach ($res as $team => $x) $out[] = fxName($db, (string)$team) . ' — ' . PICK_CHOICES[$x['side']] . ', ' . PICK_CHOICES[$x['order']];
    return implode(' · ', $out);
}

// ---------- мониторинг и бэкапы ----------

/** Проверка второго сервера по его IP (DNS может смотреть на любой): отвечает ли API и не отстаёт ли реплика. */
function fx2PeerWatch(string $ip, string $name): void
{
    global $CFG;
    if (!filter_var($ip, FILTER_VALIDATE_IP)) exit("usage: peer-watch <ip> [name]\n");
    $host = (string)($CFG['failover_host'] ?? 'cup.rut-miit.su');
    $file = (string)($CFG['peer_state'] ?? '/var/lib/cup-peer.state');
    $st = is_file($file) ? (json_decode((string)file_get_contents($file), true) ?: []) : [];
    $st += ['fails' => 0, 'down' => false, 'lagSince' => 0, 'lagAlert' => false];
    $ch = curl_init("https://$host/api/?r=health");
    curl_setopt_array($ch, [CURLOPT_RESOLVE => ["$host:443:$ip"], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_USERAGENT => 'cup-peer-watch/1.0']);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $why = $code ? "HTTP $code" : curl_error($ch);
    $j = json_decode((string)$body, true);
    $ok = $code === 200 && !empty($j['ok']);
    $label = $name !== '' ? "$name ($ip)" : $ip;
    if ($ok) {
        if ($st['down']) notify('monitor', "🟢 Сервер $label снова отвечает.");
        $st['fails'] = 0;
        $st['down'] = false;
    } else {
        $st['fails']++;
        // три неудачи подряд (около 3 минут), чтобы не шуметь из-за одиночных таймаутов
        if ($st['fails'] >= 3 && !$st['down']) {
            $st['down'] = true;
            notify('monitor', "🔴 Сервер $label не отвечает: $why." . (readonlyMode() ? ' Если это основной, DNS переключится на резервный автоматически.' : ' Резервная копия сайта сейчас недоступна.'));
        }
    }
    // на основном сервере: реплика должна догонять rev за пару минут
    if ($ok && !readonlyMode() && isset($j['rev'])) {
        $mine = (int)q('SELECT rev FROM site_meta WHERE id=1')->fetchColumn();
        if ((int)$j['rev'] < $mine) {
            $st['lagSince'] = $st['lagSince'] ?: time();
            if (time() - $st['lagSince'] > 600 && !$st['lagAlert']) {
                notify('monitor', "🟠 Реплика $label отстаёт: версия данных {$j['rev']}, на основном $mine, уже больше 10 минут. Лог: /var/log/cup-sync-push.log");
                $st['lagAlert'] = true;
            }
        } else {
            if ($st['lagAlert']) notify('monitor', "🟢 Реплика $label догнала основной сервер (версия $mine).");
            $st['lagSince'] = 0;
            $st['lagAlert'] = false;
        }
    }
    file_put_contents($file, json_encode($st));
    echo $ok ? 'ok rev=' . ($j['rev'] ?? '?') . "\n" : "fail $why\n";
}

/** Отправка файла multipart-запросом (вебхук Discord или sendDocument Telegram). */
function fx2Upload(string $url, array $fields): array
{
    global $CFG;
    $ch = curl_init($url);
    $o = [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_USERAGENT => 'cup-league/1.0', CURLOPT_POSTFIELDS => $fields];
    if (!empty($CFG['hooks_proxy'])) $o[CURLOPT_PROXY] = (string)$CFG['hooks_proxy'];
    curl_setopt_array($ch, $o);
    $body = (string)curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    return ['code' => $code, 'info' => $code ? mb_substr($body, 0, 200) : curl_error($ch)];
}

/** Ночной бэкап вне серверов: зашифрованные файлы в отдельный Discord-канал и/или чат Telegram. */
function fx2Offsite(array $files): int
{
    $h = hooksCfg();
    $dc = (string)($h['backupDiscord'] ?? '');
    $tg = $h['tgToken'] !== '' && (string)($h['backupTgChat'] ?? '') !== '';
    if ($dc === '' && !$tg) {
        echo "offsite: not configured\n";
        return 0;
    }
    $bad = [];
    foreach ($files as $f) {
        if (!is_file($f)) continue;
        $size = filesize($f);
        $cap = 'Бэкап ' . fxSite() . ': ' . basename($f) . ' (' . round($size / 1048576, 2) . ' МБ, ' . gethostname() . ')';
        if ($dc !== '') {
            $r = $size <= 9_900_000
                ? fx2Upload($dc, ['payload_json' => json_encode(['content' => $cap, 'allowed_mentions' => ['parse' => []]], JSON_UNESCAPED_UNICODE), 'files[0]' => new CURLFile($f, 'application/octet-stream', basename($f))])
                : ['code' => 0, 'info' => 'файл больше 10 МБ'];
            echo 'discord ', basename($f), ': ', $r['code'], "\n";
            if ($r['code'] < 200 || $r['code'] >= 300) $bad[] = 'Discord ' . basename($f) . ': ' . $r['info'];
        }
        if ($tg) {
            $r = $size <= 49_000_000
                ? fx2Upload("https://api.telegram.org/bot{$h['tgToken']}/sendDocument", ['chat_id' => $h['backupTgChat'], 'caption' => $cap, 'document' => new CURLFile($f, 'application/octet-stream', basename($f))])
                : ['code' => 0, 'info' => 'файл больше 50 МБ'];
            echo 'telegram ', basename($f), ': ', $r['code'], "\n";
            if ($r['code'] < 200 || $r['code'] >= 300) $bad[] = 'Telegram ' . basename($f) . ': ' . $r['info'];
        }
    }
    if ($bad) notify('monitor', "⚠️ Ночной бэкап не ушёл за пределы серверов:\n" . implode("\n", $bad));
    return $bad ? 1 : 0;
}

// ---------- ежеминутные задачи ----------

/** Личные напоминания капитанам в Telegram. */
function fx2Cron(): void
{
    if (readonlyMode() || hooksCfg()['tgToken'] === '') return;
    $db = docRead()['db'];
    $now = time();
    foreach (fxMatches($db) as $m) {
        if (!$m['ts'] || $m['status'] === 'finished') continue;
        $left = $m['ts'] - $now;
        if ($left <= 1800 && $left > 1500 && fxOnce("dm:ci:{$m['mid']}", 86400)) {
            foreach ([$m['a'], $m['b']] as $tm) fx2Dm($db, $tm, '🕐 Открыт чек-ин: ' . fxTitle($db, $m) . ', начало в ' . fxTime($m['ts'], 'H:i') . " МСК.\nОтправьте /checkin или нажмите кнопку на странице матча:\n" . fx2MatchUrl($m));
        }
        if ($left <= 600 && $left > 0) {
            $in = q('SELECT team_id FROM match_checkins WHERE mid=?', [$m['mid']])->fetchAll(PDO::FETCH_COLUMN);
            foreach ([$m['a'], $m['b']] as $tm) {
                if (in_array($tm, $in, true) || !fxOnce("dm:ci2:{$m['mid']}:$tm", 86400)) continue;
                fx2Dm($db, $tm, '⏳ До конца чек-ина ' . max(1, intdiv($left + 59, 60)) . ' мин, а ' . fxName($db, $tm) . ' ещё не отметилась: ' . fxTitle($db, $m) . (!empty($db['settings']['autoForfeit']) ? '. Без чек-ина будет техническое поражение.' : '.') . "\n/checkin");
            }
        }
    }
    q('DELETE FROM kv WHERE exp<? AND (k LIKE ? OR k LIKE ?)', [$now, 'dm:%', 'tglink:%']);
}

/** true, если команда наша. */
function fx2Cli(array $argv): bool
{
    switch ($argv[1] ?? '') {
        case 'cron':
            fxCron();
            fx2Cron();
            return true;
        case 'peer-watch':
            fx2PeerWatch((string)($argv[2] ?? ''), (string)($argv[3] ?? ''));
            return true;
        case 'offsite':
            exit(fx2Offsite(array_slice($argv, 2)));
        case 'set-role':
            // php index.php set-role <login> admin|referee|-
            $role = ($argv[3] ?? '') === '-' ? '' : (string)($argv[3] ?? '');
            if ($role !== '' && !isset(ROLES[$role])) exit("role: admin | referee | -\n");
            $n = q('UPDATE users SET role=? WHERE login=?', [$role, (string)($argv[2] ?? '')])->rowCount();
            echo $n ? "ok\n" : "no change\n";
            return true;
    }
    return false;
}

// ---------- маршруты ----------

/** Маршруты второй очереди; если маршрут не наш, возвращает управление. */
function fx2Route(string $route): void
{
    switch ($route) {
        case 'GET health':
            ok(['ok' => true, 'rev' => (int)q('SELECT rev FROM site_meta WHERE id=1')->fetchColumn(), 'readonly' => readonlyMode(), 'at' => gmdate('c')]);

        case 'GET ics':
            fx2Ics(docRead()['db']);

        case 'GET elo':
            header('Cache-Control: public, max-age=120');
            ok(fx2Elo(docRead()['db']));

        case 'GET resultlog':
            $args = [str($_GET['t'] ?? '', 64, true)];
            $where = 'tid=?';
            if (isset($_GET['s'], $_GET['k'])) {
                $where .= ' AND sid=? AND mkey=?';
                array_push($args, str($_GET['s'], 64), str($_GET['k'], 100));
            }
            ok(array_map('fx2LogOut', q("SELECT * FROM result_log WHERE $where ORDER BY id DESC LIMIT 300", $args)->fetchAll()));

        case 'GET mymatches':
            $uid = currentUserId();
            if (!$uid) fail(401, 'Войдите в аккаунт');
            ok(fx2MyMatches(docRead()['db'], $uid));

        case 'POST tglink':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'Войдите в аккаунт');
            $bot = fx2Bot();
            if (!$bot) fail(409, 'Telegram-бот ещё не подключён организатором');
            $code = bin2hex(random_bytes(8));
            q('REPLACE INTO kv (k, v, exp) VALUES (?,?,?)', ["tglink:$code", $uid, time() + 900]);
            ok(['url' => "https://t.me/$bot?start=$code"]);

        case 'POST tgunlink':
            csrf();
            $uid = currentUserId();
            if (!$uid) fail(401, 'Войдите в аккаунт');
            q('UPDATE users SET tg_chat=NULL WHERE id=?', [$uid]);
            ok(['ok' => true]);

        case 'POST tgbot':
            $sec = kvGet('cfg:tgsecret');
            if (!is_string($sec) || !hash_equals($sec, (string)($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? ''))) fail(403, 'forbidden');
            $u = json_decode((string)file_get_contents('php://input'), true);
            ok(is_array($u) ? fx2TgUpdate($u) : ['ok' => true]);

        case 'POST tgsetup':
            requireAdmin();
            if (hooksCfg()['tgToken'] === '') fail(422, 'Сначала сохраните токен Telegram-бота');
            $me = tgCall('getMe', []);
            if (empty($me['ok'])) fail(502, 'Telegram: ' . ($me['description'] ?? 'нет ответа'));
            $sec = bin2hex(random_bytes(24));
            kvSet('cfg:tgsecret', $sec, 50 * 365 * 86400);
            $wh = tgCall('setWebhook', ['url' => fxSite() . '/api/?r=tgbot', 'secret_token' => $sec, 'allowed_updates' => ['message'], 'drop_pending_updates' => true]);
            if (empty($wh['ok'])) fail(502, 'Telegram setWebhook: ' . ($wh['description'] ?? 'нет ответа'));
            tgCall('setMyCommands', ['commands' => [
                ['command' => 'next', 'description' => 'Ближайшие матчи моих команд'], ['command' => 'today', 'description' => 'Матчи сегодня'],
                ['command' => 'checkin', 'description' => 'Пройти чек-ин'], ['command' => 'stop', 'description' => 'Отвязать аккаунт'],
            ]]);
            kvSet('cfg:tgbot', ['username' => (string)$me['result']['username']], 50 * 365 * 86400);
            ok(['ok' => true, 'bot' => (string)$me['result']['username']]);

        case 'GET picks':
            [$t, $s, $k] = fxMatchArg($_GET);
            $db = docRead()['db'];
            $m = fxFind($db, $t, $s, $k);
            ok(fx2PickState($m) + ['side' => fxSide($db, $m, currentUserId()), 'referee' => isReferee()]);

        case 'POST picktoss':
            csrf();
            [$t, $s, $k] = fxMatchArg(fxBody());
            $db = docRead()['db'];
            $m = fxFind($db, $t, $s, $k);
            if (!fxSide($db, $m, currentUserId()) && !isReferee()) fail(403, 'Монетку бросает капитан одной из команд или судья');
            $nx = fx2PickState($m)['next'];
            if (!$nx || $nx['step'] !== 'toss') fail(409, 'Жеребьёвка не нужна: выбирающая команда уже известна');
            $win = random_int(0, 1) ? $m['a'] : $m['b'];
            if (q('INSERT IGNORE INTO match_picks (mid, game, chooser, toss, user_id, at1) VALUES (?,?,?,1,?,?)', [$m['mid'], $nx['game'], $win, currentUserId() ?? '', now()])->rowCount() === 1) {
                notify('picks', "🪙 Жеребьёвка, игра {$nx['game']}: " . fxTitle($db, $m) . '. Выбирает ' . fxName($db, $win) . '.', fxLink($m));
            }
            ok(['ok' => true]);

        case 'POST pickside':
            csrf();
            $b = fxBody();
            [$t, $s, $k] = fxMatchArg($b);
            $db = docRead()['db'];
            $m = fxFind($db, $t, $s, $k);
            $choice = (string)($b['choice'] ?? '');
            if (!isset(PICK_CHOICES[$choice])) fail(422, 'bad choice');
            $nx = fx2PickState($m)['next'];
            if (!$nx || !in_array($nx['step'], ['c1', 'c2'], true)) fail(409, 'Сейчас выбирать нечего');
            $side = fxSide($db, $m, currentUserId());
            $mine = $side ? $m[$side] : null;
            $ref = isReferee();
            $uid = currentUserId() ?? '';
            if ($nx['step'] === 'c1') {
                if ($mine !== $nx['chooser'] && !$ref) fail(403, 'Сейчас выбирает ' . fxName($db, $nx['chooser']));
                q('INSERT INTO match_picks (mid, game, chooser, c1, toss, user_id, at1) VALUES (?,?,?,?,0,?,?) ON DUPLICATE KEY UPDATE c1=IF(c1 IS NULL, VALUES(c1), c1)', [$m['mid'], $nx['game'], $nx['chooser'], $choice, $uid, now()]);
            } else {
                $other = $nx['chooser'] === $m['a'] ? $m['b'] : $m['a'];
                if ($mine !== $other && !$ref) fail(403, 'Сейчас выбирает ' . fxName($db, $other));
                $isSide = in_array($nx['c1'], ['radiant', 'dire'], true);
                if (!in_array($choice, $isSide ? ['first', 'second'] : ['radiant', 'dire'], true)) fail(422, $isSide ? 'Выберите очерёдность пика' : 'Выберите сторону');
                if (q('UPDATE match_picks SET c2=?, at2=? WHERE mid=? AND game=? AND c2 IS NULL', [$choice, now(), $m['mid'], $nx['game']])->rowCount() === 1) {
                    notify('picks', "🎲 Игра {$nx['game']}, " . fxTitle($db, $m) . ': ' . fx2PickLine($db, $m, fx2PickResult($m, $nx['chooser'], $nx['c1'], $choice)), fxLink($m));
                }
            }
            ok(['ok' => true]);

        case 'POST pickreset':
            requireReferee();
            $b = fxBody();
            [$t, $s, $k] = fxMatchArg($b);
            $m = fxFind(docRead()['db'], $t, $s, $k);
            q('DELETE FROM match_picks WHERE mid=? AND game=?', [$m['mid'], (int)($b['game'] ?? 0)]);
            ok(['ok' => true]);

        case 'POST setresult':
            requireReferee();
            $b = fxBody();
            [$t, $s, $k] = fxMatchArg($b);
            $m = fxFind(docRead()['db'], $t, $s, $k);
            $status = in_array($b['status'] ?? '', ['scheduled', 'live', 'finished'], true) ? (string)$b['status'] : 'finished';
            $sa = max(0, (int)($b['scoreA'] ?? 0));
            $sb = max(0, (int)($b['scoreB'] ?? 0));
            if ($status === 'finished') fxCheckScore($m, $sa, $sb);
            $GLOBALS['FX_SRC'] = 'referee';
            fxSetResult($m, ['scoreA' => $sa, 'scoreB' => $sb, 'status' => $status] + (isset($b['note']) ? ['note' => str($b['note'], 300)] : []));
            if ($status === 'finished') q("UPDATE match_reports SET status='rejected' WHERE mid=? AND status IN ('pending','conflict')", [$m['mid']]);
            ok(['ok' => true]);

        case 'GET obs':
            // состояние эфира для OBS-сцен: опрашивается каждые 1–2 с, поэтому без сессии и без обращений к документу
            header('Cache-Control: no-store');
            $st = kvGet('obs:state');
            ok(['state' => is_array($st) ? $st : new stdClass(), 'now' => time(), 'can' => obsCanOperate()]);

        case 'POST obsset':
            obsRequireOperator();
            $b = fxBody();
            $patch = $b['patch'] ?? null;
            if (!is_array($patch)) fail(422, 'patch required');
            if (!array_key_exists('expectedRev', $b) || !is_numeric($b['expectedRev']))
                fail(428, 'Обновите страницу: старый пульт не поддерживает защиту совместного редактирования');
            $lockName = 'cup:obs:state';
            if ((int)q('SELECT GET_LOCK(?, 3)', [$lockName])->fetchColumn() !== 1) fail(503, 'Эфир занят, повторите действие');
            try {
                $cur = kvGet('obs:state');
                if (!is_array($cur)) $cur = [];
                $revision = (int)($cur['rev'] ?? 0);
                if (isset($b['expectedRev']) && (int)$b['expectedRev'] !== $revision)
                    fail(409, 'Состояние эфира изменил другой оператор. Данные обновлены, повторите действие.');
                foreach ($patch as $k => $v) {
                    if (!is_string($k) || !preg_match('/^[a-z][a-zA-Z0-9]{0,23}$/', $k) || $k === 'rev' || $k === 'at') continue;
                    if ($v === null) unset($cur[$k]);
                    else $cur[$k] = $v;
                }
                $cur['rev'] = $revision + 1;
                $cur['at'] = gmdate('c');
                if (strlen((string)json_encode($cur, JSON_UNESCAPED_UNICODE)) > 40000) fail(413, 'Слишком большой объём данных эфира');
                kvSet('obs:state', $cur, 50 * 365 * 86400);
            } finally {
                q('SELECT RELEASE_LOCK(?)', [$lockName]);
            }
            ok(['state' => $cur]);

        case 'GET obsheroes':
            header('Cache-Control: public, max-age=3600');
            $out = [];
            foreach (dotaHeroes() as $id => $h) $out[] = ['id' => (int)$id, 'name' => (string)$h[0], 'img' => (string)$h[1]];
            usort($out, fn($x, $y) => strcmp($x['name'], $y['name']));
            ok($out);

        case 'POST setrole':
            requireAdmin();
            $b = fxBody();
            $id = str($b['id'] ?? '', 32, true);
            $role = (string)($b['role'] ?? '');
            if ($role !== '' && !isset(ROLES[$role])) fail(422, 'bad role');
            if ($id === currentUserId()) fail(409, 'Свою роль менять нельзя');
            if (q('SELECT 1 FROM users WHERE id=?', [$id])->fetchColumn() === false) fail(404, 'not found');
            q('UPDATE users SET role=? WHERE id=?', [$role, $id]);
            ok(['ok' => true]);
    }
}
