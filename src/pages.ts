import { getSupabaseClient } from './supabase';

type ChartType = 'bar' | 'hbar' | 'line' | 'donut' | 'pie';

interface HomeSummary {
    physical_rice_area_ha: number | null;
    total_farmers: number | null;
    total_affected_area_ha: number;
    affected_farmers: number;
    record_count: number;
}

interface StressBreakdown {
    code: string;
    label: string;
    color: string;
    area_ha: number;
    farmers: number;
    record_count: number;
}

interface ProvinceTotal {
    province_pcode: string;
    province_name: string;
    physical_rice_area_ha: number | null;
    total_farmers: number | null;
    total_affected_area_ha: number;
    affected_farmers: number;
    record_count: number;
    stress_breakdown: StressBreakdown[];
    favorable_area_ha: number | null;
}

interface StressTypeTotal {
    stress_code: string;
    stress_label: string;
    stress_color: string;
    total_area_ha: number;
    total_farmers: number;
    record_count: number;
}

interface HomeData {
    summary: HomeSummary;
    provinces: ProvinceTotal[];
    stressTypes: StressTypeTotal[];
}

interface ChartItem {
    label: string;
    value: number;
    color: string;
    short?: string;
}

const chartTypes: { type: ChartType; label: string }[] = [
    { type: 'bar', label: 'Bar' },
    { type: 'hbar', label: 'Horizontal' },
    { type: 'line', label: 'Line' },
    { type: 'donut', label: 'Donut' },
    { type: 'pie', label: 'Pie' },
];

const provinceColors = ['#1e7a4d', '#d98a1c', '#3d8fd1', '#8a5fc4', '#c0563f', '#5a8a2e'];
const chartModes: Record<string, ChartType> = { physical: 'bar', affected: 'hbar', farmers: 'bar' };

export function renderPage(title: string): string {
    if (title === 'Home') {
        return `
            <section class="page-head">
                <h1>Bicol Rice Stress Prone Information Hub</h1>
            </section>
            <div id="home-content" aria-live="polite">
                <div class="card" role="status"><p class="muted">Loading home data...</p></div>
            </div>`;
    }

    return `<section class="page-head"><h1>${escapeHtml(title)}</h1></section>`;
}

