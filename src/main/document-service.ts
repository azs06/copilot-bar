import { dialog } from "electron";
import { stat } from "node:fs/promises";
import { extname, basename } from "node:path";

// Security: Allowed file types and size limits
const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".xlsx",
  ".xls",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface DocumentInfo {
  path: string;
  name: string;
  type: "pdf" | "image" | "text";
  size: number;
  mimeType: string;
}

/**
 * Validate a document file by type and size
 */
export async function validateDocument(filePath: string): Promise<{ valid: boolean; error?: string; info?: DocumentInfo }> {
  try {
    // Check file stats
    const stats = await stat(filePath);

    // Check file size
    if (stats.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds 10MB limit (${(stats.size / (1024 * 1024)).toFixed(1)}MB)`,
      };
    }

    // Check file extension
    const ext = extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return {
        valid: false,
        error: `Unsupported file type: ${ext}. Allowed types: ${ALLOWED_EXTENSIONS.join(", ")}`,
      };
    }

    // Determine document type and MIME type
    const fileName = basename(filePath);
    let type: "pdf" | "image" | "text";
    let mimeType: string;

    if (ext === ".pdf") {
      type = "pdf";
      mimeType = "application/pdf";
    } else if ([".png", ".jpg", ".jpeg"].includes(ext)) {
      type = "image";
      mimeType = ext === ".png" ? "image/png" : "image/jpeg";
    } else if ([".xlsx", ".xls"].includes(ext)) {
      type = "text"; // Treat Excel as text for analysis purposes
      mimeType = ext === ".xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/vnd.ms-excel";
    } else {
      type = "text";
      mimeType = ext === ".json" ? "application/json" :
                 ext === ".csv" ? "text/csv" :
                 ext === ".md" || ext === ".markdown" ? "text/markdown" :
                 "text/plain";
    }

    return {
      valid: true,
      info: {
        path: filePath,
        name: fileName,
        type,
        size: stats.size,
        mimeType,
      },
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error?.message || "Failed to validate file",
    };
  }
}

/**
 * Open file picker dialog and return selected document info
 */
export async function selectAndPrepareDocument(): Promise<{
  success: boolean;
  document?: DocumentInfo;
  error?: string;
}> {
  try {
    // Open file picker dialog
    const result = await dialog.showOpenDialog({
      title: "Select a document to analyze",
      properties: ["openFile"],
      filters: [
        { name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "txt", "md", "json", "csv", "xlsx", "xls"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    // User cancelled
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "No file selected" };
    }

    const filePath = result.filePaths[0];

    // Validate the document
    const validation = await validateDocument(filePath);

    if (!validation.valid || !validation.info) {
      return {
        success: false,
        error: validation.error || "Invalid file",
      };
    }

    return {
      success: true,
      document: validation.info,
    };
  } catch (error: any) {
    console.error("Document selection error:", error);
    return {
      success: false,
      error: error?.message || "Failed to select document",
    };
  }
}

/**
 * List supported document formats (for AI tool)
 */
export function listSupportedFormats(): Array<{ name: string; extensions: string[]; description: string }> {
  return [
    { name: "PDF", extensions: ["pdf"], description: "PDF documents for vision analysis" },
    { name: "Images", extensions: ["png", "jpg", "jpeg"], description: "Image files for vision analysis" },
    { name: "Text", extensions: ["txt", "md", "json", "csv"], description: "Plain text and structured data files" },
    { name: "Excel", extensions: ["xlsx", "xls"], description: "Excel spreadsheets for data analysis and charts" },
  ];
}
