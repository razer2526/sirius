<?php
/**
 * Generación del PDF de los estudios membretados con FPDF.
 * El diseño sigue el formato oficial del laboratorio: los datos del paciente se
 * repiten en el encabezado de cada página, los resultados van en tablas con barra
 * de sección y los positivos se resaltan. El membrete (encabezado, pie, marca de
 * agua y firma) viene de la configuración de Admin Tools > Membretes.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/letterhead.php';
require_once __DIR__ . '/doc_templates.php';
require_once __DIR__ . '/services.php';
require_once __DIR__ . '/../vendor/fpdf/fpdf.php';

/** Paleta del reporte. */
const PDF_BLUE       = [26, 74, 100];   // barras de sección y títulos
const PDF_INK        = [31, 41, 55];    // texto principal
const PDF_MUTED      = [107, 114, 128]; // etiquetas
const PDF_LINE       = [203, 213, 225]; // separadores
const PDF_ZEBRA      = [247, 249, 250]; // filas alternas
const PDF_HEAD_BG    = [238, 242, 245]; // encabezado de tablas
const PDF_BOX_BG     = [247, 249, 251]; // caja de datos de muestra
const PDF_BOX_BORDER = [226, 232, 240];
const PDF_POS_TEXT   = [155, 28, 28];   // positivos
const PDF_POS_BG     = [253, 238, 238];

class SiriusDocPDF extends FPDF
{
    private array $lh;
    private array $info = [];      // pares etiqueta/valor del encabezado del paciente
    private bool $lastPage = false;
    private ?string $headerImg;
    private ?string $footerImg;
    private ?string $watermarkImg;
    private string $clinicName;

    public function __construct(array $letterhead, string $clinicName)
    {
        parent::__construct('P', 'mm', 'Letter');
        $this->lh = $letterhead;
        $this->clinicName = $clinicName;
        $this->headerImg    = pdf_safe_image(letterhead_path($letterhead['header_file']));
        $this->footerImg    = pdf_safe_image(letterhead_path($letterhead['footer_file']));
        $this->watermarkImg = pdf_safe_image(letterhead_watermark_flat($letterhead));

        $this->SetMargins((float)$letterhead['margin_left'], 0, (float)$letterhead['margin_right']);
        // Las páginas intermedias solo llevan la línea con el folio de página; la última
        // reserva el alto del pie corporativo.
        $this->SetAutoPageBreak(true, 20);
        $this->AliasNbPages();
    }

    public function setPatientInfo(array $rows): void
    {
        $this->info = $rows;
    }

    public function markLastPage(): void
    {
        $this->lastPage = true;
        $this->SetAutoPageBreak(true, (float)$this->lh['footer_height'] + (float)$this->lh['footer_bottom'] + 6);
    }

    /** Última coordenada Y utilizable de la página actual. */
    public function contentLimit(): float
    {
        return $this->GetPageHeight() - $this->bMargin;
    }

    /**
     * Salta de página si el bloque que sigue no cabe completo, para que las tablas
     * no se partan a media fila. $onNewPage repite lo que haga falta (encabezados).
     */
    public function ensureSpace(float $needed, ?callable $onNewPage = null): void
    {
        if ($this->GetY() + $needed <= $this->contentLimit()) {
            return;
        }
        $this->AddPage();
        if ($onNewPage) {
            $onNewPage($this);
        }
    }

    public function usableWidth(): float
    {
        return $this->GetPageWidth() - (float)$this->lh['margin_left'] - (float)$this->lh['margin_right'];
    }

    private function left(): float
    {
        return (float)$this->lh['margin_left'];
    }

    private function right(): float
    {
        return $this->GetPageWidth() - (float)$this->lh['margin_right'];
    }

    /* ---------- Encabezado y pie ---------- */

    function Header(): void
    {
        // La marca de agua va primero para que todo lo demás quede encima
        if ($this->watermarkImg) {
            $w = (float)$this->lh['watermark_width'];
            @$this->Image($this->watermarkImg, ($this->GetPageWidth() - $w) / 2, ($this->GetPageHeight() - $w) / 2, $w);
        }

        if ($this->headerImg) {
            @$this->Image($this->headerImg, $this->left(), (float)$this->lh['header_top'], $this->usableWidth());
            $this->SetY((float)$this->lh['header_top'] + (float)$this->lh['header_height'] + 4);
        } else {
            $this->SetY((float)$this->lh['header_top']);
            $this->SetFont('Helvetica', 'B', 13);
            $this->SetTextColor(...PDF_BLUE);
            $this->Cell(0, 7, pdf_t($this->clinicName), 0, 1, 'C');
            $this->SetFont('Helvetica', '', 8);
            $this->SetTextColor(...PDF_MUTED);
            $this->Cell(0, 4, pdf_t('Laboratorio de análisis clínicos · Biología molecular'), 0, 1, 'C');
            $this->Ln(3);
        }

        $this->patientHeader();
    }

    /**
     * Bloque de identificación del paciente, repetido en cada página.
     * Las columnas se calculan a partir del texto real: así los nombres y las
     * direcciones largas se ven completos en vez de recortarse.
     */
    private function patientHeader(): void
    {
        $w = $this->usableWidth();
        $h = 6.6;
        $gap = 3;   // aire entre una etiqueta y su valor

        // Ancho que ocupa cada texto con la tipografía con la que se va a imprimir
        $span = function (string $text, float $size, bool $bold = false): float {
            $this->SetFont('Helvetica', $bold ? 'B' : '', $size);
            return $this->GetStringWidth(pdf_t($text));
        };

        $labelL = 0.0;
        $labelR = 0.0;
        $needL  = 0.0;
        $needR  = 0.0;
        foreach ($this->info as $row) {
            [$l1, $v1, $l2, $v2] = array_pad($row, 4, null);
            $labelL = max($labelL, $span($l1 . ':', 9));
            if ($l2 === null) {
                continue;   // las filas completas no condicionan la columna derecha
            }
            $labelR = max($labelR, $span($l2 . ':', 9));
            $needL  = max($needL, $span((string)$v1, 9.5, !empty($row['bold'])));
            $needR  = max($needR, $span((string)$v2, 9.5));
        }
        $labelL += $gap;
        $labelR += $gap;

        // Lo que sobra se reparte según lo que pide cada columna; si no alcanza para
        // ambas, la fila se abre en dos renglones de ancho completo.
        $avail = $w - $labelL - $labelR;
        $fitL = ($needL + $gap + $needR <= $avail)
            ? $needL
            : max($avail * 0.30, min($needL, $avail * 0.52));
        $valueL = $fitL + $gap;   // el hueco separa el valor de la etiqueta siguiente
        $valueR = $avail - $valueL;

        foreach ($this->info as $row) {
            [$l1, $v1, $l2, $v2] = array_pad($row, 4, null);
            $bold = !empty($row['bold']);
            $full = $l2 === null
                || $span((string)$v1, 9.5, $bold) > $fitL
                || $span((string)$v2, 9.5) > $valueR;

            $this->SetFont('Helvetica', '', 9);
            $this->SetTextColor(...PDF_MUTED);
            $this->Cell($labelL, $h, pdf_t($l1 . ':'), 0, 0, 'L');

            $this->SetFont('Helvetica', $bold ? 'B' : '', 9.5);
            $this->SetTextColor(...PDF_INK);
            if ($full) {
                $this->Cell($w - $labelL, $h, pdf_t(pdf_fit($this, (string)$v1, $w - $labelL)), 0, 1, 'L');
                if ($l2 !== null) {
                    $this->SetFont('Helvetica', '', 9);
                    $this->SetTextColor(...PDF_MUTED);
                    $this->Cell($labelL, $h, pdf_t($l2 . ':'), 0, 0, 'L');
                    $this->SetFont('Helvetica', '', 9.5);
                    $this->SetTextColor(...PDF_INK);
                    $this->Cell($w - $labelL, $h, pdf_t(pdf_fit($this, (string)$v2, $w - $labelL)), 0, 1, 'L');
                }
                continue;
            }
            $this->Cell($valueL, $h, pdf_t((string)$v1), 0, 0, 'L');

            $this->SetFont('Helvetica', '', 9);
            $this->SetTextColor(...PDF_MUTED);
            $this->Cell($labelR, $h, pdf_t($l2 . ':'), 0, 0, 'L');

            $this->SetFont('Helvetica', '', 9.5);
            $this->SetTextColor(...PDF_INK);
            $this->Cell($valueR, $h, pdf_t((string)$v2), 0, 1, 'L');
        }

        $this->Ln(2);
        $this->SetDrawColor(...PDF_LINE);
        $this->SetLineWidth(0.2);
        $this->Line($this->left(), $this->GetY(), $this->right(), $this->GetY());
        $this->Ln(5);
        $this->SetTextColor(...PDF_INK);
    }

    function Footer(): void
    {
        // El pie corporativo solo va en la última página; las demás llevan folio de página
        if ($this->lastPage && $this->footerImg) {
            @$this->Image(
                $this->footerImg,
                $this->left(),
                $this->GetPageHeight() - (float)$this->lh['footer_bottom'] - (float)$this->lh['footer_height'],
                $this->usableWidth()
            );
            return;
        }
        $y = $this->GetPageHeight() - 16;
        $this->SetDrawColor(...PDF_LINE);
        $this->SetLineWidth(0.2);
        $this->Line($this->left(), $y, $this->right(), $y);
        if (!empty($this->lh['show_page_numbers'])) {
            $this->SetY($y + 1);
            $this->SetFont('Helvetica', '', 8);
            $this->SetTextColor(...PDF_MUTED);
            $this->Cell(0, 5, pdf_t('Página ' . $this->PageNo() . ' de {nb}'), 0, 0, 'R');
            $this->SetTextColor(...PDF_INK);
        }
    }

