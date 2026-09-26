export function downloadRegistryCsv(filename: string, headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string | number | boolean>>): void {
  const cell = (value: string | number | boolean) => {
    let normalized = String(value).replace(/[\r\n]+/g, " ");
    if (/^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
    return `"${normalized.replaceAll('"', '""')}"`;
  };
  const content = `\uFEFF${[headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
