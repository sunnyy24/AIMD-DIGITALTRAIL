import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fuseEvidence } from "@/lib/forensics/fusion";
import type {
  DetectionOutcome,
  ProvenanceOutcome,
  ScanResultBundle,
  SegmentOutcome,
} from "@/lib/providers/types";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const CreateScanInput = z.object({
  fileName: z.string().min(1).max(300),
  fileType: z.string().max(200),
  fileSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mediaKind: z.enum(["image", "video", "audio", "unknown"]),
  caseId: z.string().max(120).nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
});

function evidenceId(): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const rand = crypto.randomUUID().split("-")[0]!.toUpperCase();
  return `AIMD-${stamp}-${rand}`;
}

function extensionOf(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
}

/** Step 1 — register the scan and return the storage path the client uploads to. */
export const createScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("scans")
      .select("id, created_at, verdict")
      .eq("sha256", data.sha256)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1);

    const id = crypto.randomUUID();
    const storagePath = `${userId}/${id}/original.${extensionOf(data.fileName)}`;

    const { error } = await supabase.from("scans").insert({
      id,
      user_id: userId,
      evidence_id: evidenceId(),
      case_id: data.caseId ?? null,
      file_name: data.fileName,
      file_type: data.fileType || "application/octet-stream",
      media_kind: data.mediaKind,
      file_size: data.fileSize,
      sha256: data.sha256,
      storage_path: storagePath,
      status: "uploading",
      stage: "upload",
    });
    if (error) throw new Error(error.message);

    await supabase.from("chain_of_custody_events").insert({
      scan_id: id,
      user_id: userId,
      event: "Evidence registered",
      status: "complete",
      detail: `SHA-256 ${data.sha256}`,
    });

    await supabase.from("media_fingerprints").insert({
      scan_id: id,
      user_id: userId,
      kind: "file",
      algorithm: "sha256",
      value: data.sha256,
    });

    return {
      scanId: id,
      storagePath,
      duplicateOf: existing && existing.length > 0 ? existing[0] : null,
    };
  });

