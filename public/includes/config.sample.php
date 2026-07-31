<?php
/**
 * Configuración de Sirius.
 * Copia este archivo como config.php y ajusta los valores.
 * config.php NUNCA debe subirse a un repositorio público.
 */
return [
    // 'mysql' en producción (HostGator) | 'sqlite' solo para desarrollo local
    'db' => [
        'driver'      => 'mysql',
        // MySQL (producción)
        'host'        => 'localhost',
        'name'        => 'adminsky_sirius',
        'user'        => 'adminsky_sirius',
        'pass'        => 'CAMBIAR',
        // SQLite (solo desarrollo)
        'sqlite_path' => __DIR__ . '/../../data/sirius.sqlite',
    ],

    // 'dev' muestra errores; 'prod' los oculta
    'app_env' => 'prod',

    // Clave requerida para ejecutar install/setup.php (?key=...)
    // Tras instalar en producción, BORRA la carpeta install/.
    'install_key' => 'CAMBIA-ESTA-CLAVE',

    // Clave requerida para cron_calendar_sync.php cuando se invoca por URL (?key=...).
    // No hace falta si el cron job de cPanel ejecuta el script por línea de comandos (php-cli).
    'cron_key' => 'CAMBIA-ESTA-CLAVE-TAMBIEN',

    // Ruta a un paquete de certificados raíz (cacert.pem). Déjalo vacío salvo que
    // el servidor no traiga uno y las llamadas al asistente fallen por certificado.
    'ca_bundle' => '',
];
