<?php
/**
 * Fichas de empleado: antigüedad, jornada y vacaciones.
 *
 * Lo que se CAPTURA (fecha de inicio, jornada, días que le corresponden, registros de vacaciones)
 * vive en employee_profiles / employee_vacations; lo que se MUESTRA como resultado (tiempo con
 * nosotros, días tomados y restantes) siempre se calcula aquí, nunca se guarda, para que no
 * pueda quedar desfasado de los datos que lo originan.
 *
 * El servidor es la fuente de verdad. assets/js/modules/empleados.js repite tenure y conteo de
 * días solo para la vista previa mientras se escribe; si cambias un algoritmo aquí, cámbialo allá.
 */

const EMPLOYEE_TIMEZONE = 'America/Mexico_City';
const EMPLOYEE_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];   // date('N') 1..7
const EMPLOYEE_MAX_RANGE_DAYS = 366;

/** Datos que el administrador decide mostrar u ocultar al empleado (uno por casilla). */
const EMPLOYEE_VISIBLE_KEYS = [
    'full_name', 'contact', 'institutional_email', 'start_date', 'tenure',
    'vacation_entitled', 'vacation_remaining', 'vacation_taken', 'schedule',
];

function employee_today(): DateTimeImmutable
{
    return new DateTimeImmutable('today', new DateTimeZone(EMPLOYEE_TIMEZONE));
}

/** 'YYYY-MM-DD' estricto (calendario real: 2026-02-30 no existe) o null. */
function employee_parse_date($value): ?DateTimeImmutable
{
    if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
        return null;
    }
    if (!checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
        return null;
    }
    return new DateTimeImmutable($value, new DateTimeZone(EMPLOYEE_TIMEZONE));
}

function employee_plural(int $n, string $one, string $many): string
{
    return $n . ' ' . ($n === 1 ? $one : $many);
}

/**
 * Tiempo transcurrido desde la fecha de inicio: años, meses y días completos.
 * Se cuenta en meses completos desde la fecha de inicio; los días son los que sobran.
 *
 * @return array{years:int, months:int, days:int, total_days:int, started:bool, text:string}|null
 */
function employee_tenure(?string $start, ?DateTimeImmutable $today = null): ?array
{
    $s = employee_parse_date($start);
    if (!$s) {
        return null;
    }
    $t = $today ?? employee_today();
    if ($s > $t) {
        return ['years' => 0, 'months' => 0, 'days' => 0, 'total_days' => 0, 'started' => false,
                'text' => 'Aún no inicia (comienza el ' . $s->format('d/m/Y') . ')'];
    }
    // Meses completos: el mayor número de meses que, sumados a la fecha de inicio, no pasa de hoy.
    // Al sumar meses el día se recorta al fin de mes (31 ene + 1 mes = 28 feb), así los días que
    // sobran nunca salen negativos. Los días son los que hay desde esa fecha hasta hoy.
    $addMonths = static function (int $months) use ($s): DateTimeImmutable {
        $m0 = (int)$s->format('n') - 1 + $months;
        $yy = (int)$s->format('Y') + intdiv($m0, 12);
        $mm = $m0 % 12 + 1;
        $dim = (int)(new DateTimeImmutable(sprintf('%04d-%02d-01', $yy, $mm), $s->getTimezone()))->format('t');
        return new DateTimeImmutable(sprintf('%04d-%02d-%02d', $yy, $mm, min((int)$s->format('j'), $dim)), $s->getTimezone());
    };
    $total = ((int)$t->format('Y') - (int)$s->format('Y')) * 12 + ((int)$t->format('n') - (int)$s->format('n'));
    $anchor = $addMonths($total);
    if ($anchor > $t) {
        $total--;
        $anchor = $addMonths($total);
    }
    $y = intdiv($total, 12);
    $m = $total % 12;
    $d = (int)$anchor->diff($t)->days;
    $parts = [];
    if ($y > 0) $parts[] = employee_plural($y, 'año', 'años');
    if ($m > 0) $parts[] = employee_plural($m, 'mes', 'meses');
    if ($d > 0) $parts[] = employee_plural($d, 'día', 'días');
    if (!$parts) {
        $text = 'Hoy es su primer día';
    } elseif (count($parts) === 1) {
        $text = $parts[0];
    } else {
        $last = array_pop($parts);
        $text = implode(', ', $parts) . ' y ' . $last;
    }
    return ['years' => $y, 'months' => $m, 'days' => $d, 'total_days' => (int)$s->diff($t)->days,
            'started' => true, 'text' => $text];
}