    /* ---------- Bloques del cuerpo ---------- */

    /** Rectángulo con esquinas redondeadas (FPDF no lo trae de fábrica). */
    public function roundedRect(float $x, float $y, float $w, float $h, float $r, string $style = 'F'): void
    {
        $k = $this->k;
        $hp = $this->h;
        $op = $style === 'F' ? 'f' : ($style === 'FD' || $style === 'DF' ? 'B' : 'S');
        $myArc = 4 / 3 * (sqrt(2) - 1);
        $this->_out(sprintf('%.2F %.2F m', ($x + $r) * $k, ($hp - $y) * $k));
        $xc = $x + $w - $r;
        $yc = $y + $r;
        $this->_out(sprintf('%.2F %.2F l', $xc * $k, ($hp - $y) * $k));
        $this->arcTo($xc + $r * $myArc, $yc - $r, $xc + $r, $yc - $r * $myArc, $xc + $r, $yc);
        $xc = $x + $w - $r;
        $yc = $y + $h - $r;
        $this->_out(sprintf('%.2F %.2F l', ($x + $w) * $k, ($hp - $yc) * $k));
        $this->arcTo($xc + $r, $yc + $r * $myArc, $xc + $r * $myArc, $yc + $r, $xc, $yc + $r);
        $xc = $x + $r;
        $yc = $y + $h - $r;
        $this->_out(sprintf('%.2F %.2F l', $xc * $k, ($hp - ($y + $h)) * $k));
        $this->arcTo($xc - $r * $myArc, $yc + $r, $xc - $r, $yc + $r * $myArc, $xc - $r, $yc);
        $xc = $x + $r;
        $yc = $y + $r;
        $this->_out(sprintf('%.2F %.2F l', $x * $k, ($hp - $yc) * $k));
        $this->arcTo($xc - $r, $yc - $r * $myArc, $xc - $r * $myArc, $yc - $r, $xc, $yc - $r);
        $this->_out($op);
    }

    /** Triángulo relleno: marca si un resultado quedó por arriba o por abajo. */
    public function triangle(float $cx, float $cy, float $r, bool $up): void
    {
        $dir = $up ? -1 : 1;
        $pts = [[$cx, $cy + $dir * $r], [$cx - $r, $cy - $dir * $r * 0.8], [$cx + $r, $cy - $dir * $r * 0.8]];
        $this->_out(sprintf('%.2F %.2F m', $pts[0][0] * $this->k, ($this->h - $pts[0][1]) * $this->k));
        foreach (array_slice($pts, 1) as $p) {
            $this->_out(sprintf('%.2F %.2F l', $p[0] * $this->k, ($this->h - $p[1]) * $this->k));
        }
        $this->_out('h f');
    }

    /** Estrella rellena de cinco puntas, para marcar los resultados positivos. */
    public function star(float $cx, float $cy, float $r): void
    {
        $pts = [];
        for ($i = 0; $i < 10; $i++) {
            $ang = -M_PI / 2 + $i * M_PI / 5;
            $rad = $i % 2 === 0 ? $r : $r * 0.42;
            $pts[] = [$cx + cos($ang) * $rad, $cy + sin($ang) * $rad];
        }
        $this->_out(sprintf('%.2F %.2F m', $pts[0][0] * $this->k, ($this->h - $pts[0][1]) * $this->k));
        for ($i = 1; $i < 10; $i++) {
            $this->_out(sprintf('%.2F %.2F l', $pts[$i][0] * $this->k, ($this->h - $pts[$i][1]) * $this->k));
        }
        $this->_out('h f');
    }

    private function arcTo(float $x1, float $y1, float $x2, float $y2, float $x3, float $y3): void
    {
        $h = $this->h;
        $this->_out(sprintf(
            '%.2F %.2F %.2F %.2F %.2F %.2F c',
            $x1 * $this->k, ($h - $y1) * $this->k,
            $x2 * $this->k, ($h - $y2) * $this->k,
            $x3 * $this->k, ($h - $y3) * $this->k
        ));
    }

    /** Caja gris con los datos de la muestra. */
    public function sampleBox(array $cols, array $wide): void
    {
        $w = $this->usableWidth();
        $y0 = $this->GetY();
        $rowH = 11;
        $wideH = 10;
        $height = $rowH + count($wide) * $wideH + 5;

        $this->SetFillColor(...PDF_BOX_BG);
        $this->SetDrawColor(...PDF_BOX_BORDER);
        $this->SetLineWidth(0.2);
        $this->roundedRect($this->left(), $y0, $w, $height, 2.2, 'FD');

        $pad = 4;
        $colW = ($w - $pad * 2) / max(1, count($cols));
        $x = $this->left() + $pad;
        $y = $y0 + 3.5;
        foreach ($cols as $label => $value) {
            $this->SetXY($x, $y);
            $this->SetFont('Helvetica', '', 6.8);
            $this->SetTextColor(...PDF_MUTED);
            $this->Cell($colW, 3.6, pdf_t(mb_strtoupper($label, 'UTF-8')), 0, 2, 'L');
            $this->SetFont('Helvetica', '', 9);
            $this->SetTextColor(...PDF_INK);
            $this->Cell($colW, 5, pdf_t(pdf_fit($this, (string)($value ?: '—'), $colW - 2)), 0, 0, 'L');
            $x += $colW;
        }

        $y = $y0 + 3.5 + $rowH;
        foreach ($wide as $label => $value) {
            $this->SetXY($this->left() + $pad, $y);
            $this->SetFont('Helvetica', '', 6.8);
            $this->SetTextColor(...PDF_MUTED);
            $this->Cell($w - $pad * 2, 3.6, pdf_t(mb_strtoupper($label, 'UTF-8')), 0, 2, 'L');
            $this->SetFont('Helvetica', '', 9);
            $this->SetTextColor(...PDF_INK);
            $this->Cell($w - $pad * 2, 5, pdf_t(pdf_fit($this, (string)($value ?: '—'), $w - $pad * 2)), 0, 0, 'L');
            $y += $wideH;
        }

        $this->SetY($y0 + $height);
        $this->Ln(6);
        $this->SetTextColor(...PDF_INK);
    }

    /** Título del estudio, en azul. */
    public function studyTitle(string $title): void
    {
        $this->SetFont('Helvetica', 'B', 13);
        $this->SetTextColor(...PDF_BLUE);
        $this->Cell(0, 8, pdf_t($title), 0, 1, 'L');
        $this->SetTextColor(...PDF_INK);
        $this->Ln(2);
    }

    /** Barra azul de sección con el nombre del panel y el número de determinaciones. */
    public function panelBar(string $group, string $subtitle): void
    {
        $w = $this->usableWidth();
        // La barra no debe quedar sola al final de la página
        $this->ensureSpace(9.5 + 6.4 + 6.6 * 2);
        $y = $this->GetY();
        $this->SetFillColor(...PDF_BLUE);
        $this->roundedRect($this->left(), $y, $w, 9.5, 1.6, 'F');

        $this->SetXY($this->left() + 4, $y + 1.6);
        $this->SetTextColor(255, 255, 255);
        $this->SetFont('Helvetica', 'B', 12);
        $groupW = $this->GetStringWidth(pdf_t($group));
        $this->Cell($groupW + 2, 6.3, pdf_t($group), 0, 0, 'L');
        $this->SetFont('Helvetica', '', 7.8);
        $this->Cell(0, 6.6, pdf_t($subtitle), 0, 0, 'L');

        $this->SetY($y + 9.5);
        $this->SetTextColor(...PDF_INK);
    }

    /** Encabezado de la tabla de análisis clínicos (cuatro columnas). */
    public function labHead(): void
    {
        $w = $this->usableWidth();
        $this->SetFillColor(...PDF_HEAD_BG);
        $this->SetFont('Helvetica', 'B', 7.5);
        $this->SetTextColor(75, 85, 99);
        $this->Cell($w * 0.38, 6.4, pdf_t('  DETERMINACIÓN'), 0, 0, 'L', true);
        $this->Cell($w * 0.16, 6.4, pdf_t('RESULTADO'), 0, 0, 'R', true);
        $this->Cell($w * 0.14, 6.4, pdf_t('  UNIDAD'), 0, 0, 'L', true);
        $this->Cell($w * 0.32, 6.4, pdf_t('VALORES DE REFERENCIA  '), 0, 1, 'R', true);
        $this->SetTextColor(...PDF_INK);
    }

    /**
     * Altura que necesita una fila: depende de las líneas de la referencia y de
     * si la determinación lleva técnica debajo del nombre.
     */
    public function labRowHeight(array $item): float
    {
        $w = $this->usableWidth();
        $lines = max(
            1,
            count($this->wrapLines((string)($item['reference'] ?? ''), $w * 0.30 - 4, 'Helvetica', '', 8.2)),
            count($this->wrapLines((string)($item['name'] ?? ''), $w * 0.38 - 5, 'Helvetica', '', 8.6))
        );
        return max(6.4, $lines * 4.3 + 2.4) + (trim((string)($item['technique'] ?? '')) !== '' ? 3.4 : 0);
    }

