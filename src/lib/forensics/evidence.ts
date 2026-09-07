import type {
  AiDetectionResult,
  EvidenceGroup,
  GeneratorResult,
  ManipulationResult,
  MetadataResult,
  ProvenanceResult,
  SocialMediaResult,
  TimelineEvent,
  Verdict,
  FileInfo,
} from "./types";

export function buildEvidence(
  file: FileInfo,
  metadata: MetadataResult,
  ai: AiDetectionResult,
  generator: GeneratorResult,
  provenance: ProvenanceResult,
  manipulation: ManipulationResult,
  social: SocialMediaResult,
): EvidenceGroup[] {
  return [
    {
      category: "Metadata Evidence",
      items: [
        metadata.device.identified
          ? {
              status: "positive" as const,
              title: "Camera make/model found",
              explanation: `${metadata.device.model ?? metadata.device.manufacturer} recorded in EXIF tags.`,
              confidence: 95,
              source: "EXIF / TIFF tags",
              certainty: "confirmed" as const,
            }
          : {
              status: "warning" as const,
              title: "No camera model in metadata",
              explanation: "The file carries no camera make/model tags. Device cannot be identified.",
              confidence: null,
              source: "EXIF / TIFF tags",
              certainty: "unknown" as const,
            },
        metadata.capture.dateTimeOriginal
          ? {
              status: "positive" as const,
              title: "Capture timestamp found",
              explanation: metadata.capture.dateTimeOriginal,
              confidence: 95,
              source: "EXIF DateTimeOriginal",
              certainty: "confirmed" as const,
            }
          : {
              status: "warning" as const,
              title: "No capture timestamp",
              explanation: "No original date/time tag is present in the file.",
              confidence: null,
              source: "EXIF DateTimeOriginal",
              certainty: "unknown" as const,
            },
        metadata.capture.gps
          ? {
              status: "positive" as const,
              title: "GPS coordinates present",
              explanation: `${metadata.capture.gps.lat.toFixed(5)}, ${metadata.capture.gps.lon.toFixed(5)}`,
              confidence: 90,
              source: "EXIF GPS IFD",
              certainty: "confirmed" as const,
            }
          : {
              status: "neutral" as const,
              title: "No location data",
              explanation: "No GPS tags are present. Capture location cannot be determined.",
              confidence: null,
              source: "EXIF GPS IFD",
              certainty: "unknown" as const,
            },
      ],
    },
    {
      category: "AI Evidence",
      items: [
        {
          status:
            ai.state === "generated" ? "negative" : ai.state === "authentic" ? "positive" : "warning",
          title:
            ai.state === "generated"
              ? "AI-generation indicators found"
              : ai.state === "authentic"
                ? "No strong AI indicators"
                : "AI detection inconclusive",
          explanation: ai.message,
          confidence: ai.confidence,
          source: ai.serviceName,
          certainty: ai.state === "inconclusive" ? "unknown" : "inferred",
        },
        generator.determined
          ? {
              status: "warning" as const,
              title: `Possible generator: ${generator.generator}`,
              explanation: generator.evidence.join("; "),
              confidence: generator.confidence,
              source: "Embedded generator signatures",
              certainty: "inferred" as const,
            }
          : {
              status: "warning" as const,
              title: "AI source unavailable",
              explanation: "No evidence in the file points to a specific generator.",
              confidence: null,
              source: "Embedded generator signatures",
              certainty: "unknown" as const,
            },
      ],
    },
    {
      category: "Provenance Evidence",
      items: [
        {
          status: provenance.state === "not_found" ? "neutral" : "warning",
          title:
            provenance.state === "not_found"
              ? "No Content Credentials"
              : "Content Credentials found (unverified)",
          explanation: provenance.message,
          confidence: provenance.state === "not_found" ? null : 60,
          source: "C2PA / JUMBF structures",
          certainty: provenance.state === "not_found" ? "unknown" : "inferred",
        },
      ],
    },
    {
      category: "Manipulation Evidence",
      items:
        manipulation.evidence.length > 0
          ? manipulation.evidence.map((e) => ({
              status: "warning" as const,
              title: "Manipulation indicator",
              explanation: e,
              confidence: manipulation.confidence,
              source: "Structural / metadata analysis",
              certainty: "inferred" as const,
            }))
          : [
              {
                status: "positive" as const,
                title: "No strong manipulation indicators",
                explanation: manipulation.message,
                confidence: manipulation.confidence,
                source: "Structural / metadata analysis",
                certainty: "inferred" as const,
              },
            ],
    },
    {
      category: "Social Media Evidence",
      items:
        social.indicators.length > 0
          ? social.indicators.map((e) => ({
              status: "warning" as const,
              title: social.platform ? `Possible ${social.platform} processing` : "Possible recompression",
              explanation: e,
              confidence: social.confidence,
              source: "Platform signature analysis",
              certainty: "inferred" as const,
            }))
          : [
              {
                status: "neutral" as const,
                title: "No platform indicators",
                explanation: "Social-media origin could not be determined.",
                confidence: null,
                source: "Platform signature analysis",
                certainty: "unknown" as const,
              },
            ],
    },
    {
      category: "File Evidence",
      items: [
        {
          status: "positive",
          title: "SHA-256 computed",
          explanation: file.sha256,
          confidence: 100,
          source: "WebCrypto digest of the uploaded bytes",
          certainty: "confirmed",
        },
      ],
    },
  ];
}

