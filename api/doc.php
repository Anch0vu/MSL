<?php
declare(strict_types=1);

/*
 * Документ сайта (команды, игроки, турниры, матчи, новости...) в реляционных таблицах d_*.
 * Известные поля — обычные колонки, неизвестные и нетипичные значения сохраняются в колонке extra,
 * поэтому формат, который видит фронт, остаётся прежним и ничего не теряется.
 * Типы: s — строка, i — целое, b — bool, j — вложенная структура (JSON-колонка).
 */

const DOC_SECTIONS = [
    'teams' => ['d_teams', ['id' => 's', 'name' => 's', 'tag' => 's', 'color' => 's', 'faculty' => 's', 'orgId' => 's', 'ownerId' => 's', 'captainId' => 's', 'about' => 's', 'contact' => 's', 'links' => 'j']],
    'players' => ['d_players', ['id' => 's', 'nick' => 's', 'name' => 's', 'role' => 's', 'teamId' => 's', 'faculty' => 's', 'course' => 'i', 'country' => 's', 'about' => 's', 'twitch' => 's', 'contact' => 's']],
    'matches' => ['d_matches', ['tournamentId' => 's', 'stageId' => 's', 'key' => 's', 'group' => 's', 'teamA' => 's', 'teamB' => 's', 'scoreA' => 'i', 'scoreB' => 'i', 'status' => 's', 'date' => 's', 'maps' => 'j', 'stream' => 's', 'note' => 's']],
    'news' => ['d_news', ['id' => 's', 'title' => 's', 'date' => 's', 'tag' => 's', 'excerpt' => 's', 'body' => 's', 'tournamentId' => 's', 'pinned' => 'b', 'cover' => 's']],
    'highlights' => ['d_highlights', ['id' => 's', 'title' => 's', 'url' => 's', 'date' => 's', 'tournamentId' => 's']],
    'orgs' => ['d_orgs', ['id' => 's', 'name' => 's', 'short' => 's', 'kind' => 's', 'description' => 's', 'site' => 's']],
    'tournaments' => ['d_tournaments', ['id' => 's', 'name' => 's', 'short' => 's', 'status' => 's', 'startDate' => 's', 'endDate' => 's', 'prize' => 's', 'format' => 's', 'maxTeams' => 'i', 'description' => 's', 'rules' => 's']],
];
const STAGE_SPEC = ['id' => 's', 'type' => 's', 'name' => 's', 'bo' => 'i', 'advance' => 'i', 'size' => 'i', 'finalBo' => 'i', 'thirdPlace' => 'b', 'groups' => 'j', 'seeds' => 'j'];

function docSnake(string $k): string
{
    return strtolower((string)preg_replace('/([a-z0-9])([A-Z])/', '$1_$2', $k));
}

function docEnc(array $v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR) ?: '[]';
}

/** Раскладывает объект на колонки по spec; всё лишнее уходит в extra. */
function docRow(array $obj, array $spec, array $skip = []): array
{
    $row = [];
    $extra = [];
    foreach ($obj as $k => $v) {
        if (in_array($k, $skip, true)) continue;
        $t = $spec[$k] ?? null;
        $fit = match ($t) {
            's' => is_string($v),
            'i' => is_int($v),
            'b' => is_bool($v),
            'j' => is_array($v),
            default => false,
        };
        if ($fit) $row[docSnake((string)$k)] = $t === 'j' ? docEnc($v) : ($t === 'b' ? (int)$v : $v);
        else $extra[$k] = $v;
    }
    $row['extra'] = $extra ? docEnc($extra) : null;
    return $row;
}

function docObj(array $row, array $spec): array
{
    $o = [];
    foreach ($spec as $k => $t) {
        $v = $row[docSnake($k)] ?? null;
        if ($v === null) continue;
        $o[$k] = match ($t) {
            'i' => (int)$v,
            'b' => (bool)$v,
            'j' => json_decode((string)$v, true) ?? [],
            default => (string)$v,
        };
    }
    if (!empty($row['extra'])) $o = array_merge($o, json_decode((string)$row['extra'], true) ?: []);
    return $o;
}

