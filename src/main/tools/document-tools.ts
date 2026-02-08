import { defineTool } from "@github/copilot-sdk";
import { selectAndPrepareDocument, listSupportedFormats } from "../document-service.js";

/**
 * Tool for attaching a document for analysis
 * Opens a file picker dialog and returns document info for attachment
 */
const attachDocumentTool = defineTool("attach_document", {
  description: "Attach a document file (PDF, image, or text) for AI analysis. Supports PDF, PNG, JPG, TXT, MD, JSON, and CSV files up to 10MB. Opens a file picker dialog for the user to select a file.",
  parameters: {
    type: "object",
    properties: {
      fileType: {
        type: "string",
        enum: ["pdf", "image", "text", "any"],
        description: "Type of document to attach (or 'any' for no filter)",
      },
      prompt: {
        type: "string",
        description: "Optional context about what to analyze in the document (e.g., 'summarize this report', 'extract key dates')",
      },
    },
    required: [],
  },
  handler: async ({ fileType = "any", prompt = "" }: { fileType?: string; prompt?: string }) => {
    try {
      const result = await selectAndPrepareDocument();

      if (!result.success || !result.document) {
        return {
          success: false,
          error: result.error || "Failed to attach document",
          message: "Please select a valid document file.",
        };
      }

      const { document } = result;

      return {
        success: true,
        message: `Attached "${document.name}" (${document.type}, ${document.size} bytes). The document will be included with your next message for analysis.`,
        document: {
          name: document.name,
          type: document.type,
          size: document.size,
          path: document.path,
        },
        hasAttachment: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to attach document",
        message: "An error occurred while attaching the document.",
      };
    }
  },
});

/**
 * Tool for listing supported document formats
 */
const listSupportedFormatsTool = defineTool("list_supported_formats", {
  description: "List all supported document formats for analysis. Returns information about file types, extensions, and size limits.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async () => {
    const formats = listSupportedFormats();

    return {
      success: true,
      message: "Supported document formats:",
      formats: formats.map((f) => ({
        type: f.name,
        extensions: f.extensions.join(", "),
        description: f.description,
      })),
      maxSize: "10MB",
      totalFormats: formats.length,
    };
  },
});

// Export all document tools
export const documentTools = [attachDocumentTool, listSupportedFormatsTool];
