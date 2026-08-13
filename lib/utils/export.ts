// 数据导出工具: CSV / Excel(xlsx) / JSON
import ExcelJS from "exceljs";

export type Row = Record<string, unknown>;

/** 转为 CSV 字符串 (含表头, RFC4180 转义) */
export function toCSV(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h])).join(","));
  }
  // 加 BOM 让 Excel 正确识别 UTF-8
  return "\uFEFF" + lines.join("\r\n");
}

/** 转为 Excel Buffer (exceljs) */
export async function toExcel(rows: Row[], sheetName = "data"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  if (rows.length === 0) {
    ws.addRow(["(无数据)"]);
  } else {
    const headers = Object.keys(rows[0]);
    ws.addRow(headers);
    for (const r of rows) {
      ws.addRow(headers.map((h) => (r[h] ?? "")));
    }
    // 表头加粗
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => {
      let max = 10;
      c.eachCell?.((cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > max) max = len;
      });
      c.width = Math.min(40, max + 2);
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** 转为 JSON 字符串 (格式化) */
export function toJSON(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}
