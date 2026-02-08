import { defineTool } from "@github/copilot-sdk";
import { parseDataFile, analyzeData } from "../data-parsing-service.js";

// Chart color palette - works for both dark and light themes
const CHART_COLORS = [
  "rgba(0, 102, 255, 0.8)",   // Primary blue
  "rgba(255, 99, 132, 0.8)",  // Pink
  "rgba(75, 192, 192, 0.8)",  // Teal
  "rgba(255, 159, 64, 0.8)",  // Orange
  "rgba(153, 102, 255, 0.8)", // Purple
  "rgba(255, 205, 86, 0.8)",  // Yellow
  "rgba(54, 162, 235, 0.8)",  // Light blue
  "rgba(255, 99, 255, 0.8)",  // Magenta
  "rgba(99, 255, 132, 0.8)",  // Green
  "rgba(255, 159, 159, 0.8)", // Light red
];

/**
 * Analyze an attached data file (CSV or Excel) and return column information
 * to help the AI understand the data structure for chart generation.
 */
const analyzeDataFileTool = defineTool("analyze_data_file", {
  description: "Analyze a CSV or Excel data file that was attached to the conversation. Returns column names, types, statistics, and suggested chart types. Use this BEFORE generating charts to understand the data structure.",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the data file to analyze",
      },
    },
    required: ["file_path"],
  },
  handler: async ({ file_path }: { file_path: string }) => {
    const parseResult = await parseDataFile(file_path);

    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        error: parseResult.error || "Failed to parse data file",
      };
    }

    const analysis = analyzeData(parseResult.data);

    return {
      success: true,
      rowCount: analysis.rowCount,
      columnCount: analysis.columnCount,
      columns: analysis.columns.map(col => ({
        name: col.name,
        type: col.type,
        uniqueCount: col.uniqueCount,
        nullCount: col.nullCount,
        sampleValues: col.sampleValues,
        ...(col.numericStats && { numericStats: col.numericStats }),
      })),
      suggestedChartTypes: analysis.suggestedChartTypes,
      preview: parseResult.data.rows.slice(0, 5),
    };
  },
});

/**
 * Render a chart visualization from data. This creates an interactive
 * chart widget in the chat.
 */
const renderChartTool = defineTool("render_chart", {
  description: "Render a chart visualization (bar, pie, line, doughnut, horizontal bar, scatter, or table) from data. Use this AFTER analyzing the data file. The chart will appear as an interactive widget in the chat. For scatter plots, provide xData and yData instead of labels.",
  parameters: {
    type: "object",
    properties: {
      chart_type: {
        type: "string",
        enum: ["bar", "horizontalBar", "pie", "doughnut", "line", "scatter", "table"],
        description: "Type of chart to render",
      },
      title: {
        type: "string",
        description: "Title for the chart",
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "Labels for the X-axis (not needed for scatter plots)",
      },
      datasets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Dataset label for legend" },
            data: {
              type: "array",
              items: { type: "number" },
              description: "Data values",
            },
            backgroundColor: {
              type: "string",
              description: "Background color (optional, auto-assigned if not provided)",
            },
          },
          required: ["label", "data"],
        },
        description: "One or more datasets to display. Each dataset has a label and array of numbers.",
      },
      x_data: {
        type: "array",
        items: { type: "number" },
        description: "X-axis data for scatter plots",
      },
      y_data: {
        type: "array",
        items: { type: "number" },
        description: "Y-axis data for scatter plots",
      },
      x_label: {
        type: "string",
        description: "X-axis label (optional)",
      },
      y_label: {
        type: "string",
        description: "Y-axis label (optional)",
      },
    },
    required: ["chart_type", "title"],
  },
  handler: async (params: {
    chart_type: "bar" | "horizontalBar" | "pie" | "doughnut" | "line" | "scatter" | "table";
    title: string;
    labels?: string[];
    datasets?: Array<{ label: string; data: number[]; backgroundColor?: string }>;
    x_data?: number[];
    y_data?: number[];
    x_label?: string;
    y_label?: string;
  }) => {
    const { chart_type, title, labels, datasets, x_data, y_data, x_label, y_label } = params;

    // Handle scatter plot data format
    if (chart_type === "scatter") {
      if (!x_data || !y_data || x_data.length !== y_data.length) {
        return {
          success: false,
          error: "Scatter plots require x_data and y_data arrays of equal length",
        };
      }

      return {
        widget: "chart",
        chartType: "scatter",
        chartTitle: title,
        xLabel: x_label,
        yLabel: y_label,
        scatterData: x_data.map((x, i) => ({ x, y: y_data[i] })),
        message: `Rendering scatter plot: ${title}`,
      };
    }

    // Handle table format (fallback)
    if (chart_type === "table") {
      if (!labels || !datasets || datasets.length === 0) {
        return {
          success: false,
          error: "Table requires labels and datasets",
        };
      }

      return {
        widget: "chart",
        chartType: "table",
        chartTitle: title,
        chartLabels: labels,
        chartDatasets: datasets,
        message: `Rendering data table: ${title}`,
      };
    }

    // Validate chart data
    if (!labels || !datasets || datasets.length === 0) {
      return {
        success: false,
        error: "Chart requires labels and at least one dataset",
      };
    }

    // Validate data lengths
    for (const dataset of datasets) {
      if (dataset.data.length !== labels.length) {
        return {
          success: false,
          error: `Dataset "${dataset.label}" has ${dataset.data.length} values but there are ${labels.length} labels`,
        };
      }
    }

    // Assign colors to datasets if not provided
    const coloredDatasets = datasets.map((ds, index) => ({
      ...ds,
      backgroundColor: ds.backgroundColor || (chart_type === "pie" || chart_type === "doughnut"
        ? labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
        : CHART_COLORS[index % CHART_COLORS.length]),
    }));

    return {
      widget: "chart",
      chartType: chart_type,
      chartTitle: title,
      chartLabels: labels,
      chartDatasets: coloredDatasets,
      xLabel: x_label,
      yLabel: y_label,
      message: `Rendering ${chart_type} chart: ${title}`,
    };
  },
});

export const chartTools = [
  analyzeDataFileTool,
  renderChartTool,
];