export function buildTimeline(
  file: FileInfo,
  metadata: MetadataResult,
  provenance: ProvenanceResult,
  manipulation: ManipulationResult,
  social: SocialMediaResult,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const date = (v: string | null) => (v ? v.slice(0, 19).replace("T", " ") : null);

  if (metadata.capture.dateTimeOriginal) {
    events.push({
      date: date(metadata.capture.dateTimeOriginal),
      title: "Captured",
      detail: metadata.device.model
        ? `Recorded on ${metadata.device.model}`
        : "Original capture timestamp recorded in metadata",
      certainty: "confirmed",
    });
  }

  if (provenance.state !== "not_found") {
    events.push({
      date: null,
      title: "Content Credentials attached",
      detail: provenance.application
        ? `Manifest references ${provenance.application}`
        : "C2PA manifest structures present (signature not verified)",
      certainty: "inferred",
    });
  }

  const software = metadata.device.software;
  if (software) {
    events.push({
      date: date(metadata.raw?.["ModifyDate"] ? String(metadata.raw["ModifyDate"]) : null),
      title: "Processed / exported",
      detail: `Software tag: ${software}`,
      certainty: "confirmed",
    });
  }

  if (manipulation.evidence.some((e) => e.toLowerCase().includes("re-encod"))) {
    events.push({
      date: null,
      title: "Re-encoded",
      detail: "Container/compression structure indicates the file was re-saved after its original encode.",
      certainty: "inferred",
    });
  }

  if (!metadata.available && file.kind === "image") {
    events.push({
      date: null,
      title: "Metadata removed",
      detail: "No EXIF block is present — metadata was stripped by an editor, export or platform.",
      certainty: "inferred",
    });
  }

  if (social.platform) {
    events.push({
      date: null,
      title: "Distributed",
      detail: `Possible ${social.platform} processing detected.`,
      certainty: "inferred",
    });
  }

  if (file.lastModified) {
    events.push({
      date: date(file.lastModified),
      title: "Filesystem timestamp",
      detail: "Last-modified time reported by the uploading device's filesystem.",
      certainty: "confirmed",
    });
  }

  return events;
}

export function buildVerdict(
  ai: AiDetectionResult,
  manipulation: ManipulationResult,
  metadata: MetadataResult,
  provenance: ProvenanceResult,
): Verdict {
  if (ai.state === "generated") {
    return {
      kind: "LIKELY_AI_GENERATED",
      label: "Likely AI Generated",
      confidence: ai.confidence ?? 70,
      explanation:
        (ai.serviceConfigured
          ? "Analysis of the media content found indicators of AI generation"
          : "The file carries embedded indicators of AI generation") +
        (provenance.aiIndicated ? ", including Content Credentials declaring generative media" : "") +
        ". This is an evidence-based indication; complete certainty is not possible.",
    };
  }

  if (manipulation.risk === "HIGH") {
    return {
      kind: "LIKELY_MANIPULATED",
      label: "Likely Manipulated",
      confidence: manipulation.confidence ?? 65,
      explanation:
        "Several structural and metadata inconsistencies indicate the file was edited or re-encoded after its original creation. The nature of the edit cannot be determined from structure alone.",
    };
  }

  if (ai.state === "authentic" && manipulation.risk === "LOW") {
    return {
      kind: "LIKELY_AUTHENTIC",
      label: "Likely Authentic",
      confidence: Math.min(94, Math.round(((ai.confidence ?? 70) + (manipulation.confidence ?? 60)) / 2) + 10),
      explanation:
        "The file contains camera metadata consistent with an original capture and no strong AI-generation indicators were detected. However, complete authenticity cannot be guaranteed.",
    };
  }

  return {
    kind: "INCONCLUSIVE",
    label: "Suspicious / Inconclusive",
    confidence: 50,
    explanation: metadata.available
      ? "The available evidence is mixed or incomplete. Some signals are missing, so no confident conclusion can be drawn."
      : "The file carries no usable metadata or provenance, and no external AI-detection model is configured. There is not enough evidence to determine how this media was created.",
  };
}