    /** Divide un texto en las líneas que caben en el ancho dado. */
    public function wrapLines(string $text, float $width, string $family, string $style, float $size): array
    {
        $text = trim($text);
        if ($text === '' || $width <= 0) {
            return [];
        }
        $this->SetFont($family, $style, $size);
        $lines = [];
        foreach (preg_split('/\s*·\s*|\r?\n/u', $text) as $chunk) {
            $chunk = trim($chunk);
            if ($chunk === '') {
                continue;
            }
            $current = '';
            foreach (explode(' ', $chunk) as $word) {
                $try = $current === '' ? $word : $current . ' ' . $word;
                if ($this->GetStringWidth(pdf_t($try)) <= $width) {
                    $current = $try;
                } else {
                    if ($current !== '') {
                        $lines[] = $current;
                    }
                    $current = $word;
                }
            }
            if ($current !== '') {
                $lines[] = $current;
            }
        }
        return $lines;
    }

    /** Fila de una determinación: nombre y técnica, resultado, unidad e intervalos. */
    public function labRow(array $item, bool $zebra): void
    {
        $w = $this->usableWidth();
        $h = $this->labRowHeight($item);
        $flag = $item['flag'] ?? null;
        $y = $this->GetY();
        $technique = trim((string)($item['technique'] ?? ''));

        if ($flag) {
            $this->SetFillColor(...PDF_POS_BG);
            $this->Rect($this->left(), $y, $w, $h, 'F');
        } elseif ($zebra) {
            $this->SetFillColor(...PDF_ZEBRA);
            $this->Rect($this->left(), $y, $w, $h, 'F');
        }

        // Nombre de la determinación (puede ocupar varias líneas)
        $nameLines = $this->wrapLines((string)$item['name'], $w * 0.38 - 5, 'Helvetica', '', 8.6);
        $this->SetFont('Helvetica', '', 8.6);
        $this->SetTextColor(...PDF_INK);
        $ny = $y + 1.4;
        foreach ($nameLines as $line) {
            $this->SetXY($this->left() + 2, $ny);
            $this->Cell($w * 0.38 - 2, 4.3, pdf_t($line), 0, 0, 'L');
            $ny += 4.3;
        }
        // La técnica va debajo del nombre, en menor tamaño, como en el reporte de origen
        if ($technique !== '') {
            $this->SetFont('Helvetica', '', 6.4);
            $this->SetTextColor(...PDF_MUTED);
            $this->SetXY($this->left() + 4, $ny - 0.4);
            $this->Cell($w * 0.38 - 4, 3.4, pdf_t(pdf_fit($this, 'Técnica: ' . $technique, $w * 0.38 - 6)), 0, 0, 'L');
        }

        // Resultado, resaltado si quedó fuera del intervalo
        $this->SetFont('Helvetica', 'B', 8.8);
        $this->SetTextColor(...($flag ? PDF_POS_TEXT : PDF_INK));
        $this->SetXY($this->left() + $w * 0.38, $y + 1.4);
        $this->Cell($w * 0.16 - 4, 4.3, pdf_t((string)$item['value']), 0, 0, 'R');
        if ($flag === 'alto' || $flag === 'bajo') {
            $this->SetFillColor(...PDF_POS_TEXT);
            $this->triangle($this->left() + $w * 0.54 - 2, $y + 3.5, 1.5, $flag === 'alto');
        }

        $this->SetFont('Helvetica', '', 8.2);
        $this->SetTextColor(...PDF_MUTED);
        $this->SetXY($this->left() + $w * 0.54 + 1.5, $y + 1.4);
        $this->Cell($w * 0.12, 4.3, pdf_t(pdf_fit($this, (string)$item['unit'], $w * 0.12 - 2)), 0, 0, 'L');

        // Intervalos de referencia, uno por línea
        $refLines = $this->wrapLines((string)$item['reference'], $w * 0.30 - 4, 'Helvetica', '', 8.2);
        $this->SetTextColor(55, 65, 81);
        $ry = $y + 1.4;
        foreach ($refLines as $line) {
            $this->SetXY($this->left() + $w * 0.68, $ry);
            $this->Cell($w * 0.32 - 2, 4.3, pdf_t($line), 0, 0, 'R');
            $ry += 4.3;
        }

        $this->SetXY($this->left(), $y + $h);
        $this->SetTextColor(...PDF_INK);
    }

    /** Nota al pie sobre el criterio de los valores de referencia. */
    public function referenceNote(string $note): void
    {
        if (trim($note) === '') {
            return;
        }
        $this->Ln(3);
        $this->SetFont('Helvetica', 'I', 7.4);
        $this->SetTextColor(...PDF_MUTED);
        $this->MultiCell($this->usableWidth(), 4, pdf_t($note), 0, 'L');
        $this->SetTextColor(...PDF_INK);
    }

    /** Encabezado de columnas de la tabla de resultados. */
    public function resultsHead(): void
    {
        $w = $this->usableWidth();
        $this->SetFillColor(...PDF_HEAD_BG);
        $this->SetFont('Helvetica', 'B', 7.5);
        $this->SetTextColor(75, 85, 99);
        $this->Cell($w * 0.6, 6.4, pdf_t('  PATÓGENO DETECTABLE'), 0, 0, 'L', true);
        $this->Cell($w * 0.4, 6.4, pdf_t('RESULTADO OBTENIDO  '), 0, 1, 'R', true);
        $this->SetTextColor(...PDF_INK);
    }

    /** Fila de resultado: los positivos van resaltados y con estrella. */
    public function resultRow(string $name, bool $positive, string $label, bool $zebra): void
    {
        $w = $this->usableWidth();
        $h = 6.6;
        // El salto de página ya se resolvió antes de llamar aquí: el fondo se pinta
        // con Rect para que ningún Cell dispare un salto a media fila.
        $y = $this->GetY();

        if ($positive) {
            $this->SetFillColor(...PDF_POS_BG);
            $this->Rect($this->left(), $y, $w, $h, 'F');
        } elseif ($zebra) {
            $this->SetFillColor(...PDF_ZEBRA);
            $this->Rect($this->left(), $y, $w, $h, 'F');
        }

        // Nombre del patógeno
        $this->SetXY($this->left() + 2, $y);
        $this->SetFont('Helvetica', $positive ? 'B' : '', 9);
        $this->SetTextColor(...($positive ? PDF_POS_TEXT : PDF_INK));
        $this->Cell($w * 0.6, $h, pdf_t(pdf_fit($this, $name, $w * 0.6 - 4)), 0, 0, 'L');

        // Resultado, alineado a la derecha
        $this->SetFont('Helvetica', 'B', 8.6);
        $this->SetTextColor(...($positive ? PDF_POS_TEXT : [55, 65, 81]));
        $textW = $this->GetStringWidth(pdf_t($label));
        $xText = $this->right() - 2 - $textW;

        if ($positive) {
            $this->SetFillColor(...PDF_POS_TEXT);
            $this->star($xText - 2.6, $y + $h / 2, 1.5);
        }
        $this->SetXY($xText, $y);
        $this->Cell($textW, $h, pdf_t($label), 0, 0, 'L');

        $this->SetXY($this->left(), $y + $h);
        $this->SetTextColor(...PDF_INK);
    }

    /**
     * Rejilla de datos demográficos: filas de 2 columnas (etiqueta/valor cada una)
     * o de una sola columna a lo ancho cuando el valor puede ser largo (dirección…).
     * A diferencia de patientHeader() (que se repite en cada página), esta se usa
     * una sola vez para el bloque completo "Datos del paciente" del expediente.
     */
    public function dataGrid(array $rows): void
    {
        $w = $this->usableWidth();
        $half = $w / 2;
        $labelW = 40;
        $lineH = 5.6;

        foreach ($rows as $row) {
            [$l1, $v1, $l2, $v2] = array_pad($row, 4, null);
            $full = $l2 === null;

            $this->SetFont('Helvetica', '', 8.5);
            $this->SetTextColor(...PDF_MUTED);
            $this->Cell($labelW, $lineH, pdf_t($l1 . ':'), 0, 0, 'L');

            if ($full) {
                $this->SetFont('Helvetica', '', 9);
                $this->SetTextColor(...PDF_INK);
                $this->MultiCell($w - $labelW, $lineH, pdf_t((string)$v1), 0, 'L');
                continue;
            }

            $this->SetFont('Helvetica', '', 9);
            $this->SetTextColor(...PDF_INK);
            $this->Cell($half - $labelW, $lineH, pdf_t(pdf_fit($this, (string)$v1, $half - $labelW - 2)), 0, 0, 'L');

            $this->SetFont('Helvetica', '', 8.5);
            $this->SetTextColor(...PDF_MUTED);
            $this->Cell($labelW, $lineH, pdf_t($l2 . ':'), 0, 0, 'L');

            $this->SetFont('Helvetica', '', 9);
            $this->SetTextColor(...PDF_INK);
            $this->Cell($half - $labelW, $lineH, pdf_t(pdf_fit($this, (string)$v2, $half - $labelW - 2)), 0, 1, 'L');
        }
        $this->SetTextColor(...PDF_INK);
    }

    /**
     * Subtítulo pequeño en mayúsculas para agrupar campos dentro de una sección.
     * Reserva también el alto típico de una primera fila de fieldsTable() para que
     * el título nunca quede solo al fondo de una página con la tabla en la siguiente.
     */
    public function sectionLabel(string $title): void
    {
        $this->ensureSpace(22);
        $this->SetFont('Helvetica', 'B', 7.6);
        $this->SetTextColor(...PDF_MUTED);
        $this->Cell(0, 5, pdf_t(mb_strtoupper($title, 'UTF-8')), 0, 1, 'L');
        $this->SetTextColor(...PDF_INK);
    }

