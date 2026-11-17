<?php
// Скопируйте в config.php и заполните. config.php не коммитить.
return [
    // Хеш пароля админа: php -r "echo password_hash('ВАШ_ПАРОЛЬ', PASSWORD_DEFAULT), PHP_EOL;"
    'admin_password_hash' => '',
    // Папка с данными (вне веб-корня, если хостинг позволяет). Должна быть доступна PHP на запись.
    'data_dir' => __DIR__ . '/../../cup-data',
    // Twitch: https://dev.twitch.tv/console/apps → Register Application (OAuth Redirect: http://localhost)
    'twitch_client_id' => '',
    'twitch_client_secret' => '',
    // Лимиты
    'apply_limit_per_10min' => 3,
    'login_limit_per_10min' => 10,
];
