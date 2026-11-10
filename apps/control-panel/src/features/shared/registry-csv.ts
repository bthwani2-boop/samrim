export function downloadRegistryCsv(
  filename: string,
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean>>,
  metadata: ReadonlyArray<string> = [],
): void {
  const cell = (value: string | number | boolean) => {
    // Spreadsheet applications can evaluate untrusted names as formulae on import.
    // Prefix only risky text; numeric negative amounts must remain numeric in exports.
    let normalized = String(value).replace(/[\r\n\t]+/g, " ");
    if (typeof value === "string" && /^[\s\u200B-\u200D\u2060\uFEFF]*[=+\-@]/u.test(normalized)) normalized = `'${normalized}`;
    return `"${normalized.replaceAll('"', '""')}"`;
  };
  // Metadata is emitted as non-formula comment lines before the header, never as new CSV records.
  const comments = metadata.map((entry) => `# ${entry.replace(/[\r\n\t\u2028\u2029]+/g, " ")}`);
  const values = [headers, ...rows].map((row) => row.map(cell).join(","));
  const content = `\uFEFF${[...comments, ...values].join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
