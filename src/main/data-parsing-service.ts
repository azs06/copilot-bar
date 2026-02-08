import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedData {
  headers: string[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  columnCount: number;
}

export interface ColumnAnalysis {
  name: string;
  type: "string" | "number" | "boolean" | "mixed";
  sampleValues: (string | number | boolean | null)[];
  uniqueCount: number;
  nullCount: number;
  numericStats?: {
    min: number;
    max: number;
    mean: number;
    sum: number;
  };
}

export interface DataAnalysis {
  columns: ColumnAnalysis[];
  rowCount: number;
  columnCount: number;
  suggestedChartTypes: string[];
}

/**
 * Parse a CSV or Excel file into structured data
 */
export async function parseDataFile(filePath: string): Promise<{ success: boolean; data?: ParsedData; error?: string }> {
  try {
    const ext = extname(filePath).toLowerCase();

    if (ext === ".csv") {
      return await parseCsvFile(filePath);
    } else if (ext === ".xlsx" || ext === ".xls") {
      return await parseExcelFile(filePath);
    } else {
      return { success: false, error: `Unsupported file type: ${ext}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: `Failed to parse file: ${message}` };
  }
}

/**
 * Parse a CSV file using papaparse
 */
async function parseCsvFile(filePath: string): Promise<{ success: boolean; data?: ParsedData; error?: string }> {
  const content = await readFile(filePath, "utf-8");

  return new Promise((resolve) => {
    Papa.parse<Record<string, string | number | boolean | null>>(content, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results: Papa.ParseResult<Record<string, string | number | boolean | null>>) => {
        if (results.errors.length > 0) {
          // Log errors but don't fail - we can still work with partial data
          console.warn("[CSV parse warnings]:", results.errors.map((e: Papa.ParseError) => e.message).join(", "));
        }

        const headers = results.meta.fields || [];
        const rows = results.data;

        resolve({
          success: true,
          data: {
            headers,
            rows,
            rowCount: rows.length,
            columnCount: headers.length,
          },
        });
      },
      error: (error: Error) => {
        resolve({ success: false, error: `CSV parse error: ${error.message}` });
      },
    });
  });
}

/**
 * Parse an Excel file using xlsx library
 */
async function parseExcelFile(filePath: string): Promise<{ success: boolean; data?: ParsedData; error?: string }> {
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });

  // Use the first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { success: false, error: "Excel file has no sheets" };
  }

  const sheet = workbook.Sheets[sheetName];

  // Convert to JSON with header row
  const jsonData = XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null>>(sheet, {
    defval: null,
    raw: false, // Get formatted values
  });

  if (jsonData.length === 0) {
    return { success: false, error: "Excel sheet is empty" };
  }

  // Extract headers from first row
  const headers = Object.keys(jsonData[0]);

  // Convert string numbers to actual numbers where possible
  const rows = jsonData.map((row: Record<string, string | number | boolean | null>) => {
    const parsedRow: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined || value === "") {
        parsedRow[key] = null;
      } else if (typeof value === "string") {
        // Try to parse as number
        const num = Number(value);
        if (!isNaN(num) && value.trim() !== "") {
          parsedRow[key] = num;
        } else if (value.toLowerCase() === "true") {
          parsedRow[key] = true;
        } else if (value.toLowerCase() === "false") {
          parsedRow[key] = false;
        } else {
          parsedRow[key] = value;
        }
      } else {
        // value is already number or boolean
        parsedRow[key] = value as string | number | boolean | null;
      }
    }
    return parsedRow;
  });

  return {
    success: true,
    data: {
      headers,
      rows,
      rowCount: rows.length,
      columnCount: headers.length,
    },
  };
}

/**
 * Analyze parsed data to provide insights for chart generation
 */
export function analyzeData(data: ParsedData): DataAnalysis {
  const columns: ColumnAnalysis[] = data.headers.map(header => analyzeColumn(header, data.rows));
  const suggestedChartTypes = suggestChartTypes(columns, data.rowCount);

  return {
    columns,
    rowCount: data.rowCount,
    columnCount: data.columnCount,
    suggestedChartTypes,
  };
}

/**
 * Analyze a single column's data
 */
function analyzeColumn(name: string, rows: Record<string, string | number | boolean | null>[]): ColumnAnalysis {
  const values = rows.map(row => row[name]);
  const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== "");
  const uniqueValues = new Set(nonNullValues);
  const nullCount = values.length - nonNullValues.length;

  // Determine type
  const types = new Set<string>();
  const numericValues: number[] = [];

  for (const val of nonNullValues) {
    if (typeof val === "number") {
      types.add("number");
      numericValues.push(val);
    } else if (typeof val === "boolean") {
      types.add("boolean");
    } else {
      types.add("string");
    }
  }

  const type = types.size === 1 ? [...types][0] as "string" | "number" | "boolean" : "mixed";

  const result: ColumnAnalysis = {
    name,
    type,
    sampleValues: nonNullValues.slice(0, 5),
    uniqueCount: uniqueValues.size,
    nullCount,
  };

  // Add numeric stats if applicable
  if (numericValues.length > 0) {
    result.numericStats = {
      min: Math.min(...numericValues),
      max: Math.max(...numericValues),
      mean: numericValues.reduce((a, b) => a + b, 0) / numericValues.length,
      sum: numericValues.reduce((a, b) => a + b, 0),
    };
  }

  return result;
}

/**
 * Suggest appropriate chart types based on data characteristics
 */
function suggestChartTypes(columns: ColumnAnalysis[], rowCount: number): string[] {
  const suggestions: string[] = [];

  const numericColumns = columns.filter(c => c.type === "number" || c.type === "mixed");
  const stringColumns = columns.filter(c => c.type === "string");

  // If we have at least one string (labels) and one numeric column
  if (stringColumns.length >= 1 && numericColumns.length >= 1) {
    suggestions.push("bar", "horizontalBar");

    // Pie/doughnut good for fewer categories
    if (rowCount <= 10) {
      suggestions.push("pie", "doughnut");
    }
  }

  // Line chart good for time series or many data points
  if (numericColumns.length >= 2 || rowCount > 10) {
    suggestions.push("line");
  }

  // Scatter for two numeric columns
  if (numericColumns.length >= 2) {
    suggestions.push("scatter");
  }

  // Always allow table as fallback
  suggestions.push("table");

  return suggestions;
}