    /**
     * Tabla de 2 columnas para los campos capturados de una sección: cada campo es
     * una celda con fondo y borde (etiqueta arriba, valor abajo, ambos con salto de
     * línea si hace falta), agrupadas en filas — nunca un párrafo corrido de texto.
     */
    public function fieldsTable(array $pairs): void
    {
        if (!$pairs) {
            return;
        }
        $cols = 2;
        $w = $this->usableWidth();
        $colW = $w / $cols;
        $padX = 3;
        $labelSize = 6.6;
        $valueSize = 8.4;
        $valueLineH = 4.0;
        $labelLineH = 3.2;

        $cells = [];
        foreach ($pairs as [$label, $value]) {
            $labelLines = $this->wrapLines(mb_strtoupper((string)$label, 'UTF-8'), $colW - $padX * 2, 'Helvetica', '', $labelSize) ?: [''];
            $valueLines = $this->wrapLines((string)$value, $colW - $padX * 2, 'Helvetica', 'B', $valueSize) ?: [''];
            $h = 1.8 + count($labelLines) * $labelLineH + 1.2 + count($valueLines) * $valueLineH + 1.8;
            $cells[] = ['label' => $labelLines, 'value' => $valueLines, 'h' => $h];
        }

        foreach (array_chunk($cells, $cols) as $row) {
            $rh = max(array_column($row, 'h'));
            $this->ensureSpace($rh + 1);
            $x0 = $this->left();
            $y = $this->GetY();

            $this->SetFillColor(...PDF_BOX_BG);
            $this->SetDrawColor(...PDF_BOX_BORDER);
            $this->SetLineWidth(0.2);
            $this->Rect($x0, $y, $w, $rh, 'FD');

            $x = $x0;
            foreach ($row as $ci => $cell) {
                if ($ci > 0) {
                    $this->Line($x, $y, $x, $y + $rh);
                }
                $ly = $y + 1.8;
                $this->SetFont('Helvetica', '', $labelSize);
                $this->SetTextColor(...PDF_MUTED);
                foreach ($cell['label'] as $line) {
                    $this->SetXY($x + $padX, $ly);
                    $this->Cell($colW - $padX * 2, $labelLineH, pdf_t($line), 0, 0, 'L');
                    $ly += $labelLineH;
                }
                $ly += 1.2;
                $this->SetFont('Helvetica', 'B', $valueSize);
                $this->SetTextColor(...PDF_INK);
                foreach ($cell['value'] as $line) {
                    $this->SetXY($x + $padX, $ly);
                    $this->Cell($colW - $padX * 2, $valueLineH, pdf_t($line), 0, 0, 'L');
                    $ly += $valueLineH;
                }
                $x += $colW;
            }
            $this->SetXY($x0, $y + $rh);
        }
        $this->Ln(3);
        $this->SetTextColor(...PDF_INK);
    }

    /**
     * Inserta una firma capturada en pantalla (PNG en data URL).
     * Por defecto: caja chica con la leyenda al lado. Con $large: caja grande
     * centrada en la página, con la leyenda de conformidad arriba y la etiqueta abajo.
     */
    public function dataUrlImage(string $dataUrl, string $caption = 'Firma del paciente', ?string $legend = null, bool $large = false): void
    {
        $path = pdf_cache_data_url($dataUrl);
        if (!$path) {
            return;
        }
        $size = @getimagesize($path);

        if ($large) {
            $h = 28.0;
            $w = ($size && $size[1]) ? $h * $size[0] / $size[1] : $h * 2.4;
            $maxW = min(100.0, $this->usableWidth());
            if ($w > $maxW) {
                $h *= $maxW / $w;
                $w = $maxW;
            }

            $this->ensureSpace(($legend ? 10.0 : 0.0) + $h + 8);

            if ($legend) {
                $this->SetX($this->left());
                $this->SetFont('Helvetica', 'I', 8);
                $this->SetTextColor(...PDF_MUTED);
                $this->MultiCell($this->usableWidth(), 4, pdf_t($legend), 0, 'C');
                $this->Ln(2);
            }

            $x = $this->left() + ($this->usableWidth() - $w) / 2;
            $y = $this->GetY();
            $this->SetDrawColor(...PDF_LINE);
            $this->SetLineWidth(0.2);
            $this->Rect($x, $y, $w, $h);
            @$this->Image($path, $x, $y, $w, $h);

            $this->SetY($y + $h + 2);
            $this->SetFont('Helvetica', '', 8);
            $this->SetTextColor(...PDF_MUTED);
            $this->SetX($this->left());
            $this->Cell($this->usableWidth(), 4, pdf_t($caption), 0, 1, 'C');
            $this->Ln(2);
            $this->SetTextColor(...PDF_INK);
            return;
        }

        $h = 14.0;
        $w = ($size && $size[1]) ? $h * $size[0] / $size[1] : $h * 2.4;

        $this->ensureSpace($h + 4);
        $x = $this->left();
        $y = $this->GetY();
        $this->SetDrawColor(...PDF_LINE);
        $this->SetLineWidth(0.2);
        $this->Rect($x, $y, $w, $h);
        @$this->Image($path, $x, $y, $w, $h);

        $this->SetXY($x + $w + 4, $y);
        $this->SetFont('Helvetica', '', 8);
        $this->SetTextColor(...PDF_MUTED);
        $this->Cell(0, $h, pdf_t($caption), 0, 0, 'L');
        $this->SetY($y + $h + 3);
        $this->SetTextColor(...PDF_INK);
    }

    /** Bloque de firma del responsable sanitario del área que valida el estudio. */
    public function signatureBlock(string $area = 'default'): void
    {
        $signer = letterhead_signature($area);
        if (empty($signer['name']) && empty($signer['file'])) {
            return;
        }
        $sig = pdf_safe_image(letterhead_path($signer['file']));
        $centerX = $this->GetPageWidth() / 2;
        if ($sig) {
            $w = (float)$this->lh['signature_width'];
            @$this->Image($sig, $centerX - $w / 2, $this->GetY(), $w);
            $size = @getimagesize($sig);
            $h = ($size && $size[0]) ? $w * $size[1] / $size[0] : 14;
            $this->SetY($this->GetY() + min($h, 22) + 1);
        } else {
            $this->Ln(10);
            $this->SetDrawColor(...PDF_LINE);
            $this->Line($centerX - 35, $this->GetY(), $centerX + 35, $this->GetY());
            $this->Ln(1);
        }
        $this->SetFont('Helvetica', '', 9);
        $this->SetTextColor(...PDF_INK);
        foreach (array_filter([$signer['name'], $signer['license'], $signer['role']]) as $line) {
            $this->Cell(0, 4.6, pdf_t($line), 0, 1, 'C');
        }
    }

    /* ---------- Cotizaciones ---------- */

    /** Ancho de cada columna de la tabla de partidas: N° | Descripción | Cantidad | P. Unitario | Precio. */
    private function quoteColWidths(): array
    {
        $w = $this->usableWidth();
        $num = 10.0;
        $qty = 20.0;
        $unit = 32.0;
        $total = 32.0;
        return [$num, $w - $num - $qty - $unit - $total, $qty, $unit, $total];
    }

    public function quoteItemsHead(): void
    {
        [$num, $desc, $qty, $unit, $total] = $this->quoteColWidths();
        $this->SetFillColor(...PDF_HEAD_BG);
        $this->SetFont('Helvetica', 'B', 7.5);
        $this->SetTextColor(75, 85, 99);
        $this->Cell($num, 6.4, pdf_t('N°'), 0, 0, 'C', true);
        $this->Cell($desc, 6.4, pdf_t('  DESCRIPCIÓN'), 0, 0, 'L', true);
        $this->Cell($qty, 6.4, pdf_t('CANTIDAD'), 0, 0, 'C', true);
        $this->Cell($unit, 6.4, pdf_t('PRECIO UNITARIO'), 0, 0, 'R', true);
        $this->Cell($total, 6.4, pdf_t('PRECIO  '), 0, 1, 'R', true);
        $this->SetTextColor(...PDF_INK);
    }

    public function quoteItemRowHeight(string $name): float
    {
        [, $desc] = $this->quoteColWidths();
        $lines = $this->wrapLines($name, $desc - 4, 'Helvetica', '', 9) ?: [''];
        return max(7.0, count($lines) * 4.2 + 2.8);
    }

    public function quoteItemRow(int $n, string $name, float $quantity, float $unitPrice, float $lineTotal, bool $zebra): void
    {
        [$numW, $desc, $qty, $unit, $total] = $this->quoteColWidths();
        $h = $this->quoteItemRowHeight($name);
        $y = $this->GetY();

        if ($zebra) {
            $this->SetFillColor(...PDF_ZEBRA);
            $this->Rect($this->left(), $y, $this->usableWidth(), $h, 'F');
        }

        $this->SetFont('Helvetica', '', 9);
        $this->SetTextColor(...PDF_INK);
        $this->SetXY($this->left(), $y + 1.4);
        $this->Cell($numW, 4.2, pdf_t((string)$n), 0, 0, 'C');

        $lines = $this->wrapLines($name, $desc - 4, 'Helvetica', '', 9) ?: [''];
        $ny = $y + 1.4;
        foreach ($lines as $line) {
            $this->SetXY($this->left() + $numW + 2, $ny);
            $this->Cell($desc - 2, 4.2, pdf_t($line), 0, 0, 'L');
            $ny += 4.2;
        }

        $qtyStr = rtrim(rtrim(number_format($quantity, 2, '.', ''), '0'), '.') ?: '0';
        $this->SetXY($this->left() + $numW + $desc, $y + 1.4);
        $this->Cell($qty, 4.2, pdf_t($qtyStr), 0, 0, 'C');
        $this->SetXY($this->left() + $numW + $desc + $qty, $y + 1.4);
        $this->Cell($unit - 2, 4.2, pdf_t('$' . number_format($unitPrice, 2)), 0, 0, 'R');
        $this->SetXY($this->left() + $numW + $desc + $qty + $unit, $y + 1.4);
        $this->Cell($total - 2, 4.2, pdf_t('$' . number_format($lineTotal, 2)), 0, 0, 'R');

        $this->SetXY($this->left(), $y + $h);
    }

