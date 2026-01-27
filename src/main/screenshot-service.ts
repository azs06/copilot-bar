import { desktopCapturer, screen, clipboard, nativeImage } from "electron";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import "dotenv/config";

// S3 client configuration from environment variables
const s3Config = {
  endpoint: process.env.S3_ENDPOINT,
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION || "auto",
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  publicUrl: process.env.S3_PUBLIC_URL, // Required for R2 - the public bucket URL
};

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (!s3Config.endpoint || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.bucket) {
    console.warn("S3 not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY in .env");
    return null;
  }

  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: s3Config.endpoint,
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
    });
  }

  return s3Client;
}

export async function captureScreenshot(): Promise<Buffer> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });

  if (sources.length === 0) {
    throw new Error("No screen sources available");
  }

  // Get the primary screen
  const primarySource = sources[0];
  const thumbnail = primarySource.thumbnail;

  // Convert to PNG buffer
  return thumbnail.toPNG();
}

export async function uploadScreenshot(buffer: Buffer): Promise<string> {
  const client = getS3Client();

  if (!client) {
    throw new Error("S3 not configured. Please set environment variables in .env file.");
  }

  const filename = `screenshots/${randomUUID()}.png`;

  // Note: No ACL parameter - R2 and some S3-compatible services don't support it
  // For R2, enable public access via Cloudflare dashboard and set S3_PUBLIC_URL
  const command = new PutObjectCommand({
    Bucket: s3Config.bucket,
    Key: filename,
    Body: buffer,
    ContentType: "image/png",
  });

  await client.send(command);

  // Generate public URL
  // For R2: Use the public bucket URL (custom domain or r2.dev subdomain)
  // For S3: Use the bucket URL or CloudFront distribution
  if (!s3Config.publicUrl) {
    throw new Error("S3_PUBLIC_URL not set. Please configure the public URL for your bucket.");
  }

  const url = `${s3Config.publicUrl.replace(/\/$/, "")}/${filename}`;

  return url;
}

// Save screenshot locally and copy to clipboard
export async function saveScreenshotLocally(buffer: Buffer): Promise<string> {
  const screenshotsDir = join(homedir(), "Pictures", "Copilot-Bar-Screenshots");

  if (!existsSync(screenshotsDir)) {
    mkdirSync(screenshotsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `screenshot-${timestamp}.png`;
  const filepath = join(screenshotsDir, filename);

  writeFileSync(filepath, buffer);

  // Also copy to clipboard
  const image = nativeImage.createFromBuffer(buffer);
  clipboard.writeImage(image);

  return filepath;
}

export async function captureAndUpload(): Promise<{ success: boolean; url?: string; path?: string; copied?: boolean; error?: string }> {
  try {
    const buffer = await captureScreenshot();

    // If S3 is configured, upload and return URL
    if (isS3Configured()) {
      const url = await uploadScreenshot(buffer);
      return { success: true, url };
    }

    // Otherwise, save locally and copy to clipboard
    const filepath = await saveScreenshotLocally(buffer);
    return {
      success: true,
      path: filepath,
      copied: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Screenshot capture error:", message);
    return { success: false, error: message };
  }
}

export function isS3Configured(): boolean {
  return !!(s3Config.endpoint && s3Config.accessKeyId && s3Config.secretAccessKey && s3Config.bucket && s3Config.publicUrl);
}
