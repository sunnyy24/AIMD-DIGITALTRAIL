// Client-callable bridge to the server-side perceptual AI detector.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MediaKind } from "@/lib/providers/types";

const inputSchema = z.object({
  base64: z.string().min(1),
  mimeType: z.string().default(""),
  mediaKind: z.enum(["image", "video", "audio", "unknown"]),
});

export interface ContentDetectionResult {
  status: "ok" | "unavailable" | "error";
  provider: string;
  probability: number | null;
  confidence: number | null;
  deepfakeProbability: number | null;
  likelyGenerator: string | null;
  reasons: string[];
  message: string;
}

export const detectMediaContent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<ContentDetectionResult> => {
    const { detectWithVision } = await import("@/lib/providers/visionDetect.server");
    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const outcome = await detectWithVision(bytes, data.mimeType, data.mediaKind as MediaKind);
    const raw = (outcome.raw ?? {}) as { confidence?: number | null; reasons?: string[] };
    return {
      status: outcome.status,
      provider: outcome.provider,
      probability: outcome.aiGeneratedScore,
      confidence: typeof raw.confidence === "number" ? raw.confidence : null,
      deepfakeProbability: outcome.deepfakeScore,
      likelyGenerator: outcome.sourceName,
      reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
      message: outcome.message,
    };
  });
