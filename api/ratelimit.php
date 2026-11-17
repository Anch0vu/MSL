<?php
declare(strict_types=1);

/*
 * Лимиты запросов через Redis: токен-бакеты, общие для всех процессов PHP.
 * Каждый запрос берёт токены из двух корзин:
 *   - общая корзина всего API (одна на всех посетителей, защита сервера целиком);
 *   - корзина «IP + класс маршрута» (чтение, запись, вход, заявки).
 * Клиент Redis минимальный (RESP по сокету), расширение php-redis не нужно.
 * Если Redis недоступен, вход и заявки считаются таблицей rate_limits в MySQL, остальное пропускается.
 */

const RL_LUA = <<<'LUA'
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local d = redis.call('HMGET', KEYS[1], 'tok', 'ts')
local tok = tonumber(d[1])
local ts = tonumber(d[2])
if tok == nil then tok = cap; ts = now end
tok = math.min(cap, tok + (now - ts) / 1000 * rate)
local ok = 0
local wait = 0
if tok >= cost then tok = tok - cost; ok = 1 else wait = math.ceil((cost - tok) / rate) end
redis.call('HSET', KEYS[1], 'tok', tostring(tok), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000) + 2000)
return {ok, math.floor(tok), wait}
LUA;

/** Минимальный клиент: одна команда, ответ RESP. null при любой ошибке соединения. */
function redisCall(array $args): mixed
{
    global $CFG;
    static $sock = null;
    $c = $CFG['redis'] ?? [];
    if ($sock === null) {
        $sock = @fsockopen($c['host'] ?? '127.0.0.1', (int)($c['port'] ?? 6379), $en, $es, 0.3) ?: false;
        if ($sock) {
            stream_set_timeout($sock, 0, 300000);
            if (!empty($c['password'])) redisWrite($sock, ['AUTH', (string)$c['password']]) && redisRead($sock);
            redisWrite($sock, ['SELECT', (string)($c['db'] ?? 7)]);
            if (redisRead($sock) !== 'OK') {
                fclose($sock);
                $sock = false;
            }
        }
    }
    if (!$sock) return null;
    if (!redisWrite($sock, $args)) return null;
    return redisRead($sock);
}

function redisWrite($sock, array $args): bool
{
    $out = '*' . count($args) . "\r\n";
    foreach ($args as $a) $out .= '$' . strlen((string)$a) . "\r\n" . $a . "\r\n";
    return @fwrite($sock, $out) !== false;
}

function redisRead($sock): mixed
{
    $line = @fgets($sock);
    if ($line === false) return null;
    $t = $line[0];
    $v = rtrim(substr($line, 1), "\r\n");
    switch ($t) {
        case '+': return $v;
        case '-': return null;
        case ':': return (int)$v;
        case '$':
            $n = (int)$v;
            if ($n < 0) return null;
            $data = '';
            while (strlen($data) < $n + 2) {
                $chunk = @fread($sock, $n + 2 - strlen($data));
                if ($chunk === false || $chunk === '') return null;
                $data .= $chunk;
            }
            return substr($data, 0, $n);
        case '*':
            $n = (int)$v;
            $arr = [];
            for ($i = 0; $i < $n; $i++) $arr[] = redisRead($sock);
            return $arr;
    }
    return null;
}

/** Взять $cost токенов из корзины. Возвращает [разрешено, осталось, секунд до пополнения] или null, если Redis недоступен. */
function bucketTake(string $key, float $cap, float $ratePerSec, int $cost = 1): ?array
{
    global $CFG;
    $prefix = $CFG['redis']['prefix'] ?? 'cup:rl:';
    $r = redisCall(['EVAL', RL_LUA, '1', $prefix . $key, (string)$cap, (string)$ratePerSec, (string)$cost]);
    return is_array($r) && count($r) === 3 ? [(int)$r[0] === 1, (int)$r[1], (int)$r[2]] : null;
}

/** Класс маршрута: [название, ёмкость, токенов в секунду, ключ конфига для пересчёта «в 10 минут»]. */
function routeClass(string $route): array
{
    global $CFG;
    $per10 = fn(string $k, int $def) => (float)($CFG[$k] ?? $def);
    return match ($route) {
        'POST login', 'POST signin', 'GET steamlogin', 'GET steamcb' => ['auth', $per10('login_limit_per_10min', 10), $per10('login_limit_per_10min', 10) / 600],
        'POST signup' => ['signup', $per10('signup_limit_per_10min', 5), $per10('signup_limit_per_10min', 5) / 600],
        'POST apply' => ['apply', $per10('apply_limit_per_10min', 3), $per10('apply_limit_per_10min', 3) / 600],
        'PUT db', 'POST decide', 'POST resetpw', 'POST deluser', 'POST account', 'POST myteam', 'POST avatar', 'POST dotasync', 'POST teammedia', 'POST claimteam', 'POST ask', 'POST answerq', 'POST delq',
        'POST checkin', 'POST report', 'POST reportdecide', 'POST addgame', 'POST delgame', 'POST faceit', 'POST hooks', 'POST hooktest',
        'POST tglink', 'POST tgunlink', 'POST tgsetup', 'POST picktoss', 'POST pickside', 'POST pickreset', 'POST setresult', 'POST setrole' => ['write', 30.0, 0.5],
        'GET ogimg' => ['og', 30.0, 1.0],
        'GET twitch' => ['twitch', 20.0, 0.2],
        'GET gamestats' => ['gstats', 30.0, 0.5],
        default => ['read', 60.0, 20.0],
    };
}

/** Применяет лимиты ко всем маршрутам API. При превышении отвечает 429 с Retry-After. */
function throttle(string $route): void
{
    global $CFG;
    $ip = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|cup');
    [$cls, $cap, $rate] = routeClass($route);

    $global = bucketTake('all', (float)($CFG['rl_global_burst'] ?? 600), (float)($CFG['rl_global_rate'] ?? 200));
    if ($global === null) {
        // Redis недоступен: чувствительные маршруты считаем в MySQL, остальное пропускаем
        if (in_array($cls, ['auth', 'signup', 'apply'], true)) rateLimit($cls === 'signup' ? 'signup' : ($cls === 'apply' ? 'apply' : 'login'), (int)$cap);
        return;
    }
    $mine = bucketTake("ip:$ip:$cls", $cap, $rate);
    foreach ([$global, $mine] as $r) {
        if ($r !== null && !$r[0]) {
            header('Retry-After: ' . max(1, $r[2]));
            fail(429, 'Слишком много запросов, подождите ' . max(1, $r[2]) . ' с');
        }
    }
    if ($mine) header('X-RateLimit-Remaining: ' . $mine[1]);
}