/** Jornada vacía: ningún día marcado. */
function employee_empty_schedule(): array
{
    $days = [];
    foreach (EMPLOYEE_WEEKDAYS as $k) {
        $days[$k] = ['on' => false, 'from' => null, 'to' => null];
    }
    return ['days' => $days, 'note' => ''];
}

/**
 * Valida y normaliza una jornada recibida del cliente.
 * @throws InvalidArgumentException con un mensaje listo para mostrar.
 */
function employee_normalize_schedule($raw): array
{
    $out = employee_empty_schedule();
    if (!is_array($raw)) {
        return $out;
    }
    $names = ['mon' => 'lunes', 'tue' => 'martes', 'wed' => 'miércoles', 'thu' => 'jueves',
              'fri' => 'viernes', 'sat' => 'sábado', 'sun' => 'domingo'];
    $time = '/^([01]\d|2[0-3]):[0-5]\d$/';
    foreach (EMPLOYEE_WEEKDAYS as $k) {
        $d = $raw['days'][$k] ?? null;
        if (!is_array($d)) {
            continue;
        }
        $on = !empty($d['on']);
        $from = isset($d['from']) && is_string($d['from']) && preg_match($time, $d['from']) ? $d['from'] : null;
        $to = isset($d['to']) && is_string($d['to']) && preg_match($time, $d['to']) ? $d['to'] : null;
        if ($on) {
            if ($from === null || $to === null) {
                throw new InvalidArgumentException('Indica la hora de entrada y de salida del ' . $names[$k]);
            }
            if ($to <= $from) {
                throw new InvalidArgumentException('La salida del ' . $names[$k] . ' debe ser después de la entrada');
            }
        }
        $out['days'][$k] = ['on' => $on, 'from' => $from, 'to' => $to];
    }
    $note = trim((string)($raw['note'] ?? ''));
    if (mb_strlen($note) > 300) {
        throw new InvalidArgumentException('La nota de la jornada no puede pasar de 300 caracteres');
    }
    $out['note'] = $note;
    return $out;
}

function employee_decode_schedule(?string $json): array
{
    $raw = $json ? json_decode($json, true) : null;
    try {
        return employee_normalize_schedule($raw);
    } catch (InvalidArgumentException $e) {
        return employee_empty_schedule();   // dato viejo o dañado: se trata como "sin jornada"
    }
}

function employee_has_workdays(array $schedule): bool
{
    foreach ($schedule['days'] as $d) {
        if (!empty($d['on'])) {
            return true;
        }
    }
    return false;
}

/** Horas por semana de la jornada (se muestra junto a ella). */
function employee_weekly_hours(array $schedule): float
{
    $min = 0;
    foreach ($schedule['days'] as $d) {
        if (!empty($d['on']) && $d['from'] && $d['to']) {
            [$fh, $fm] = array_map('intval', explode(':', $d['from']));
            [$th, $tm] = array_map('intval', explode(':', $d['to']));
            $min += max(0, ($th * 60 + $tm) - ($fh * 60 + $fm));
        }
    }
    return round($min / 60, 1);
}

/**
 * Días de vacaciones de un rango (ambos extremos incluidos).
 * Con jornada configurada cuenta solo los días de la semana que el empleado trabaja; sin ella
 * cuenta todos los días naturales y lo dice en 'mode' para que la pantalla lo avise.
 *
 * @return array{days:int, span:int, mode:string}
 */
function employee_count_days(DateTimeImmutable $from, DateTimeImmutable $to, array $schedule): array
{
    $useSchedule = employee_has_workdays($schedule);
    $span = (int)$from->diff($to)->days + 1;
    $count = 0;
    for ($i = 0; $i < $span; $i++) {
        $day = $from->modify("+$i day");
        $key = EMPLOYEE_WEEKDAYS[(int)$day->format('N') - 1];
        if (!$useSchedule || !empty($schedule['days'][$key]['on'])) {
            $count++;
        }
    }
    return ['days' => $count, 'span' => $span, 'mode' => $useSchedule ? 'jornada' : 'naturales'];
}