export function mountPage(title: string): void {
    if (title !== 'Home') {
        return;
    }

    const homeContent = document.querySelector<HTMLElement>('#home-content');
    if (!homeContent) {
        return;
    }
    const container: HTMLElement = homeContent;

    let homeData: HomeData | null = null;
    let affectedGroup: 'province' | 'stress' = 'province';
    let landProvince = '';

    container.addEventListener('click', (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const chartButton = target.closest<HTMLButtonElement>('[data-chart-key][data-chart-type]');
        if (chartButton) {
            const key = chartButton.dataset.chartKey;
            const type = chartButton.dataset.chartType as ChartType;
            if (key && chartTypes.some((item) => item.type === type)) {
                chartModes[key] = type;
                paint();
                container.querySelector<HTMLButtonElement>(
                    `[data-chart-key="${key}"][data-chart-type="${type}"]`,
                )?.focus();
            }
            return;
        }

        const groupButton = target.closest<HTMLButtonElement>('[data-affected-group]');
        if (groupButton?.dataset.affectedGroup === 'province' || groupButton?.dataset.affectedGroup === 'stress') {
            affectedGroup = groupButton.dataset.affectedGroup;
            paint();
            container.querySelector<HTMLButtonElement>(
                `[data-affected-group="${affectedGroup}"]`,
            )?.focus();
            return;
        }

        if (target.closest<HTMLButtonElement>('[data-home-retry]')) {
            void load();
        }
    });

    container.addEventListener('change', (event: Event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement && target.name === 'land-province') {
            landProvince = target.value;
            paint();
            container.querySelector<HTMLSelectElement>('[name="land-province"]')?.focus();
        }
    });

    function paint(): void {
        if (homeData) {
            container.innerHTML = renderHome(homeData, affectedGroup, landProvince);
        }
    }

    async function load(): Promise<void> {
        container.innerHTML = '<div class="card" role="status"><p class="muted">Loading home data...</p></div>';

        try {
            const client = getSupabaseClient();
            const [summaryResult, provinceResult, stressResult] = await Promise.all([
                client.from('v_home_summary').select('*').single(),
                client.from('v_province_totals').select('*').order('province_name'),
                client.from('v_stress_type_totals').select('*').order('sort_order'),
            ]);

            const queryError = summaryResult.error ?? provinceResult.error ?? stressResult.error;
            if (queryError) {
                throw new Error(queryError.message);
            }

            const summary = summaryResult.data as HomeSummary | null;
            const provinces = (provinceResult.data ?? []) as ProvinceTotal[];
            const stressTypes = (stressResult.data ?? []) as StressTypeTotal[];

            if (!summary || provinces.length === 0 || Number(summary.record_count) === 0) {
                container.innerHTML = `
                    <div class="card" role="status">
                        <h2>No published data yet</h2>
                        <p class="muted" style="margin-top:8px">Home totals will appear when province reference data and published stress records are available.</p>
                    </div>`;
                return;
            }

            homeData = { summary, provinces, stressTypes };
            if (!provinces.some((province) => province.province_pcode === landProvince)) {
                landProvince = provinces.find((province) => province.physical_rice_area_ha !== null)?.province_pcode ?? provinces[0].province_pcode;
            }
            paint();
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';
            const message = /schema cache/i.test(detail) && /v_home_summary|v_province_totals|v_stress_type_totals/.test(detail)
                ? 'The Home totals views are not available yet. Apply supabase/migrations/002_views.sql in Supabase, then reload this page.'
                : detail;
            container.innerHTML = `
                <div class="card" role="alert">
                    <h2>Home data could not be loaded</h2>
                    <p class="muted" style="margin-top:8px">${escapeHtml(message)}</p>
                    <button class="btn sm" type="button" data-home-retry style="margin-top:14px">Retry</button>
                </div>`;
        }
    }

    void load();
}

function renderHome(data: HomeData, affectedGroup: 'province' | 'stress', landProvince: string): string {
    const { summary, provinces, stressTypes } = data;
    const provinceAreaItems = provinces.flatMap((province, index) => {
        const value = finiteValue(province.physical_rice_area_ha);
        return value === null ? [] : [{ label: province.province_name, short: shortProvince(province.province_name), value, color: provinceColors[index % provinceColors.length] }];
    });
    const affectedItems = affectedGroup === 'province'
        ? provinces.map((province, index) => ({
            label: province.province_name,
            short: shortProvince(province.province_name),
            value: Number(province.total_affected_area_ha),
            color: provinceColors[index % provinceColors.length],
        }))
        : stressTypes.map((stress) => ({
            label: stress.stress_label,
            short: stress.stress_code,
            value: Number(stress.total_area_ha),
            color: stress.stress_color,
        }));
    const farmerItems = provinces.flatMap((province, index) => {
        const value = finiteValue(province.affected_farmers);
        return value === null ? [] : [{ label: province.province_name, short: shortProvince(province.province_name), value, color: provinceColors[index % provinceColors.length] }];
    });

    return `
        <section aria-label="Rice area at a glance" style="margin-bottom:28px">
            <div class="glance-head">
                <div><h2>Rice area at a glance</h2><p>Published stress records and province reference totals.</p></div>
            </div>
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))">
                ${renderMetricCard(
        'Total physical rice area',
        summary.physical_rice_area_ha,
        summary.physical_rice_area_ha === null
            ? 'Province physical-area values have not been loaded.'
            : 'hectares across reporting provinces',
        'physical',
        provinceAreaItems,
        'ha',
    )}
                <div class="card gcard">
                    <div class="top">
                        <span class="lbl">Total affected area</span>
                        <span class="big">${formatNumber(summary.total_affected_area_ha)}</span>
                        <span class="muted">hectares · ${formatNumber(summary.record_count, 0)} published records</span>
                    </div>
                    <div class="seg" role="group" aria-label="Affected area grouped by">
                        <button type="button" data-affected-group="province" aria-pressed="${affectedGroup === 'province'}">By province</button>
                        <button type="button" data-affected-group="stress" aria-pressed="${affectedGroup === 'stress'}">By stress type</button>
                    </div>
                    ${renderChartControls('affected')}
                    ${renderChart(chartModes.affected, affectedItems, 'ha', 'Affected area')}
                </div>
                ${renderMetricCard('Affected farmers', summary.affected_farmers, 'farmers represented in published stress records, by province', 'farmers', farmerItems, 'farmers')}
            </div>
        </section>
        ${renderLandCondition(provinces, landProvince)}`;
}