    /** Barras grises de Subtotal / Descuento / Total, alineadas a la derecha. */
    public function quoteTotalsBox(float $subtotal, float $discountPct, float $discountAmount, float $total): void
    {
        $w = 80.0;
        $rowH = 7.0;
        $x = $this->right() - $w;
        $this->ensureSpace($rowH * 3 + 4);
        $y = $this->GetY();

        $rows = [
            ['Subtotal', '$' . number_format($subtotal, 2), false],
            ['Descuento' . ($discountPct > 0 ? ' (' . rtrim(rtrim(number_format($discountPct, 2), '0'), '.') . '%)' : ''), '-$' . number_format($discountAmount, 2), false],
            ['Total', '$' . number_format($total, 2), true],
        ];
        foreach ($rows as [$label, $value, $strong]) {
            $this->SetFillColor(...($strong ? PDF_BLUE : PDF_BOX_BG));
            $this->SetDrawColor(...PDF_BOX_BORDER);
            $this->SetLineWidth(0.2);
            $this->Rect($x, $y, $w, $rowH, 'FD');
            $this->SetXY($x + 4, $y);
            $this->SetFont('Helvetica', $strong ? 'B' : '', $strong ? 10 : 9);
            $this->SetTextColor(...($strong ? [255, 255, 255] : PDF_MUTED));
            $this->Cell($w * 0.5, $rowH, pdf_t($label), 0, 0, 'L');
            $this->SetFont('Helvetica', 'B', $strong ? 11 : 9.5);
            $this->SetTextColor(...($strong ? [255, 255, 255] : PDF_INK));
            $this->Cell($w * 0.5 - 8, $rowH, pdf_t($value), 0, 0, 'R');
            $y += $rowH;
        }
        $this->SetXY($this->left(), $y + 4);
        $this->SetTextColor(...PDF_INK);
    }

    /* ---------- Comisiones ---------- */

    /** Ancho de columnas de la tabla de comisiones: N° | Paciente/Estudio | Monto | % | Comisión. */
    private function commissionColWidths(): array
    {
        $w = $this->usableWidth();
        $num = 8.0;
        $amount = 28.0;
        $pct = 16.0;
        $commission = 32.0;
        return [$num, $w - $num - $amount - $pct - $commission, $amount, $pct, $commission];
    }

    public function commissionItemsHead(): void
    {
        [$num, $desc, $amount, $pct, $commission] = $this->commissionColWidths();
        $this->SetFillColor(...PDF_HEAD_BG);
        $this->SetFont('Helvetica', 'B', 7.5);
        $this->SetTextColor(75, 85, 99);
        $this->Cell($num, 6.4, pdf_t('N°'), 0, 0, 'C', true);
        $this->Cell($desc, 6.4, pdf_t('  PACIENTE / ESTUDIO'), 0, 0, 'L', true);
        $this->Cell($amount, 6.4, pdf_t('MONTO'), 0, 0, 'R', true);
        $this->Cell($pct, 6.4, pdf_t('%'), 0, 0, 'C', true);
        $this->Cell($commission, 6.4, pdf_t('COMISIÓN  '), 0, 1, 'R', true);
        $this->SetTextColor(...PDF_INK);
    }

    public function commissionItemRowHeight(string $label): float
    {
        [, $desc] = $this->commissionColWidths();
        $lines = $this->wrapLines($label, $desc - 4, 'Helvetica', '', 8.6) ?: [''];
        return max(7.0, count($lines) * 4.0 + 2.8);
    }

    public function commissionItemRow(int $n, string $patientName, string $studyName, float $amount, float $pct, float $commission, bool $zebra): void
    {
        [$numW, $desc, $amountW, $pctW, $commissionW] = $this->commissionColWidths();
        $label = $patientName . ' — ' . $studyName;
        $h = $this->commissionItemRowHeight($label);
        $y = $this->GetY();

        if ($zebra) {
            $this->SetFillColor(...PDF_ZEBRA);
            $this->Rect($this->left(), $y, $this->usableWidth(), $h, 'F');
        }

        $this->SetFont('Helvetica', '', 9);
        $this->SetTextColor(...PDF_INK);
        $this->SetXY($this->left(), $y + 1.4);
        $this->Cell($numW, 4.0, pdf_t((string)$n), 0, 0, 'C');

        $lines = $this->wrapLines($label, $desc - 4, 'Helvetica', '', 8.6) ?: [''];
        $ny = $y + 1.4;
        foreach ($lines as $line) {
            $this->SetXY($this->left() + $numW + 2, $ny);
            $this->Cell($desc - 2, 4.0, pdf_t($line), 0, 0, 'L');
            $ny += 4.0;
        }

        $this->SetXY($this->left() + $numW + $desc, $y + 1.4);
        $this->Cell($amountW - 2, 4.0, pdf_t('$' . number_format($amount, 2)), 0, 0, 'R');
        $this->SetXY($this->left() + $numW + $desc + $amountW, $y + 1.4);
        $this->Cell($pctW, 4.0, pdf_t(rtrim(rtrim(number_format($pct, 2), '0'), '.') . '%'), 0, 0, 'C');
        $this->SetFont('Helvetica', 'B', 9);
        $this->SetXY($this->left() + $numW + $desc + $amountW + $pctW, $y + 1.4);
        $this->Cell($commissionW - 2, 4.0, pdf_t('$' . number_format($commission, 2)), 0, 0, 'R');

        $this->SetXY($this->left(), $y + $h);
    }

    /** Barra azul de Total de comisión, alineada a la derecha. */
    public function commissionTotalsBox(float $total): void
    {
        $w = 80.0;
        $rowH = 8.0;
        $x = $this->right() - $w;
        $this->ensureSpace($rowH + 4);
        $y = $this->GetY();

        $this->SetFillColor(...PDF_BLUE);
        $this->SetDrawColor(...PDF_BOX_BORDER);
        $this->SetLineWidth(0.2);
        $this->Rect($x, $y, $w, $rowH, 'FD');
        $this->SetXY($x + 4, $y);
        $this->SetFont('Helvetica', 'B', 10);
        $this->SetTextColor(255, 255, 255);
        $this->Cell($w * 0.5, $rowH, pdf_t('Total comisión'), 0, 0, 'L');
        $this->SetFont('Helvetica', 'B', 11);
        $this->Cell($w * 0.5 - 8, $rowH, pdf_t('$' . number_format($total, 2)), 0, 0, 'R');
        $this->SetXY($this->left(), $y + $rowH + 4);
        $this->SetTextColor(...PDF_INK);
    }
}

/**
 * Vuelca una imagen data:URL (ej. una firma capturada en pantalla) a un archivo
 * cacheado por contenido, ya que FPDF necesita una ruta y no acepta datos en memoria.
 */
function pdf_cache_data_url(string $dataUrl): ?string
{
    if (!str_starts_with($dataUrl, 'data:image')) {
        return null;
    }
    $comma = strpos($dataUrl, ',');
    if ($comma === false) {
        return null;
    }
    $bin = base64_decode(substr($dataUrl, $comma + 1), true);
    if ($bin === false || $bin === '') {
        return null;
    }
    $cacheDir = LETTERHEAD_DIR . 'cache/';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0775, true);
    }
    $path = $cacheDir . 'sig-' . substr(md5($bin), 0, 16) . '.png';
    if (!is_file($path)) {
        file_put_contents($path, $bin);
    }
    return is_file($path) ? $path : null;
}

/**
 * Reporte de análisis clínicos: un bloque por estudio con sus determinaciones,
 * el intervalo que aplica al paciente y la nota sobre el criterio usado.
 */
