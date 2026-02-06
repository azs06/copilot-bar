import { defineTool } from "@github/copilot-sdk";
import { execAsync, execFileAsync, writeFileAsync, unlinkAsync } from "./helpers.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

// URL summarizer tool
const summarizeUrlTool = defineTool("summarize_url", {
  description: "Fetch and summarize content from a web page URL.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch and summarize",
      },
      max_length: {
        type: "number",
        description: "Maximum length of summary in characters (default: 500)",
      },
    },
    required: ["url"],
  },
  handler: async ({ url, max_length = 500 }: { url: string; max_length?: number }) => {
    try {
      const { stdout } = await execFileAsync("curl", ["-sL", url, "--max-time", "10"], { timeout: 15000 });

      let text = stdout
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const titleMatch = stdout.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : 'Unknown';

      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
      let summary = sentences.slice(0, 3).join('. ').trim();

      if (summary.length > max_length) {
        summary = summary.substring(0, max_length) + '...';
      }

      return {
        success: true,
        url,
        title,
        summary,
        full_length: text.length,
        message: `Summarized "${title}"`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to fetch URL: ${error.message}`
      };
    }
  },
});

// Weather tool
const getWeatherTool = defineTool("get_weather", {
  description: "Get current weather information for a location using wttr.in API.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "City name or location (e.g., 'London', 'New York', 'Tokyo')",
      },
      format: {
        type: "string",
        enum: ["brief", "full"],
        description: "Weather format: brief (one line) or full (detailed)",
      },
    },
    required: ["location"],
  },
  handler: async ({ location, format = "brief" }: { location: string; format?: "brief" | "full" }) => {
    try {
      const encodedLocation = encodeURIComponent(location);
      const formatFlag = format === "brief" ? "?format=%l:+%c+%t+%w" : "";
      const { stdout } = await execFileAsync("curl", ["-s", `wttr.in/${encodedLocation}${formatFlag}`, "--max-time", "10"], { timeout: 15000 });

      if (stdout.includes("Unknown location")) {
        return {
          success: false,
          error: `Unknown location: "${location}"`
        };
      }

      return {
        success: true,
        location,
        weather: stdout.trim(),
        message: `Weather for ${location}: ${stdout.trim().substring(0, 100)}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to fetch weather: ${error.message}`
      };
    }
  },
});

// Image drop/analysis tool
const analyzeImageTool = defineTool("analyze_image", {
  description: "Analyze or describe an image file. Uses macOS system tools to extract basic image information.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the image file to analyze",
      },
    },
    required: ["path"],
  },
  handler: async ({ path: imagePath }: { path: string }) => {
    try {
      const [mdlsResult, sipsResult] = await Promise.all([
        execFileAsync("mdls", [imagePath]),
        execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath]).catch(() => null),
      ]);
      const mdlsOutput = mdlsResult.stdout;

      let dimensions = "Unknown";
      if (sipsResult) {
        const widthMatch = sipsResult.stdout.match(/pixelWidth: (\d+)/);
        const heightMatch = sipsResult.stdout.match(/pixelHeight: (\d+)/);
        if (widthMatch && heightMatch) {
          dimensions = `${widthMatch[1]}x${heightMatch[2]}`;
        }
      }

      const fileSizeMatch = mdlsOutput.match(/kMDItemFSSize = (\d+)/);
      const contentTypeMatch = mdlsOutput.match(/kMDItemContentType = "([^"]+)"/);
      const creationDateMatch = mdlsOutput.match(/kMDItemFSCreationDate = ([^\n]+)/);

      return {
        success: true,
        path: imagePath,
        dimensions,
        file_size: fileSizeMatch ? `${(parseInt(fileSizeMatch[1]) / 1024 / 1024).toFixed(2)} MB` : "Unknown",
        content_type: contentTypeMatch ? contentTypeMatch[1] : "Unknown",
        created: creationDateMatch ? creationDateMatch[1] : "Unknown",
        message: `Image analysis complete: ${dimensions}, ${fileSizeMatch ? (parseInt(fileSizeMatch[1]) / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown size'}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to analyze image: ${error.message}`
      };
    }
  },
});

// Code runner tool
const runCodeTool = defineTool("run_code", {
  description: "Execute Python or JavaScript code. Use with caution and only run trusted code.",
  parameters: {
    type: "object",
    properties: {
      language: {
        type: "string",
        enum: ["python", "javascript"],
        description: "Programming language to execute",
      },
      code: {
        type: "string",
        description: "The code to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds (default: 30)",
      },
    },
    required: ["language", "code"],
  },
  handler: async ({ language, code, timeout = 30 }: { language: "python" | "javascript"; code: string; timeout?: number }) => {
    const maxTimeout = Math.min(timeout, 60); // Cap at 60 seconds
    const ext = language === "python" ? ".py" : ".js";
    const tmpFile = join(tmpdir(), `copilot-bar-code-${Date.now()}${ext}`);
    try {
      await writeFileAsync(tmpFile, code, "utf-8");
      const cmd = language === "python" ? "python3" : "node";
      const { stdout, stderr } = await execFileAsync(cmd, [tmpFile], { timeout: maxTimeout * 1000 });
      return {
        success: true,
        language,
        output: stdout || "(no output)",
        error: stderr || null,
        message: stderr ? `Execution completed with warnings` : `Execution successful`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Execution failed: ${error.message}`,
        output: error.stdout || "",
        stderr: error.stderr || ""
      };
    } finally {
      try { await unlinkAsync(tmpFile); } catch {}
    }
  },
});

export const webTools = [
  summarizeUrlTool,
  getWeatherTool,
  analyzeImageTool,
  runCodeTool,
];
