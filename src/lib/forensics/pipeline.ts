import { analyzeExif } from "./exifAnalyzer";
import { analyzeFile } from "./fileAnalyzer";
import { analyzeManipulation } from "./manipulationAnalyzer";
import { analyzeProvenance } from "./provenanceAnalyzer";
import { analyzeSocialMedia } from "./socialMediaAnalyzer";
import { detectAi, identifyGenerator, scanAiSignals, type ContentModelResult } from "./aiDetectionService";
import { detectMediaContent } from "@/lib/detect.functions";
import { buildEvidence, buildTimeline, buildVerdict } from "./evidence";
import type { ForensicReport, StepState } from "./types";

export const PIPELINE_STEPS: Array<{ id: string; label: string }> = [
  { id: "read", label: "Reading file" },
  { id: "metadata", label: "Extracting metadata" },
  { id: "provenance", label: "Checking provenance" },
  { id: "ai", label: "Checking AI-generation indicators" },
  { id: "manipulation", label: "Checking manipulation indicators" },
  { id: "social", label: "Checking social-media processing" },
  { id: "report", label: "Generating forensic report" },
];

export function initialSteps(): StepState[] {
  return PIPELINE_STEPS.map((s) => ({ ...s, status: "pending" }));
}

type Progress = (stepId: string) => void;

const tick = () => new Promise((r) => setTimeout(r, 0));

const VISION_LIMIT = 20 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Perceptual analysis of the media content, run on the server. */
async function analyzeContent(
  bytes: Uint8Array,
  mimeType: string,
  kind: string,
): Promise<ContentModelResult | null> {
  if (kind !== "image" && kind !== "video" && kind !== "audio") return null;
  if (bytes.byteLength > VISION_LIMIT) {
    return {
      status: "unavailable",
      provider: "Lovable AI content analysis",
      probability: null,
      confidence: null,
      deepfakeProbability: null,
      likelyGenerator: null,
      reasons: [],
      message:
        "Content analysis skipped — this file is larger than the 20 MB limit for perceptual analysis.",
    };
  }
  try {
    return (await detectMediaContent({
      data: { base64: toBase64(bytes), mimeType, mediaKind: kind },
    })) as ContentModelResult;
  } catch (error) {
    return {
      status: "error",
      provider: "Lovable AI content analysis",
      probability: null,
      confidence: null,
      deepfakeProbability: null,
      likelyGenerator: null,
      reasons: [],
      message: `Content analysis unavailable. ${(error as Error).message}`,
    };
  }
}

export async function runForensicPipeline(file: File, onStep: Progress): Promise<ForensicReport> {
  onStep("read");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fileInfo = await analyzeFile(file, buffer);

  onStep("metadata");
  await tick();
  const metadata = await analyzeExif(file, fileInfo.kind);

  onStep("provenance");
  await tick();
  const provenance = analyzeProvenance(bytes);

  onStep("ai");
  await tick();
  const scan = scanAiSignals(bytes);
  const content = await analyzeContent(bytes, file.type, fileInfo.kind);
  const aiDetection = await detectAi(file, scan, provenance, metadata, content);
  const possibleGenerator = identifyGenerator(scan, provenance, metadata);

  onStep("manipulation");
  await tick();
  const manipulation = analyzeManipulation(bytes, fileInfo, metadata);

  onStep("social");
  await tick();
  const socialMedia = analyzeSocialMedia(bytes, fileInfo, metadata);

  onStep("report");
  await tick();
  const evidence = buildEvidence(
    fileInfo,
    metadata,
    aiDetection,
    possibleGenerator,
    provenance,
    manipulation,
    socialMedia,
  );
  const timeline = buildTimeline(fileInfo, metadata, provenance, manipulation, socialMedia);
  const verdict = buildVerdict(aiDetection, manipulation, metadata, provenance);

  return {
    analyzedAt: new Date().toISOString(),
    isDemo: false,
    file: fileInfo,
    metadata,
    aiDetection,
    possibleGenerator,
    provenance,
    manipulation,
    socialMedia,
    evidence,
    timeline,
    verdict,
    technical: {
      exif: metadata.raw,
      c2paMarkers: provenance.markers,
      aiSignals: scan,
      containerBrands: fileInfo.containerBrands,
      sha256: fileInfo.sha256,
      detectionService: {
        name: aiDetection.serviceName,
        configured: aiDetection.serviceConfigured,
      },
    },
  };
}