function render_lab_report(
    SiriusDocPDF $pdf,
    array $lh,
    array $tpl,
    array $patient,
    array $clinical,
    array $studies,
    string $notes,
    string $folio,
    ?string $path
): string {
    $edadSexo = trim(($patient['edad'] ?? '') . (empty($patient['sexo']) ? '' : ' / ' . mb_strtoupper($patient['sexo'], 'UTF-8')));
    // El nombre del paciente y el del médico van en fila completa para que no se corten
    $info = [
        ['Folio', $folio ?: '—', 'Fecha reporte', $clinical['fecha_reporte'] ?? date('Y-m-d')],
        ['Paciente', $patient['nombre'] ?? '', null, null, 'bold' => true],
        ['Médico', ($clinical['medico'] ?? '') ?: 'A quien corresponda'],
        ['Edad / Sexo', trim($edadSexo, ' /') ?: '—', 'Teléfono', $patient['telefono'] ?? '—'],
    ];
    $pdf->setPatientInfo($info);
    $pdf->AddPage();

    $pdf->sampleBox(
        [
            'Área'                => $clinical['area'] ?? ($tpl['area'] ?? 'Análisis Clínicos'),
            'Toma de muestra'     => $clinical['toma_muestra'] ?? '',
            'Impresión / reporte' => date('Y-m-d H:i'),
        ],
        array_filter([
            'Observaciones clínicas' => $clinical['observaciones'] ?? '',
        ], static fn($v) => trim((string)$v) !== '')
    );

    // Cada estudio empieza en hoja nueva: así no se encima el final de uno con el
    // principio del siguiente. Los estudios largos siguen ocupando las hojas que necesiten.
    $first = true;
    foreach ($studies as $study) {
        if (!$first) {
            $pdf->AddPage();
        }
        $first = false;

        $count = count($study['items'] ?? []);
        $pdf->panelBar($study['name'] ?: 'Estudio', $count . ' ' . ($count === 1 ? 'determinación' : 'determinaciones'));
        $pdf->labHead();
        $i = 0;
        foreach ($study['items'] as $item) {
            $pdf->ensureSpace($pdf->labRowHeight($item), static fn($p) => $p->labHead());
            $pdf->labRow($item, $i % 2 === 1);
            $i++;
        }
        $pdf->Ln(5);
    }

    if (trim($notes) !== '') {
        $pdf->ensureSpace(20);
        $pdf->panelBar('Observaciones', '');
        $pdf->Ln(3);
        $pdf->SetFont('Helvetica', '', 9);
        $pdf->SetTextColor(...PDF_INK);
        foreach (preg_split('/\r?\n/', trim($notes)) as $line) {
            if (trim($line) !== '') {
                $pdf->MultiCell(0, 5.2, pdf_t(trim($line)), 0, 'L');
            }
        }
    }

    /* ---- Cierre: notas legales, firma y pie corporativo, todo en la misma hoja ---- */
    $notesText = array_filter([$tpl['reference_note'] ?? '', $tpl['outsourcing_note'] ?? '']);
    $notesHeight = 0;
    foreach ($notesText as $t) {
        $notesHeight += count($pdf->wrapLines($t, $pdf->usableWidth(), 'Helvetica', 'I', 7.4)) * 4 + 5;
    }
    $closing = $notesHeight + 34 + (float)$lh['footer_height'] + (float)$lh['footer_bottom'];
    if ($pdf->GetY() + $closing > $pdf->contentLimit()) {
        $pdf->AddPage();
    }
    $pdf->markLastPage();

    foreach ($notesText as $t) {
        $pdf->referenceNote($t);
    }

    // La firma se ancla sobre el pie; sin salto automático para que no se parta
    $pdf->SetAutoPageBreak(false);
    $signY = $pdf->GetPageHeight() - (float)$lh['footer_bottom'] - (float)$lh['footer_height'] - 30;
    if ($signY > $pdf->GetY()) {
        $pdf->SetY($signY);
    } else {
        $pdf->Ln(6);
    }
    $pdf->signatureBlock($tpl['signature_area'] ?? 'default');

    if ($path) {
        $pdf->Output('F', $path);
        return $path;
    }
    return $pdf->Output('S');
}

/** Convierte UTF-8 a la codificación que entienden las fuentes base de FPDF. */
function pdf_t(string $s): string
{
    $out = @iconv('UTF-8', 'ISO-8859-1//TRANSLIT', $s);
    return $out !== false ? $out : mb_convert_encoding($s, 'ISO-8859-1', 'UTF-8');
}

/** Recorta un texto para que quepa en el ancho dado. */
function pdf_fit(FPDF $pdf, string $text, float $maxWidth): string
{
    if ($maxWidth <= 0 || $pdf->GetStringWidth(pdf_t($text)) <= $maxWidth) {
        return $text;
    }
    while (mb_strlen($text) > 1 && $pdf->GetStringWidth(pdf_t($text . '…')) > $maxWidth) {
        $text = mb_substr($text, 0, -1);
    }
    return $text . '…';
}

/**
 * FPDF no admite PNG con canal alfa: se aplana sobre blanco y se cachea.
 * Devuelve una ruta utilizable o null.
 */
function pdf_safe_image(?string $path): ?string
{
    if (!$path || !is_file($path)) {
        return null;
    }
    $info = @getimagesize($path);
    if (!$info) {
        return null;
    }
    if ($info[2] !== IMAGETYPE_PNG || !function_exists('imagecreatetruecolor')) {
        return $path;
    }
    // Color type 4 (gris+alfa) y 6 (RGBA) llevan canal alfa; 3 (paleta) puede traer tRNS
    $colorType = @ord(file_get_contents($path, false, null, 25, 1));
    if (!in_array($colorType, [3, 4, 6], true)) {
        return $path;
    }
    $cacheDir = dirname($path) . '/cache/';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0775, true);
    }
    $cache = $cacheDir . 'flat-' . substr(md5($path . filemtime($path)), 0, 12) . '.png';
    if (is_file($cache)) {
        return $cache;
    }
    $src = @imagecreatefrompng($path);
    if (!$src) {
        return $path;
    }
    $w = imagesx($src);
    $h = imagesy($src);
    $flat = imagecreatetruecolor($w, $h);
    imagefill($flat, 0, 0, imagecolorallocate($flat, 255, 255, 255));
    imagecopy($flat, $src, 0, 0, 0, 0, $w, $h);
    imagepng($flat, $cache);
    imagedestroy($src);
    imagedestroy($flat);
    return is_file($cache) ? $cache : $path;
}

/**
 * Dibuja el documento completo.
 * $doc es la fila de la tabla documents (con los JSON aún como texto o ya decodificados).
 * Si $path es null devuelve el binario del PDF; si no, lo guarda y devuelve la ruta.
 */
function render_document_pdf(array $doc, ?string $path = null): string
{
    $type = $doc['doc_type'];
    $tpl = doc_template($type);
    if (!$tpl) {
        throw new RuntimeException('Plantilla de documento desconocida: ' . $type);
    }
    $decode = static fn($v) => is_array($v) ? $v : (($v ? json_decode($v, true) : []) ?: []);
    $patient  = $decode($doc['patient_data'] ?? []);
    $clinical = $decode($doc['clinical_data'] ?? []);
    $results  = $decode($doc['results'] ?? []);
    $notes    = trim((string)($doc['notes'] ?? ''));
    $folio    = (string)($doc['folio'] ?? '');

    $clinicName = 'Laboratorio y Clínica Bosques Polanco';
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['clinic_name']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $clinicName = $row['svalue'];
        }
    } catch (Throwable $e) {
    }

    $lh = letterhead_config();
    $pdf = new SiriusDocPDF($lh, $clinicName);

    if (($tpl['kind'] ?? '') === 'lab') {
        return render_lab_report($pdf, $lh, $tpl, $patient, $clinical, $results, $notes, $folio, $path);
    }

    // Encabezado de identificación, repetido en todas las páginas
    $edadSexo = trim(($patient['edad'] ?? '') . (empty($patient['sexo']) ? '' : ' / ' . mb_strtoupper($patient['sexo'], 'UTF-8')));
    $edadSexo = trim($edadSexo, ' /');
    $info = [
        ['Folio', $folio ?: '—', 'Fecha reporte', $clinical['fecha_reporte'] ?? date('Y-m-d'), 'bold' => true],
        ['Paciente', $patient['nombre'] ?? '', 'Edad / Sexo', $edadSexo ?: '—'],
        ['F. nacimiento', $patient['fecha_nacimiento'] ?? '—', 'Teléfono', $patient['telefono'] ?? '—'],
        ['Correo', $patient['email'] ?? '—', 'Dirección', $patient['direccion'] ?? '—'],
    ];
    if (!empty($clinical['medico'])) {
        $info[] = ['Médico solicitante', $clinical['medico']];
    }
    $pdf->setPatientInfo($info);

    // Los estudios cortos caben completos en una hoja: resultados, notas y firma
    $singlePage = !empty($tpl['single_page']);

    // Agrupar los paneles por página según la plantilla
    $byPage = [];
    foreach ($tpl['panels'] as $panel) {
        $byPage[$singlePage ? 1 : (int)($panel['page'] ?? 1)][] = $panel;
    }
    ksort($byPage);
    $firstPage = array_key_first($byPage);

    foreach ($byPage as $pageKey => $panels) {
        $pdf->AddPage();
        if ($singlePage) {
            // Única hoja: ya lleva el pie corporativo y reserva su espacio
            $pdf->markLastPage();
        }

        if ($pageKey === $firstPage) {
            $pdf->sampleBox(
                [
                    'Tipo de muestra'     => $clinical['tipo_muestra'] ?? $tpl['sample_type'] ?? '',
                    'Toma de muestra'     => $clinical['toma_muestra'] ?? '',
                    'Temp. contenedor'    => $clinical['container_temp'] ?? ($tpl['container_temp'] ?? ''),
                    'Impresión / reporte' => date('Y-m-d H:i'),
                ],
                array_filter([
                    'Kit utilizado'        => $clinical['kit'] ?? ($tpl['kit'] ?? ''),
                    'Observaciones clínicas' => $clinical['observaciones'] ?? '',
                ], static fn($v) => trim((string)$v) !== '')
            );
            $pdf->studyTitle($clinical['estudio'] ?? ($tpl['report_title'] ?? $tpl['study_name']));
        }

        foreach ($panels as $panel) {
            $count = count($panel['analytes']);
            $pdf->panelBar($panel['group'], $count . ' ' . ($tpl['technique'] ?? 'determinaciones'));
            $pdf->resultsHead();
            $i = 0;
            foreach ($panel['analytes'] as $a) {
                // Si la fila no cabe, se salta de página repitiendo el encabezado de columnas
                $pdf->ensureSpace(6.6, static fn($p) => $p->resultsHead());
                $positive = !empty($results[$a['k']]);
                $pdf->resultRow(
                    $a['l'],
                    $positive,
                    $positive ? $tpl['positive_label'] : $tpl['negative_label'],
                    $i % 2 === 1
                );
                $i++;
            }
            $pdf->Ln(6);
        }
    }

    /* ---------- Notas, interpretación y firma ---------- */
    if (!$singlePage) {
        // Se marca después de crear la página: el pie de la anterior ya se cerró sin
        // el bloque corporativo, que solo corresponde a la hoja final.
        $pdf->AddPage();
        $pdf->markLastPage();
    }
    $pdf->panelBar('Notas de preanalítica', '');
    $pdf->Ln(4);

    if ($notes === '') {
        $pdf->SetFont('Helvetica', 'I', 9);
        $pdf->SetTextColor(...PDF_MUTED);
        $pdf->Cell(0, 5.5, pdf_t('Sin observaciones registradas.'), 0, 1, 'L');
    } else {
        $pdf->SetFont('Helvetica', '', 9.5);
        $pdf->SetTextColor(...PDF_INK);
        $i = 1;
        foreach (preg_split('/\r?\n/', $notes) as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            if (!preg_match('/^\d+\./', $line)) {
                $line = $i . '. ' . $line;
            }
            $pdf->MultiCell(0, 5.5, pdf_t($line), 0, 'L');
            $i++;
        }
    }

    if (!empty($tpl['interpretation'])) {
        $pdf->Ln(6);
        // Write() encadena los dos estilos como un solo párrafo que salta al margen
        $pdf->SetFont('Helvetica', 'B', 7.6);
        $pdf->SetTextColor(...PDF_INK);
        $pdf->Write(4.4, pdf_t(($tpl['interpretation_title'] ?? '') . ' '));
        $pdf->SetFont('Helvetica', '', 7.6);
        $pdf->SetTextColor(...PDF_MUTED);
        $pdf->Write(4.4, pdf_t($tpl['interpretation']));
        $pdf->Ln(6);
    }

    // La firma se ancla sobre el pie; sin salto automático para que no se parta
    // (el bloque completo —imagen + nombre + cédula + rol— ya cabe en el espacio
    // reservado; sin este candado, FPDF puede partirlo a media línea y dejar una
    // hoja huérfana con solo la última línea del bloque, como ya pasó con FilmArray
    // Gastrointestinal).
    $pdf->SetAutoPageBreak(false);
    $signY = $pdf->GetPageHeight() - (float)$lh['footer_bottom'] - (float)$lh['footer_height'] - 32;
    if ($signY > $pdf->GetY()) {
        $pdf->SetY($signY);
    } else {
        $pdf->Ln(10);
    }
    $pdf->signatureBlock($tpl['signature_area'] ?? 'default');

    if ($path) {
        $pdf->Output('F', $path);
        return $path;
    }
    return $pdf->Output('S');
}

