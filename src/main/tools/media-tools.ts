import { defineTool } from "@github/copilot-sdk";
import { runAppleScript, execFileAsync } from "./helpers.js";

function musicAppName(app: "spotify" | "music"): string {
  return app === "spotify" ? "Spotify" : "Music";
}

const playMusicTool = defineTool("play_music", {
  description: "Play music in Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to control: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      await runAppleScript(`tell application "${musicAppName(app)}" to play`);
      return { success: true, app, action: "play", message: `Started playing in ${musicAppName(app)}` };
    } catch (error: any) {
      return { success: false, error: `Failed to play music: ${error.message}` };
    }
  },
});

const pauseMusicTool = defineTool("pause_music", {
  description: "Pause music in Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to control: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      await runAppleScript(`tell application "${musicAppName(app)}" to pause`);
      return { success: true, app, action: "pause", message: `Paused ${musicAppName(app)}` };
    } catch (error: any) {
      return { success: false, error: `Failed to pause music: ${error.message}` };
    }
  },
});

const nextTrackTool = defineTool("next_track", {
  description: "Skip to the next track in Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to control: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      await runAppleScript(`tell application "${musicAppName(app)}" to next track`);
      return { success: true, app, action: "next", message: `Skipped to next track in ${musicAppName(app)}` };
    } catch (error: any) {
      return { success: false, error: `Failed to skip track: ${error.message}` };
    }
  },
});

const previousTrackTool = defineTool("previous_track", {
  description: "Go to the previous track in Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to control: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      await runAppleScript(`tell application "${musicAppName(app)}" to previous track`);
      return { success: true, app, action: "previous", message: `Went to previous track in ${musicAppName(app)}` };
    } catch (error: any) {
      return { success: false, error: `Failed to go to previous track: ${error.message}` };
    }
  },
});

const getMusicStatusTool = defineTool("get_music_status", {
  description: "Get current playback status from Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to check: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      const appName = musicAppName(app);
      const stdout = await runAppleScript(`tell application "${appName}"
        if player state is playing then
          return "Playing: " & name of current track & " by " & artist of current track
        else
          return "Paused: " & name of current track & " by " & artist of current track
        end if
      end tell`);
      return { success: true, app, status: stdout, message: stdout };
    } catch (error: any) {
      return { success: false, error: `Failed to get music status: ${error.message}` };
    }
  },
});

// Voice input tool (speech to text simulation)
const speechToTextTool = defineTool("speech_to_text", {
  description: "Activate macOS dictation/speech recognition to convert speech to text. Note: This opens the dictation interface.",
  parameters: {
    type: "object",
    properties: {
      duration: {
        type: "number",
        description: "Duration in seconds to listen for (default: 10)",
      },
    },
  },
  handler: async ({ duration = 10 }: { duration?: number }) => {
    try {
      await runAppleScript('tell application "System Events" to key code 63 using {fn down}', 5000);
      return {
        success: true,
        message: `Speech recognition activated. Please speak for up to ${duration} seconds. Note: You'll need to manually stop dictation when done.`,
        note: "This opens macOS dictation. The actual transcription happens in the active text field."
      };
    } catch (error: any) {
      return {
        success: false,
        message: "Failed to activate speech dictation. You may need to press Fn twice manually.",
        note: "macOS dictation must be enabled in System Preferences > Keyboard > Dictation",
        error: error.message
      };
    }
  },
});

// Text-to-speech tool
const speakTextTool = defineTool("speak_text", {
  description: "Convert text to speech using macOS say command.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to speak aloud",
      },
      voice: {
        type: "string",
        description: "Voice to use (e.g., 'Alex', 'Samantha', 'Victoria'). Default: system default",
      },
      rate: {
        type: "number",
        description: "Speech rate (words per minute). Default: 175",
      },
    },
    required: ["text"],
  },
  handler: async ({ text, voice, rate = 175 }: { text: string; voice?: string; rate?: number }) => {
    try {
      const args = [text, "-r", String(rate)];
      if (voice) {
        args.push("-v", voice);
      }
      execFileAsync("say", args).catch((err) => {
        console.error("TTS error:", err.message);
      });

      return {
        success: true,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        voice: voice || "default",
        rate,
        message: `Speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`
      };
    } catch (error: any) {
      return { success: false, error: `Failed to speak text: ${error.message}` };
    }
  },
});

export const mediaTools = [
  playMusicTool,
  pauseMusicTool,
  nextTrackTool,
  previousTrackTool,
  getMusicStatusTool,
  speechToTextTool,
  speakTextTool,
];