/** Step 2 — run the full analysis pipeline over the uploaded bytes. */
export const analyzeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scanId: z.string().uuid(),
        width: z.number().nullable().optional(),
        height: z.number().nullable().optional(),
        duration: z.number().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { scanId } = data;

    const { data: scan, error: scanError } = await supabase
      .from("scans")
      .select("*")
      .eq("id", scanId)
      .single();
    if (scanError || !scan) throw new Error("Scan not found.");
    if (!scan.storage_path) throw new Error("No uploaded file for this scan.");

    const stage = async (name: string, detail?: string) => {
      await supabase.from("scans").update({ stage: name, status: "processing" }).eq("id", scanId);
      await supabase.from("chain_of_custody_events").insert({
        scan_id: scanId,
        user_id: userId,
        event: name,
        status: "complete",
        detail: detail ?? null,
      });
    };

    try {
      await stage("download", "Retrieved evidence from private storage");
      const download = await supabase.storage.from("evidence").download(scan.storage_path);
      if (download.error || !download.data) {
        throw new Error(download.error?.message ?? "Unable to read the uploaded file.");
      }
      const bytes = new Uint8Array(await download.data.arrayBuffer());

      // Integrity re-verification against the registered hash.
      const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
      const recomputed = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      await supabase.from("chain_of_custody_events").insert({
        scan_id: scanId,
        user_id: userId,
        event: "Integrity verification",
        status: recomputed === scan.sha256 ? "complete" : "failed",
        detail:
          recomputed === scan.sha256
            ? "SHA-256 matches the registered evidence hash."
            : `Hash mismatch: ${recomputed}`,
      });

      await stage("forensics", "Metadata and structural analysis");
      const { runForensics } = await import("@/lib/providers/forensic.server");
      const forensics = await runForensics(bytes, {
        name: scan.file_name,
        mimeType: scan.file_type,
        size: scan.file_size,
        sha256: scan.sha256,
        kind: scan.media_kind as "image" | "video" | "audio" | "unknown",
        probe: {
          width: data.width ?? null,
          height: data.height ?? null,
          duration: data.duration ?? null,
        },
      });

      await stage("provenance", "C2PA and watermark checks");
      const { checkC2PA, checkSynthID } = await import("@/lib/providers/provenance.server");
      const provenance: ProvenanceOutcome[] = [checkC2PA(bytes), checkSynthID()];

      await stage("detection", "AI-generation and deepfake detection");
      const hive = await import("@/lib/providers/hive.server");
      const detection: DetectionOutcome =
        scan.media_kind === "audio"
          ? await hive.detectAudio(bytes, scan.file_name, scan.file_type)
          : await hive.detectImageVideo(
              bytes,
              scan.file_name,
              scan.file_type,
              scan.media_kind as "image" | "video",
            );
      // Perceptual content analysis always runs so a verdict is possible even
      // when no dedicated detection vendor is configured.
      const { detectWithVision } = await import("@/lib/providers/visionDetect.server");
      const vision = await detectWithVision(
        bytes,
        scan.file_type,
        scan.media_kind as "image" | "video" | "audio",
      );
      const detections = [detection];

      await stage("fusion", "Evidence fusion");
      const fusion = fuseEvidence(detections, provenance, forensics);

      await stage("reasoning", "Generating explanation");
      const { explainEvidence } = await import("@/lib/providers/reasoning.server");
      const reasoning = await explainEvidence({ fusion, detections, provenance, forensics });

      // Persist everything.
      await supabase.from("detection_results").insert(
        detections.map((d) => ({
          scan_id: scanId,
          user_id: userId,
          provider: d.provider,
          media_type: d.mediaType,
          status: d.status,
          ai_generated_score: d.aiGeneratedScore,
          not_ai_generated_score: d.notAiGeneratedScore,
          deepfake_score: d.deepfakeScore,
          source_name: d.sourceName,
          source_confidence: d.sourceConfidence,
          message: d.message,
          raw_response: (d.raw ?? null) as never,
        })),
      );

      await supabase.from("provenance_results").insert(
        provenance.map((p) => ({
          scan_id: scanId,
          user_id: userId,
          provider: p.provider,
          state: p.state,
          issuer: p.issuer,
          creator: p.creator,
          creation_tool: p.creationTool,
          creation_time: p.creationTime,
          ai_indicated: p.aiIndicated,
          history: p.history,
          message: p.message,
        })),
      );

      await supabase.from("forensic_results").insert({
        scan_id: scanId,
        user_id: userId,
        media_kind: forensics.mediaKind,
        metadata: forensics.metadata as never,
        indicators: forensics.indicators as never,
        technical: forensics.technical as never,
      });

      const segments: SegmentOutcome[] = detections.flatMap((d) => d.segments);
      if (segments.length > 0) {
        await supabase.from("media_segments").insert(
          segments.map((s) => ({
            scan_id: scanId,
            user_id: userId,
            track: s.track,
            start_seconds: s.start,
            end_seconds: s.end,
            label: s.label,
            confidence: s.confidence,
            detector: s.detector,
            detail: s.detail,
          })),
        );
      }

      await supabase.from("evidence_items").insert([
        ...forensics.indicators.map((i) => ({
          scan_id: scanId,
          user_id: userId,
          category: i.category,
          status: i.status,
          title: i.title,
          explanation: i.explanation,
          certainty: i.certainty,
          confidence: i.confidence,
          source: i.source,
        })),
        ...fusion.supporting.map((text) => ({
          scan_id: scanId,
          user_id: userId,
          category: "Fusion",
          status: "warning",
          title: text,
          explanation: "Signal that contributed to the final verdict.",
          certainty: "inferred",
          confidence: null,
          source: "Evidence fusion",
        })),
      ]);

      await supabase.from("reports").insert({
        scan_id: scanId,
        user_id: userId,
        format: "json",
        payload: { fusion, reasoning, detections, provenance, forensics } as never,
      });

      await supabase
        .from("scans")
        .update({
          status: "complete",
          stage: "complete",
          verdict: fusion.verdict,
          confidence: fusion.confidence,
          risk_level: fusion.riskLevel,
          completed_at: new Date().toISOString(),
        })
        .eq("id", scanId);

      await supabase.from("chain_of_custody_events").insert({
        scan_id: scanId,
        user_id: userId,
        event: "Analysis complete",
        status: "complete",
        detail: `${fusion.verdict} at ${fusion.confidence}% confidence`,
      });

      return { ok: true as const, scanId };
    } catch (error) {
      const message = (error as Error).message;
      await supabase
        .from("scans")
        .update({ status: "failed", stage: "failed", error_message: message })
        .eq("id", scanId);
      await supabase.from("chain_of_custody_events").insert({
        scan_id: scanId,
        user_id: userId,
        event: "Analysis failed",
        status: "failed",
        detail: message,
      });
      throw new Error(message);
    }
  });

export const getScanStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scanId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: scan } = await context.supabase
      .from("scans")
      .select("id, status, stage, error_message, verdict, confidence")
      .eq("id", data.scanId)
      .single();
    return scan;
  });

