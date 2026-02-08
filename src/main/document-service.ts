import { dialog } from "electron";
import { readFile, stat } from "node:fs/promises";
import { extname, basename } from "node:path";
import { randomUUID } from "node:crypto";

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
];

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
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
        { name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "txt", "md", "json", "csv"] },
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
 * Get document type icon for UI display
 */
export function getDocumentIcon(type: "pdf" | "image" | "text"): string {
  const icons = { pdf: "📄", image: "🖼️", text: "📝" };
  return icons[type] || "📎";
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * List supported document formats (for AI tool)
 */
export function listSupportedFormats(): Array<{ name: string; extensions: string[]; description: string }> {
  return [
    { name: "PDF", extensions: ["pdf"], description: "PDF documents for vision analysis" },
    { name: "Images", extensions: ["png", "jpg", "jpeg"], description: "Image files for vision analysis" },
    { name: "Text", extensions: ["txt", "md", "json", "csv"], description: "Plain text and structured data files" },
  ];
}