function renderMetricCard(
    label: string,
    total: number | null,
    description: string,
    chartKey: string,
    items: ChartItem[],
    unit: string,
): string {
    return `
        <div class="card gcard">
            <div class="top">
                <span class="lbl">${escapeHtml(label)}</span>
                <span class="big">${total === null ? 'Unavailable' : formatNumber(total)}</span>
                <span class="muted">${escapeHtml(description)}</span>
            </div>
            ${items.length > 0 ? renderChartControls(chartKey) : ''}
            ${renderChart(chartModes[chartKey], items, unit, label)}
        </div>`;
}

function renderChartControls(chartKey: string): string {
    return `<div class="seg" role="group" aria-label="${escapeHtml(chartKey)} chart type">${chartTypes.map(({ type, label }) => `
        <button type="button" data-chart-key="${chartKey}" data-chart-type="${type}" aria-pressed="${chartModes[chartKey] === type}">${label}</button>`).join('')}
    </div>`;
}

function renderChart(type: ChartType, sourceItems: ChartItem[], unit: string, description: string): string {
    const items = sourceItems.filter((item) => Number.isFinite(item.value) && item.value > 0);
    if (items.length === 0) {
        return '<p class="muted" style="padding:24px 0">No values are available for this chart.</p>';
    }

    const total = items.reduce((sum, item) => sum + item.value, 0);
    if (type === 'donut' || type === 'pie') {
        let angle = -Math.PI / 2;
        const paths = items.map((item) => {
            const fraction = item.value / total;
            const next = angle + fraction * Math.PI * 2;
            const [x0, y0] = pointOnCircle(75, 75, 70, angle);
            const [x1, y1] = pointOnCircle(75, 75, 70, next - 0.0001);
            const innerRadius = type === 'donut' ? 42 : 0;
            const [x2, y2] = pointOnCircle(75, 75, innerRadius, next - 0.0001);
            const [x3, y3] = pointOnCircle(75, 75, innerRadius, angle);
            const largeArc = fraction > 0.5 ? 1 : 0;
            const path = innerRadius > 0
                ? `M${x0} ${y0}A70 70 0 ${largeArc} 1 ${x1} ${y1}L${x2} ${y2}A42 42 0 ${largeArc} 0 ${x3} ${y3}Z`
                : `M75 75L${x0} ${y0}A70 70 0 ${largeArc} 1 ${x1} ${y1}Z`;
            angle = next;
            return `<path d="${path}" fill="${escapeHtml(item.color)}" stroke="var(--surface)" stroke-width="2"><title>${escapeHtml(item.label)}: ${formatNumber(item.value)} ${escapeHtml(unit)}</title></path>`;
        }).join('');
        const legend = items.map((item) => `
            <li><i style="background:${escapeHtml(item.color)}"></i><span>${escapeHtml(item.label)}</span><span class="n">${formatNumber(item.value)} · ${Math.round(item.value / total * 100)}%</span></li>`).join('');
        return `<div class="pie"><svg viewBox="0 0 150 150" role="img" aria-label="${escapeHtml(description)} by ${items.length} groups">${paths}${type === 'donut' ? `<text x="75" y="73" text-anchor="middle">${compactNumber(total)}</text><text x="75" y="88" text-anchor="middle" style="font-size:9px;fill:var(--muted);font-family:var(--sans)">${escapeHtml(unit)}</text>` : ''}</svg><ul>${legend}</ul></div>`;
    }

    const max = niceMaximum(Math.max(...items.map((item) => item.value)));
    if (type === 'hbar') {
        const rowHeight = 30;
        const height = items.length * rowHeight + 8;
        const labelWidth = 118;
        const width = 360;
        const barWidth = width - labelWidth - 56;
        const rows = items.map((item, index) => {
            const y = 4 + index * rowHeight;
            const valueWidth = item.value / max * barWidth;
            return `<text x="${labelWidth - 8}" y="${y + rowHeight / 2 + 1}" text-anchor="end" dominant-baseline="middle">${escapeHtml(item.short ?? item.label)}</text><rect x="${labelWidth}" y="${y + 5}" width="${valueWidth}" height="${rowHeight - 12}" rx="4" fill="${escapeHtml(item.color)}"><title>${escapeHtml(item.label)}: ${formatNumber(item.value)} ${escapeHtml(unit)}</title></rect><text class="v" x="${labelWidth + valueWidth + 6}" y="${y + rowHeight / 2 + 1}" dominant-baseline="middle">${compactNumber(item.value)}</text>`;
        }).join('');
        return `<svg class="chart" viewBox="0 0 360 ${height}" role="img" aria-label="${escapeHtml(description)} by group">${rows}</svg>`;
    }

    const width = 360;
    const height = 220;
    const left = 38;
    const right = 10;
    const top = 18;
    const bottom = 30;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const slot = plotWidth / items.length;
    const x = (index: number): number => left + slot * index + slot / 2;
    const y = (value: number): number => top + plotHeight - value / max * plotHeight;
    let grid = '';
    for (let tick = 0; tick <= 4; tick += 1) {
        const value = max * tick / 4;
        const tickY = y(value);
        grid += `<line class="grid" x1="${left}" x2="${width - right}" y1="${tickY}" y2="${tickY}"/><text x="${left - 5}" y="${tickY + 3}" text-anchor="end">${compactNumber(value)}</text>`;
    }

    const labels = items.map((item, index) => `<text x="${x(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(item.short ?? item.label)}</text>`).join('');
    let marks: string;
    if (type === 'line') {
        const points = items.map((item, index) => [x(index), y(item.value)] as const);
        const linePoints = points.map((point) => point.join(',')).join(' ');
        const areaPath = `M${points[0][0]} ${top + plotHeight}L${points.map((point) => point.join(' ')).join('L')}L${points[points.length - 1][0]} ${top + plotHeight}Z`;
        marks = `<path d="${areaPath}" fill="#d9731a" opacity=".14"/><polyline points="${linePoints}" fill="none" stroke="#d9731a" stroke-width="2.5" stroke-linejoin="round"/>` + points.map((point, index) => `<circle cx="${point[0]}" cy="${point[1]}" r="4" fill="#d9731a" stroke="var(--surface)" stroke-width="1.5"><title>${escapeHtml(items[index].label)}: ${formatNumber(items[index].value)} ${escapeHtml(unit)}</title></circle><text class="v" x="${point[0]}" y="${point[1] - 9}" text-anchor="middle">${compactNumber(items[index].value)}</text>`).join('');
    } else {
        const barWidth = slot * 0.62;
        marks = items.map((item, index) => `<rect x="${x(index) - barWidth / 2}" y="${y(item.value)}" width="${barWidth}" height="${top + plotHeight - y(item.value)}" rx="3" fill="${escapeHtml(item.color)}"><title>${escapeHtml(item.label)}: ${formatNumber(item.value)} ${escapeHtml(unit)}</title></rect><text class="v" x="${x(index)}" y="${y(item.value) - 4}" text-anchor="middle">${compactNumber(item.value)}</text>`).join('');
    }

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(description)} by group">${grid}${marks}${labels}</svg>`;
}

