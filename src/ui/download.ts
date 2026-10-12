/** Download a browser-generated report without sending inventory to a third party. */
export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Quote fields and neutralise spreadsheet formulas in untrusted inventory names. */
export function csvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const safe = typeof value !== 'number' && /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly unknown[])[]): void {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  downloadText(filename, `\uFEFF${csv}\r\n`, 'text/csv;charset=utf-8');
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, `${JSON.stringify(data, null, 2)}\n`, 'application/json;charset=utf-8');
}
