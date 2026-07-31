<?php
/** Conexión PDO singleton. Soporta MySQL (producción) y SQLite (desarrollo). */

function app_config(): array
{
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . '/config.php';
    }
    return $config;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $cfg = app_config()['db'];
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    if ($cfg['driver'] === 'sqlite') {
        $dir = dirname($cfg['sqlite_path']);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $pdo = new PDO('sqlite:' . $cfg['sqlite_path'], null, null, $options);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA journal_mode = WAL');
    } else {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $cfg['host'], $cfg['name']);
        $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], $options);
    }
    return $pdo;
}

function db_driver(): string
{
    return app_config()['db']['driver'];
}

/** Expresión SQL de nombre completo del paciente, válida en MySQL y SQLite. */
function sql_full_name(string $alias = ''): string
{
    $a = $alias !== '' ? $alias . '.' : '';
    $parts = [
        "{$a}first_name", "' '", "{$a}paternal_surname", "' '", "COALESCE({$a}maternal_surname,'')",
    ];
    return db_driver() === 'mysql'
        ? 'CONCAT(' . implode(', ', $parts) . ')'
        : implode(' || ', $parts);
}
