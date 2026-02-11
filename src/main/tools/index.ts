import { audioVisualTools } from "./audio-visual-tools.js";
import { systemTools } from "./system-tools.js";
import { connectivityTools } from "./connectivity-tools.js";
import { windowTools } from "./window-tools.js";
import { dataTools } from "./data-tools.js";
import { mediaTools } from "./media-tools.js";
import { webTools } from "./web-tools.js";
import { widgetTools } from "./widget-tools.js";
import { documentTools } from "./document-tools.js";
import { chartTools } from "./chart-tools.js";

export const allTools = [
  ...audioVisualTools,
  ...systemTools,
  ...connectivityTools,
  ...windowTools,
  ...dataTools,
  ...mediaTools,
  ...webTools,
  ...widgetTools,
  ...documentTools,
  ...chartTools,
];