/**
 * Expediente clínico completo de un paciente: datos personales, antecedentes y el
 * historial por servicio (admisión + consultas subsecuentes de cada episodio).
 * Usa el membrete configurado (header, footer, marca de agua) igual que el resto
 * de los documentos, pero SIN firma de responsable: este documento es un expediente,
 * no un estudio que alguien deba validar.
 */
function render_patient_record_pdf(
    array $patient,
    array $episodes,
    array $consultsByEpisode,
    string $clinicName,
    ?string $path = null,
    array $studiesByEpisode = []
): string {
    $lh = letterhead_config();
    $pdf = new SiriusDocPDF($lh, $clinicName);

    $fullName = trim($patient['first_name'] . ' ' . $patient['paternal_surname'] . ' ' . ($patient['maternal_surname'] ?? ''));
    $pdf->setPatientInfo([
        ['Folio', $patient['file_number'], 'Impreso', date('d/m/Y H:i')],
        ['Paciente', $fullName, null, null],
    ]);
    $pdf->AddPage();

    /* ---------- Datos del paciente ---------- */
    $pdf->panelBar('Datos del paciente', '');
    $pdf->Ln(3);

    $age = pdf_calc_age($patient['birth_date'] ?? null);
    $birthLabel = $patient['birth_date'] ? date('d/m/Y', strtotime($patient['birth_date'])) : '—';
    if ($age !== null) {
        $birthLabel .= " ($age años)";
    }
    $sexLabel = ['F' => 'Femenino', 'M' => 'Masculino', 'O' => 'Otro'][$patient['sex'] ?? ''] ?? '—';
    $titular = trim(implode(' · ', array_filter([
        $patient['guardian_name'] ?? null, $patient['guardian_phone'] ?? null, $patient['guardian_relationship'] ?? null,
    ]))) ?: '—';
    $direccion = trim(implode(', ', array_filter([
        $patient['street'] ?? null, $patient['colonia'] ?? null, $patient['postal_code'] ?? null,
        $patient['city'] ?? null, $patient['state'] ?? null,
    ]))) ?: '—';
    $emergencia = trim(implode(' · ', array_filter([
        $patient['emergency_contact_name'] ?? null, $patient['emergency_contact_phone'] ?? null,
    ]))) ?: '—';

    $pdf->dataGrid([
        ['Fecha de nacimiento', $birthLabel, 'Sexo', $sexLabel],
        ['Grupo sanguíneo', $patient['blood_type'] ?: '—', 'Estado civil', $patient['marital_status'] ?: '—'],
        ['Ocupación', $patient['occupation'] ?: '—', 'Nacionalidad', $patient['nationality'] ?: '—'],
        ['Religión', $patient['religion'] ?: '—', null, null],
        ['Celular', $patient['mobile'] ?: '—', 'Teléfono', $patient['phone'] ?: '—'],
        ['Email', $patient['email'] ?: '—', 'Titular / a cargo', $titular],
        ['Dirección', $direccion, null, null],
        ['Contacto de emergencia', $emergencia, null, null],
    ]);
    $pdf->Ln(2);

    $antecedentes = array_filter([
        'Alergias'               => $patient['allergies'] ?? null,
        'Personales patológicos' => $patient['chronic_conditions'] ?? null,
        'Heredofamiliares'       => $patient['family_history'] ?? null,
        'Medicamentos actuales'  => $patient['current_medications'] ?? null,
        'Notas'                  => $patient['notes'] ?? null,
    ], static fn($v) => trim((string)$v) !== '');

    if ($antecedentes) {
        $pdf->ensureSpace(14);
        $pdf->panelBar('Antecedentes', '');
        $pdf->Ln(3);
        foreach ($antecedentes as $label => $value) {
            $pdf->ensureSpace(10);
            $pdf->SetFont('Helvetica', 'B', 8.6);
            $pdf->SetTextColor(...PDF_INK);
            $pdf->Cell(0, 5, pdf_t($label . ':'), 0, 1, 'L');
            $pdf->SetFont('Helvetica', '', 8.8);
            $pdf->MultiCell($pdf->usableWidth(), 4.6, pdf_t((string)$value), 0, 'L');
            $pdf->Ln(1.5);
        }
        $pdf->Ln(2);
    }

    /* ---------- Historial por servicio ---------- */
    $pdf->ensureSpace(14);
    $pdf->panelBar('Historial por servicio', '');
    $pdf->Ln(3);

    if (!$episodes) {
        $pdf->SetFont('Helvetica', 'I', 9);
        $pdf->SetTextColor(...PDF_MUTED);
        $pdf->Cell(0, 6, pdf_t('Sin episodios registrados.'), 0, 1, 'L');
        $pdf->SetTextColor(...PDF_INK);
    }

    foreach ($episodes as $e) {
        $svcLabel = SERVICE_LABELS[$e['service']] ?? $e['service'];
        $sd = $e['service_data'] ? json_decode($e['service_data'], true) : [];
        $admSections = service_sections($e['service'], 'admission');
        $sesSections = service_sections($e['service'], 'session');

        $pdf->ensureSpace(16);
        $title = $svcLabel . ($e['service_folio'] ? ' · Orden ' . $e['service_folio'] : '');
        $sub = 'Admisión: ' . date('d/m/Y H:i', strtotime($e['admission_date'])) . ' · ' . ucfirst((string)$e['status']);
        $pdf->panelBar($title, $sub);
        $pdf->Ln(3);

        if (!empty($e['reason'])) {
            $pdf->SetFont('Helvetica', '', 8.8);
            $pdf->SetTextColor(...PDF_MUTED);
            $pdf->Write(4.6, pdf_t('Motivo: '));
            $pdf->SetFont('Helvetica', '', 8.8);
            $pdf->SetTextColor(...PDF_INK);
            $pdf->Write(4.6, pdf_t($e['reason']));
            $pdf->Ln(5.5);
        }
        if (!empty($e['referring_doctor'])) {
            $pdf->SetFont('Helvetica', '', 8.8);
            $pdf->SetTextColor(...PDF_MUTED);
            $pdf->Write(4.6, pdf_t('Médico: '));
            $pdf->SetFont('Helvetica', '', 8.8);
            $pdf->SetTextColor(...PDF_INK);
            $pdf->Write(4.6, pdf_t($e['referring_doctor']));
            $pdf->Ln(5.5);
        }

        render_pdf_service_sections($pdf, $admSections, $sd);

        if (!empty($studiesByEpisode[$e['id']])) {
            $pdf->ensureSpace(10);
            $pdf->sectionLabel('Estudios realizados');
            $total = 0.0;
            $rows = [];
            foreach ($studiesByEpisode[$e['id']] as $s) {
                $amount = (float)$s['amount_charged'];
                $total += $amount;
                $rows[] = [$s['study_name'], '$' . number_format($amount, 2)];
            }
            $rows[] = ['Total cobrado', '$' . number_format($total, 2)];
            $pdf->fieldsTable($rows);
        }

        foreach ($consultsByEpisode[$e['id']] ?? [] as $c) {
            $params = $c['params'] ? json_decode($c['params'], true) : [];
            $pdf->ensureSpace(12);
            $pdf->SetFont('Helvetica', 'B', 9);
            $pdf->SetTextColor(...PDF_INK);
            $pdf->Write(4.8, pdf_t('Consulta subsecuente'));
            $pdf->SetFont('Helvetica', '', 8.2);
            $pdf->SetTextColor(...PDF_MUTED);
            $when = ' — ' . date('d/m/Y H:i', strtotime($c['consult_date']))
                . (!empty($c['created_by_name']) ? ' · ' . $c['created_by_name'] : '');
            $pdf->Write(4.8, pdf_t($when));
            $pdf->Ln(5.5);

            if (!empty($c['notes'])) {
                $pdf->SetFont('Helvetica', '', 8.6);
                $pdf->SetTextColor(...PDF_INK);
                $pdf->MultiCell($pdf->usableWidth(), 4.4, pdf_t($c['notes']), 0, 'L');
                $pdf->Ln(1.5);
            }
            render_pdf_service_sections($pdf, $sesSections, $params);
        }
        $pdf->Ln(4);
    }

    // Reserva la última página para el pie corporativo solo si hay imagen de pie configurada.
    if (letterhead_path($lh['footer_file'])) {
        $footerSpace = (float)$lh['footer_height'] + (float)$lh['footer_bottom'] + 4;
        if ($pdf->GetY() + $footerSpace > $pdf->contentLimit()) {
            $pdf->AddPage();
        }
    }
    $pdf->markLastPage();

    if ($path) {
        $pdf->Output('F', $path);
        return $path;
    }
    return $pdf->Output('S');
}