function docInsert(string $table, array $row): void
{
    $cols = array_keys($row);
    q("INSERT INTO `$table` (" . implode(',', array_map(fn($c) => "`$c`", $cols)) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')', array_values($row));
}

/** Собирает документ из таблиц. */
function docLoad(): array
{
    $db = [];
    foreach (DOC_SECTIONS as $name => [$table, $spec]) {
        if ($name === 'tournaments') continue;
        $db[$name] = array_map(fn($r) => docObj($r, $spec), q("SELECT * FROM `$table` ORDER BY pos")->fetchAll());
    }
    $teams = [];
    foreach (q('SELECT tournament_id, team_id FROM d_tournament_teams ORDER BY pos')->fetchAll() as $r) $teams[$r['tournament_id']][] = $r['team_id'];
    $stages = [];
    foreach (q('SELECT * FROM d_stages ORDER BY pos')->fetchAll() as $r) $stages[$r['tournament_id']][] = docObj($r, STAGE_SPEC);
    [$table, $spec] = DOC_SECTIONS['tournaments'];
    $db['tournaments'] = [];
    foreach (q("SELECT * FROM `$table` ORDER BY pos")->fetchAll() as $r) {
        $t = docObj($r, $spec);
        $t['teams'] = $teams[$t['id'] ?? ''] ?? [];
        $t['stages'] = $stages[$t['id'] ?? ''] ?? [];
        $db['tournaments'][] = $t;
    }
    $settings = [];
    foreach (q('SELECT k, v FROM d_settings')->fetchAll() as $r) $settings[$r['k']] = json_decode((string)$r['v'], true);
    $db['settings'] = $settings ?: new stdClass();
    foreach (q('SELECT k, v FROM d_meta')->fetchAll() as $r) $db[$r['k']] = json_decode((string)$r['v'], true);
    $db['rules'] = is_string($db['rules'] ?? null) ? $db['rules'] : '';
    return $db;
}

/** Полностью заменяет содержимое таблиц документом (вызывать внутри транзакции). */
function docStore(array $db): void
{
    foreach (['d_tournament_teams', 'd_stages', 'd_settings', 'd_meta'] as $t) q("DELETE FROM `$t`");
    foreach (DOC_SECTIONS as $name => [$table, $spec]) {
        q("DELETE FROM `$table`");
        $list = $db[$name] ?? [];
        if (!is_array($list)) continue;
        foreach (array_values($list) as $pos => $obj) {
            if (!is_array($obj)) continue;
            $row = ['pos' => $pos] + docRow($obj, $spec, $name === 'tournaments' ? ['teams', 'stages'] : []);
            docInsert($table, $row);
            if ($name !== 'tournaments') continue;
            $tid = (string)($obj['id'] ?? '');
            foreach (array_values(is_array($obj['teams'] ?? null) ? $obj['teams'] : []) as $i => $team) {
                docInsert('d_tournament_teams', ['tournament_id' => $tid, 'pos' => $i, 'team_id' => (string)$team]);
            }
            foreach (array_values(is_array($obj['stages'] ?? null) ? $obj['stages'] : []) as $i => $stage) {
                if (is_array($stage)) docInsert('d_stages', ['tournament_id' => $tid, 'pos' => $i] + docRow($stage, STAGE_SPEC));
            }
        }
    }
    foreach ((array)($db['settings'] ?? []) as $k => $v) {
        q('INSERT INTO d_settings (k, v) VALUES (?,?)', [(string)$k, json_encode($v, JSON_UNESCAPED_UNICODE)]);
    }
    foreach ($db as $k => $v) {
        if (isset(DOC_SECTIONS[$k]) || $k === 'settings') continue;
        q('INSERT INTO d_meta (k, v) VALUES (?,?)', [(string)$k, json_encode($v, JSON_UNESCAPED_UNICODE)]);
    }
}