/** Claves visibles guardadas; sin configuración todavía, se muestra todo. */
function employee_visible_keys(?string $json): array
{
    if ($json === null || $json === '') {
        return EMPLOYEE_VISIBLE_KEYS;
    }
    $list = json_decode($json, true);
    if (!is_array($list)) {
        return EMPLOYEE_VISIBLE_KEYS;
    }
    return array_values(array_intersect(EMPLOYEE_VISIBLE_KEYS, $list));
}

function employee_normalize_visible($raw): array
{
    return is_array($raw) ? array_values(array_intersect(EMPLOYEE_VISIBLE_KEYS, array_map('strval', $raw))) : [];
}

function employee_vacation_rows(int $userId): array
{
    $st = db()->prepare(
        'SELECT id, date_from, date_to, days, notes, created_at FROM employee_vacations
         WHERE user_id = ? ORDER BY date_from DESC, id DESC'
    );
    $st->execute([$userId]);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['days'] = (float)$r['days'];
    }
    unset($r);
    return $rows;
}

function employee_find_profile(int $userId): ?array
{
    $st = db()->prepare('SELECT * FROM employee_profiles WHERE user_id = ?');
    $st->execute([$userId]);
    $row = $st->fetch();
    return $row ?: null;
}

/**
 * Todo lo de un empleado, ya calculado.
 * Con $forEmployee solo salen los datos que el administrador decidió mostrar: lo oculto NO viaja
 * en la respuesta (esconderlo en pantalla no bastaría: se vería en la pestaña de red).
 */
function employee_view(array $user, bool $forEmployee): array
{
    $userId = (int)$user['id'];
    $p = employee_find_profile($userId);
    $visible = employee_visible_keys($p['visible_fields'] ?? null);
    $schedule = employee_decode_schedule($p['work_schedule'] ?? null);
    $vacations = employee_vacation_rows($userId);
    $entitled = $p ? (float)$p['vacation_days_entitled'] : 0.0;
    $taken = 0.0;
    foreach ($vacations as $v) {
        $taken += $v['days'];
    }
    $taken = round($taken, 1);

    $all = [
        'full_name' => $user['full_name'],
        'contact' => [
            'phone' => $p['contact_phone'] ?? null,
            'email_personal' => $p['contact_email_personal'] ?? null,
            'address' => $p['contact_address'] ?? null,
            'emergency_name' => $p['emergency_name'] ?? null,
            'emergency_phone' => $p['emergency_phone'] ?? null,
        ],
        'institutional_email' => $p['institutional_email'] ?? null,
        'start_date' => $p['start_date'] ?? null,
        'tenure' => employee_tenure($p['start_date'] ?? null),
        'vacation' => [
            'entitled' => $entitled,
            'taken' => $taken,
            'remaining' => round($entitled - $taken, 1),
            'over' => ($entitled - $taken) < 0,
            'records' => $vacations,
        ],
        'schedule' => $schedule + ['weekly_hours' => employee_weekly_hours($schedule)],
    ];

    if (!$forEmployee) {
        return ['user_id' => $userId, 'configured' => $p !== null, 'visible' => $visible] + $all
            + ['username' => $user['username'], 'is_active' => (bool)$user['is_active']];
    }

    // Vista del empleado: solo lo permitido. 'vacation' se arma por piezas porque cada pieza
    // tiene su propia casilla (correspondientes / restantes / tomados con su desglose).
    $out = ['configured' => $p !== null];
    if ($p === null) {
        $out['full_name'] = $all['full_name'];
        return $out;
    }
    $has = static fn(string $k) => in_array($k, $visible, true);
    if ($has('full_name')) $out['full_name'] = $all['full_name'];
    if ($has('contact')) $out['contact'] = $all['contact'];
    if ($has('institutional_email')) $out['institutional_email'] = $all['institutional_email'];
    if ($has('start_date')) $out['start_date'] = $all['start_date'];
    if ($has('tenure')) $out['tenure'] = $all['tenure'];
    if ($has('schedule')) $out['schedule'] = $all['schedule'];
    $vac = [];
    if ($has('vacation_entitled')) $vac['entitled'] = $entitled;
    if ($has('vacation_remaining')) { $vac['remaining'] = $all['vacation']['remaining']; $vac['over'] = $all['vacation']['over']; }
    if ($has('vacation_taken')) { $vac['taken'] = $taken; $vac['records'] = $vacations; }
    if ($vac) $out['vacation'] = $vac;
    return $out;
}