function renderLandCondition(provinces: ProvinceTotal[], selectedCode: string): string {
    const province = provinces.find((item) => item.province_pcode === selectedCode) ?? provinces[0];
    const physicalArea = finiteValue(province.physical_rice_area_ha);
    const affectedArea = Number(province.total_affected_area_ha);
    const hasValidBasis = physicalArea !== null && physicalArea > 0 && province.favorable_area_ha !== null;
    const options = provinces.map((item) => `<option value="${escapeHtml(item.province_pcode)}"${item.province_pcode === province.province_pcode ? ' selected' : ''}>${escapeHtml(item.province_name)}</option>`).join('');

    let charts: string;
    if (!hasValidBasis) {
        const reason = physicalArea === null
            ? 'Physical rice area is not available for this province.'
            : physicalArea <= 0
                ? 'Physical rice area must be greater than zero to calculate land-condition shares.'
                : 'Published stress area exceeds the reported physical rice area; percentage breakdown is unavailable.';
        charts = `<p class="muted" role="status">${escapeHtml(reason)}</p>`;
    } else {
        const favorableArea = Number(province.favorable_area_ha);
        const conditions: ChartItem[] = [
            { label: 'Favorable', value: favorableArea, color: '#2f8f4e' },
            { label: 'Unfavorable', value: affectedArea, color: '#5b6b7a' },
        ];
        const stressItems = province.stress_breakdown.map((stress) => ({
            label: stress.label,
            value: Number(stress.area_ha),
            color: stress.color,
        }));
        charts = `
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
                <div>
                    <h3>Favorable and unfavorable</h3>
                    <p class="muted" style="margin:6px 0 12px">Share of ${escapeHtml(province.province_name)} rice area</p>
                    ${renderChart('pie', conditions, 'ha', 'Land condition')}
                </div>
                <div>
                    <h3>Unfavorable area by stress type</h3>
                    <p class="muted" style="margin:6px 0 12px">Published affected hectares by category</p>
                    ${renderChart('donut', stressItems, 'ha', 'Unfavorable area by stress type')}
                </div>
            </div>`;
    }

    return `
        <section aria-label="Land condition in ${escapeHtml(province.province_name)}" style="margin-bottom:28px">
            <div class="glance-head">
                <div><h2>Land condition</h2><p>Rice area shares with the unfavorable portion broken down by stress type.</p></div>
                <div class="field"><label for="land-province">Province</label><select id="land-province" name="land-province">${options}</select></div>
            </div>
            <div class="card ppwrap">
                <div class="ppdetail" aria-live="polite">
                    <span class="badge"><i style="background:#2f8f4e"></i>${escapeHtml(province.province_name)}</span>
                    <span>Physical rice area</span><b class="mono">${physicalArea === null ? 'Unavailable' : `${formatNumber(physicalArea)} ha`}</b>
                    <span>Published affected area</span><b class="mono">${formatNumber(affectedArea)} ha</b>
                </div>
                ${charts}
            </div>
        </section>`;
}

function pointOnCircle(centerX: number, centerY: number, radius: number, angle: number): [number, number] {
    return [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius];
}

function niceMaximum(value: number): number {
    const power = Math.pow(10, Math.floor(Math.log10(value)));
    const fraction = value / power;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
}

function finiteValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatNumber(value: number, maximumFractionDigits = 1): string {
    return Number(value).toLocaleString('en-US', { maximumFractionDigits, minimumFractionDigits: 0 });
}

function compactNumber(value: number): string {
    return value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value));
}

function shortProvince(name: string): string {
    return name.replace('Camarines Norte', 'C. Norte').replace('Camarines Sur', 'C. Sur').replace('Catanduanes', 'Catand.');
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character] ?? character);
}