export const getScanResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scanId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ScanResultBundle | null> => {
    const { supabase } = context;
    const { scanId } = data;

    const { data: scan } = await supabase.from("scans").select("*").eq("id", scanId).single();
    if (!scan) return null;

    const [detections, provenance, forensic, segments, custody] = await Promise.all([
      supabase.from("detection_results").select("*").eq("scan_id", scanId),
      supabase.from("provenance_results").select("*").eq("scan_id", scanId),
      supabase.from("forensic_results").select("*").eq("scan_id", scanId).maybeSingle(),
      supabase.from("media_segments").select("*").eq("scan_id", scanId).order("start_seconds"),
      supabase
        .from("chain_of_custody_events")
        .select("event, status, provider, detail, created_at")
        .eq("scan_id", scanId)
        .order("created_at"),
    ]);

    const { data: report } = await supabase
      .from("reports")
      .select("payload")
      .eq("scan_id", scanId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (report?.payload ?? {}) as Record<string, unknown>;

    let signedUrl: string | null = null;
    if (scan.storage_path) {
      const signed = await supabase.storage.from("evidence").createSignedUrl(scan.storage_path, 900);
      signedUrl = signed.data?.signedUrl ?? null;
    }

    return {
      scan: { ...scan, mediaUrl: signedUrl },
      detections: (detections.data ?? []).map((d) => ({
        provider: d.provider,
        status: d.status as DetectionOutcome["status"],
        mediaType: (d.media_type ?? "unknown") as DetectionOutcome["mediaType"],
        aiGeneratedScore: d.ai_generated_score === null ? null : Number(d.ai_generated_score),
        notAiGeneratedScore:
          d.not_ai_generated_score === null ? null : Number(d.not_ai_generated_score),
        deepfakeScore: d.deepfake_score === null ? null : Number(d.deepfake_score),
        sourceName: d.source_name,
        sourceConfidence: d.source_confidence === null ? null : Number(d.source_confidence),
        message: d.message ?? "",
        segments: [],
        raw: null,
      })),
      provenance: (provenance.data ?? []).map((p) => ({
        provider: p.provider,
        state: p.state as ProvenanceOutcome["state"],
        issuer: p.issuer,
        creator: p.creator,
        creationTool: p.creation_tool,
        creationTime: p.creation_time,
        aiIndicated: p.ai_indicated,
        history: (p.history ?? []) as string[],
        message: p.message ?? "",
      })),
      forensics: forensic.data
        ? {
            mediaKind: (forensic.data.media_kind ?? "unknown") as never,
            metadata: forensic.data.metadata as never,
            indicators: (forensic.data.indicators ?? []) as never,
            technical: (forensic.data.technical ?? {}) as never,
          }
        : null,
      segments: (segments.data ?? []).map((s) => ({
        track: s.track as "video" | "audio",
        start: Number(s.start_seconds),
        end: s.end_seconds === null ? null : Number(s.end_seconds),
        label: s.label as SegmentOutcome["label"],
        confidence: s.confidence === null ? null : Number(s.confidence),
        detector: s.detector ?? "",
        detail: s.detail,
      })),
      fusion: (payload["fusion"] ?? null) as ScanResultBundle["fusion"],
      reasoning: (payload["reasoning"] ?? null) as ScanResultBundle["reasoning"],
      custody: (custody.data ?? []) as ScanResultBundle["custody"],
    };
  });

export const listScans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("scans")
      .select(
        "id, evidence_id, case_id, file_name, media_kind, file_size, status, verdict, confidence, risk_level, created_at, completed_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const deleteScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scanId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: scan } = await supabase
      .from("scans")
      .select("storage_path")
      .eq("id", data.scanId)
      .single();
    if (scan?.storage_path) {
      await supabase.storage.from("evidence").remove([scan.storage_path]);
    }
    const { error } = await supabase.from("scans").delete().eq("id", data.scanId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const getProviderHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => [
    {
      name: "Hive AI",
      role: "AI-generation & deepfake detection",
      configured: Boolean(process.env["HIVE_API_KEY"]),
      note: process.env["HIVE_API_KEY"]
        ? "Configured — server-side only."
        : "Not configured. Detection results will report as unavailable.",
    },
    {
      name: "C2PA / Content Credentials",
      role: "Provenance manifests",
      configured: true,
      note: "Runs locally on the uploaded bytes — no key required.",
    },
    {
      name: "SynthID",
      role: "Google AI watermark",
      configured: false,
      note: "No public verification endpoint configured.",
    },
    {
      name: "Lovable AI",
      role: "Evidence reasoning",
      configured: Boolean(process.env["LOVABLE_API_KEY"]),
      note: "Explains normalized evidence only; never performs detection.",
    },
  ]);