/** Imprime las secciones capturadas del catálogo (admisión o sesión) que traigan datos. */
function render_pdf_service_sections(SiriusDocPDF $pdf, array $sections, ?array $data): void
{
    if (!$data) {
        return;
    }
    foreach ($sections as $sec) {
        $pairs = [];
        $signature = null;
        $signatureField = null;
        foreach ($sec['fields'] as $f) {
            $v = $data[$f['k']] ?? null;
            if ($v === null || $v === '' || $v === false) {
                continue;
            }
            if ($f['t'] === 'signature') {
                $signature = $v;
                $signatureField = $f;
                continue;
            }
            if ($f['t'] === 'checkbox') {
                $display = 'Sí';
            } elseif ($f['t'] === 'checkdetail') {
                $det = $data[$f['k'] . '_det'] ?? '';
                $display = $det !== '' ? 'Sí — ' . (string)$det : 'Sí';
            } else {
                $display = $v === true ? 'Sí' : (string)$v;
            }
            $pairs[] = [$f['l'], $display];
        }
        if (!$pairs && !$signature) {
            continue;
        }
        $pdf->sectionLabel($sec['title']);
        if ($pairs) {
            $pdf->fieldsTable($pairs);
        }
        if ($signature) {
            $pdf->dataUrlImage(
                $signature,
                $signatureField['l'] ?? 'Firma del paciente',
                $signatureField['legend'] ?? null,
                !empty($signatureField['large'])
            );
        }
    }
}

/** Edad en años cumplidos a partir de la fecha de nacimiento. */
function pdf_calc_age(?string $birth): ?int
{
    if (!$birth) {
        return null;
    }
    $b = @date_create($birth);
    if (!$b) {
        return null;
    }
    return (int)date_diff($b, date_create('now'))->y;
}

/**
 * Dibuja la cotización: barra de datos del cliente (reutilizando el encabezado
 * repetible de SiriusDocPDF), tabla de partidas y barras de Subtotal/Descuento/Total.
 * Sin firma, igual que el Expediente: una cotización no la firma nadie.
 */
function render_quote_pdf(array $quote, ?string $path = null): string
{
    $items = is_array($quote['items']) ? $quote['items'] : (json_decode((string)$quote['items'], true) ?: []);

    $clinicName = 'Laboratorio y Clínica Bosques Polanco';
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['clinic_name']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $clinicName = $row['svalue'];
        }
    } catch (Throwable $e) {
    }

    $lh = letterhead_config();
    $pdf = new SiriusDocPDF($lh, $clinicName);
    $pdf->setPatientInfo([
        ['Folio', (string)$quote['folio'], 'Fecha', (string)$quote['quote_date'], 'bold' => true],
        ['Cliente', (string)$quote['client_name'], 'Teléfono', (string)($quote['client_phone'] ?: 'S/N')],
        ['Dirección', (string)($quote['client_address'] ?: 'S/D')],
    ]);

    $pdf->AddPage();
    $pdf->markLastPage();

    $pdf->panelBar('Detalle de Producto', count($items) . ' partida(s)');
    $pdf->quoteItemsHead();
    $i = 0;
    foreach ($items as $item) {
        $name = (string)($item['name'] ?? '');
        $qty = (float)($item['quantity'] ?? 1);
        $unitPrice = (float)($item['unit_price'] ?? 0);
        $lineTotal = (float)($item['line_total'] ?? ($qty * $unitPrice));
        $h = $pdf->quoteItemRowHeight($name);
        $pdf->ensureSpace($h, static fn($p) => $p->quoteItemsHead());
        $pdf->quoteItemRow($i + 1, $name, $qty, $unitPrice, $lineTotal, $i % 2 === 1);
        $i++;
    }
    $pdf->Ln(6);

    $pdf->quoteTotalsBox(
        (float)$quote['subtotal'],
        (float)$quote['discount_pct'],
        (float)$quote['discount_amount'],
        (float)$quote['total']
    );

    $notes = trim((string)($quote['notes'] ?? ''));
    if ($notes !== '') {
        $pdf->Ln(4);
        $pdf->SetFont('Helvetica', 'I', 8.5);
        $pdf->SetTextColor(...PDF_MUTED);
        $pdf->MultiCell(0, 4.6, pdf_t($notes), 0, 'L');
        $pdf->SetTextColor(...PDF_INK);
    }

    if ($path) {
        $pdf->Output('F', $path);
        return $path;
    }
    return $pdf->Output('S');
}

/**
 * Dibuja el estado de cuenta de comisiones: barra de folio/periodo/médico o
 * concierge, tabla de partidas (paciente/estudio/monto/%/comisión) y la barra
 * de Total comisión. Sin firma, es un reporte interno, no un documento clínico.
 */
function render_commission_pdf(array $statement, ?string $path = null): string
{
    $lines = is_array($statement['lines']) ? $statement['lines'] : (json_decode((string)$statement['lines'], true) ?: []);
    $items = $lines['items'] ?? [];
    $partyName = (string)($lines['party_name'] ?? '');
    $partyLabel = $statement['party_type'] === 'concierge' ? 'Concierge' : 'Médico';

    $clinicName = 'Laboratorio y Clínica Bosques Polanco';
    try {
        $st = db()->prepare('SELECT svalue FROM settings WHERE skey = ?');
        $st->execute(['clinic_name']);
        $row = $st->fetch();
        if ($row && $row['svalue']) {
            $clinicName = $row['svalue'];
        }
    } catch (Throwable $e) {
    }

    $lh = letterhead_config();
    $pdf = new SiriusDocPDF($lh, $clinicName);
    $period = date('d/m/Y', strtotime((string)$statement['period_start'])) . ' – ' . date('d/m/Y', strtotime((string)$statement['period_end']));
    $pdf->setPatientInfo([
        ['Folio', (string)$statement['folio'], 'Periodo', $period, 'bold' => true],
        [$partyLabel, $partyName, null, null],
    ]);

    $pdf->AddPage();
    $pdf->markLastPage();

    $pdf->panelBar('Detalle de comisión', count($items) . ' partida(s)');
    $pdf->commissionItemsHead();
    $i = 0;
    $total = 0.0;
    foreach ($items as $item) {
        $patientName = (string)($item['patient_name'] ?? '');
        $studyName = (string)($item['study_name'] ?? '');
        $amount = (float)($item['amount_charged'] ?? 0);
        $pct = (float)($item['commission_pct'] ?? 0);
        $commission = (float)($item['commission_amount'] ?? 0);
        $total += $commission;
        $h = $pdf->commissionItemRowHeight($patientName . ' — ' . $studyName);
        $pdf->ensureSpace($h, static fn($p) => $p->commissionItemsHead());
        $pdf->commissionItemRow($i + 1, $patientName, $studyName, $amount, $pct, $commission, $i % 2 === 1);
        $i++;
    }
    $pdf->Ln(6);

    $pdf->commissionTotalsBox((float)($statement['total_commission'] ?? $total));

    if ($path) {
        $pdf->Output('F', $path);
        return $path;
    }
    return $pdf->Output('S');
}
