// Perceptual AI-generation detector backed by the Lovable AI gateway.
// Server-only. Used for images, video and audio when no dedicated forensic
// detection vendor (e.g. Hive) is configured. It analyses the actual media
// content, never file metadata alone, and reports "unavailable" on failure
// instead of fabricating a score.

import type { DetectionOutcome, MediaKind } from "./types";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";
/** Base64 inlining limit — larger media is rejected truthfully. */
export const VISION_MAX_BYTES = 20 * 1024 * 1024;

const SYSTEM_PROMPT = `You are a media forensics analyst. You examine the actual content of an image, video or audio clip and estimate how likely it was produced or substantially altered by a generative AI model.

Look for: rendering and texture artifacts, impossible physics or lighting, morphing of faces/hands/text, temporal inconsistency between frames, over-smooth or "plastic" surfaces, unnatural prosody or spectral flatness in audio, and any visible generator watermark or logo.

Rules:
- Base every statement on what you actually observe in the media.
- Never invent metadata, camera models, provenance or file details.
- If the media is too short, low quality or ambiguous, say so and lower confidence.
Respond with STRICT JSON only:
{"ai_probability": 0-100, "confidence": 0-100, "deepfake_probability": 0-100 or null, "likely_generator": string or null, "reasons": [string, ...]}`;

function unavailable(mediaType: MediaKind, message: string, status: "unavailable" | "error" = "unavailable"): DetectionOutcome {
  return {
    provider: "Lovable AI content analysis",
    status,
    mediaType,
    aiGeneratedScore: null,
    notAiGeneratedScore: null,
    deepfakeScore: null,
    sourceName: null,
    sourceConfidence: null,
    message,
    segments: [],
    raw: null,
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function contentBlock(mediaType: MediaKind, mimeType: string, base64: string) {
  if (mediaType === "video") {
    return { type: "video_url", video_url: { url: `data:${mimeType || "video/mp4"};base64,${base64}` } };
  }
  if (mediaType === "audio") {
    const format = (mimeType.split("/")[1] ?? "mp3").replace("mpeg", "mp3").replace("x-", "");
    return { type: "input_audio", input_audio: { data: base64, format } };
  }
  return { type: "image_url", image_url: { url: `data:${mimeType || "image/jpeg"};base64,${base64}` } };
}

function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clampPct(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

export function isVisionDetectionConfigured(): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"]);
}

export async function detectWithVision(
  bytes: Uint8Array,
  mimeType: string,
  mediaType: MediaKind,
): Promise<DetectionOutcome> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    return unavailable(mediaType, "Content analysis unavailable — the AI gateway is not configured.");
  }
  if (mediaType === "unknown") {
    return unavailable(mediaType, "Content analysis unavailable — unsupported media type.");
  }
  if (bytes.byteLength > VISION_MAX_BYTES) {
    return unavailable(
      mediaType,
      `Content analysis skipped — file exceeds the ${Math.round(VISION_MAX_BYTES / (1024 * 1024))} MB limit for perceptual analysis.`,
    );
  }

  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Analyse this ${mediaType} and return the JSON verdict.` },
              contentBlock(mediaType, mimeType, toBase64(bytes)),
            ],
          },
        ],
      }),
    });

    if (response.status === 429) {
      return unavailable(mediaType, "Content analysis temporarily rate limited. Please try again shortly.", "error");
    }
    if (response.status === 402) {
      return unavailable(mediaType, "Content analysis unavailable — AI credits are exhausted for this workspace.", "error");
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return unavailable(mediaType, `Content analysis failed (${response.status}). ${text.slice(0, 180)}`, "error");
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseJson(content);
    if (!parsed) {
      return unavailable(mediaType, "Content analysis returned an unreadable response.", "error");
    }

    const ai = clampPct(parsed["ai_probability"]);
    const confidence = clampPct(parsed["confidence"]);
    const deepfake = clampPct(parsed["deepfake_probability"]);
    const generator =
      typeof parsed["likely_generator"] === "string" && parsed["likely_generator"].trim()
        ? (parsed["likely_generator"] as string)
        : null;
    const reasons = Array.isArray(parsed["reasons"])
      ? (parsed["reasons"] as unknown[]).filter((r): r is string => typeof r === "string")
      : [];

    if (ai === null) {
      return unavailable(mediaType, "Content analysis did not return a usable score.", "error");
    }

    return {
      provider: "Lovable AI content analysis",
      status: "ok",
      mediaType,
      aiGeneratedScore: ai,
      notAiGeneratedScore: 100 - ai,
      deepfakeScore: deepfake,
      sourceName: generator,
      sourceConfidence: generator ? confidence : null,
      message:
        reasons.length > 0
          ? reasons.join(" · ")
          : "Perceptual analysis completed on the media content.",
      segments: [],
      raw: { ai_probability: ai, confidence, deepfake_probability: deepfake, likely_generator: generator, reasons },
    };
  } catch (error) {
    return unavailable(mediaType, `Content analysis failed. ${(error as Error).message}`, "error");
  }
}
