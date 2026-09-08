import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Activity,
  BadgeCheck,
  Brain,
  ChevronDown,
  Copy,
  Cpu,
  FileDigit,
  FileJson,
  FileText,
  History,
  Image as ImageIcon,
  Printer,
  Share2,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { ForensicReport } from "@/lib/forensics/types";
import { formatDuration } from "@/lib/forensics/fileAnalyzer";
import {
  downloadJsonReport,
  downloadTextReport,
  printPdfReport,
} from "@/lib/forensics/forensicReportService";
import {
  CertaintyTag,
  ConfidenceMeter,
  DataRow,
  Note,
  SectionCard,
  StatusIcon,
} from "./primitives";
import { ConfidenceRing } from "./ConfidenceRing";

const VERDICT_STYLE = {
  LIKELY_AUTHENTIC: { dot: "bg-verdict-safe", tone: "safe", ring: "border-verdict-safe/50 bg-verdict-safe/10" },
  INCONCLUSIVE: { dot: "bg-verdict-warn", tone: "warn", ring: "border-verdict-warn/50 bg-verdict-warn/10" },
  LIKELY_AI_GENERATED: { dot: "bg-verdict-danger", tone: "danger", ring: "border-verdict-danger/50 bg-verdict-danger/10" },
  LIKELY_MANIPULATED: { dot: "bg-verdict-danger", tone: "danger", ring: "border-verdict-danger/50 bg-verdict-danger/10" },
} as const;

/** One-sentence, plain-language answer shown at the very top. */
function plainAnswer(report: ForensicReport): string {
  const kind = report.file.kind;
  const ai = report.aiDetection;
  switch (report.verdict.kind) {
    case "LIKELY_AI_GENERATED":
      return `This ${kind} was most likely created by an AI generator${report.possibleGenerator.determined ? ` — possibly ${report.possibleGenerator.generator}` : ""}.`;
    case "LIKELY_MANIPULATED":
      return `This ${kind} appears to have been edited or manipulated after capture.`;
    case "LIKELY_AUTHENTIC":
      return `This ${kind} shows no strong signs of AI generation or manipulation and looks like a genuine capture.`;
    default:
      return ai.state === "unavailable" || !ai.serviceConfigured
        ? `We could not find enough reliable signals in this ${kind} to decide either way.`
        : `The signals in this ${kind} are mixed — it cannot be clearly classified as AI-generated or authentic.`;
  }
}

export function ReportDashboard({
  report,
  previewUrl,
}: {
  report: ForensicReport;
  previewUrl: string | null;
}) {
  const [showFull, setShowFull] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const v = VERDICT_STYLE[report.verdict.kind];

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied to clipboard`);
    } catch {
      toast.error("Clipboard unavailable in this browser");
    }
  };

  const ai = report.aiDetection;
  const aiHeadline =
    ai.state === "generated"
      ? "AI Generated: YES"
      : ai.state === "authentic"
        ? "AI Generated: NO STRONG INDICATORS"
        : "AI Detection: INCONCLUSIVE";

  // Top reasons for "Why this verdict" — strongest evidence first, max 5.
  const topReasons = report.evidence
    .flatMap((g) => g.items)
    .filter((i) => i.status === "negative" || i.status === "warning")
    .slice(0, 5);
  const fallbackReasons =
    topReasons.length === 0
      ? report.evidence.flatMap((g) => g.items).slice(0, 4)
      : topReasons;

  const quickFacts: { label: string; value: string; tone?: "safe" | "warn" | "danger" }[] = [
    {
      label: "AI probability",
      value: ai.serviceConfigured && ai.probability !== null ? `${ai.probability}%` : "Not tested",
      tone:
        (ai.probability ?? 0) >= 60 ? "danger" : (ai.probability ?? 0) >= 40 ? "warn" : "safe",
    },
    {
      label: "Manipulation risk",
      value: report.manipulation.risk,
      tone:
        report.manipulation.risk === "HIGH"
          ? "danger"
          : report.manipulation.risk === "MEDIUM"
            ? "warn"
            : "safe",
    },
    {
      label: "Device",
      value: report.metadata.device.identified
        ? [report.metadata.device.manufacturer, report.metadata.device.model]
            .filter(Boolean)
            .join(" ")
        : "Unknown",
    },
    {
      label: "Content credentials",
      value: report.provenance.state === "not_found" ? "Not found" : "Found",
    },
  ];

  return (
    <div className="space-y-5">
      {/* ============ SIMPLE SUMMARY ============ */}
      <section className={cn("panel border p-5 sm:p-6", v.ring)}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold tracking-[0.2em] uppercase">Analysis Result</h2>
          {report.isDemo ? (
            <Badge variant="outline" className="border-verdict-warn/60 text-verdict-warn">
              DEMO DATA
            </Badge>
          ) : null}
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {new Date(report.analyzedAt).toUTCString()}
          </span>
        </div>

        <div className="mt-5 grid gap-6 md:grid-cols-[180px_1fr]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
              {previewUrl && report.file.kind === "image" ? (
                <img src={previewUrl} alt={report.file.name} className="aspect-square w-full object-contain" />
              ) : previewUrl && report.file.kind === "video" ? (
                <video src={previewUrl} controls className="aspect-square w-full object-contain" />
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <ImageIcon className="size-8 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {report.isDemo ? "No media (demo report)" : "Preview unavailable"}
                  </span>
                </div>
              )}
            </div>
            <ConfidenceRing
              value={report.verdict.confidence}
              tone={v.tone as "safe" | "warn" | "danger"}
              label="Confidence"
              size={140}
              className="mx-auto"
            />
          </div>

          <div>
            <p className="mt-1 font-display text-3xl font-bold sm:text-4xl">
              <span className={cn("mr-3 inline-block size-4 rounded-full align-middle sm:size-5", v.dot)} />
              {report.verdict.label.toUpperCase()}
            </p>
            <p className="mt-3 max-w-xl text-base leading-relaxed font-medium">
              {plainAnswer(report)}
            </p>

            {/* Quick facts */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quickFacts.map((f) => (
                <div key={f.label} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-[10px] tracking-wider text-muted-foreground uppercase">
                    {f.label}
                  </p>
                  <p
                    className={cn(
                      "mt-1 truncate text-sm font-semibold",
                      f.tone === "danger" && "text-verdict-danger",
                      f.tone === "warn" && "text-verdict-warn",
                      f.tone === "safe" && "text-verdict-safe",
                    )}
                    title={f.value}
                  >
                    {f.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Why */}
            <p className="mt-5 text-xs tracking-wider text-muted-foreground uppercase">
              Why this verdict
            </p>
            <ul className="mt-2 space-y-1.5">
              {fallbackReasons.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <StatusIcon status={item.status} className="mt-0.5" />
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => printPdfReport(report)}>
                <Printer className="size-4" /> PDF report
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadJsonReport(report)}>
                <FileJson className="size-4" /> JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => downloadTextReport(report)}>
                <FileText className="size-4" /> Text
              </Button>
            </div>
          </div>
        </div>

        <p className="mt-5 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          Results are probabilistic assessments based on available evidence — not proof of
          origin. Always combine with human judgment.
        </p>
      </section>

      {/* ============ FULL DETAILS TOGGLE ============ */}
      <button
        type="button"
        onClick={() => setShowFull((s) => !s)}
        className="panel flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:border-primary/40"
      >
        <span className="text-sm font-semibold tracking-wide uppercase">
          {showFull ? "Hide" : "Show"} full forensic details
        </span>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", showFull && "rotate-180")}
        />
      </button>

      {showFull ? (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            {/* AI detection */}
            <SectionCard title="AI Detection" icon={<Brain className="size-4" />} subtitle={ai.serviceName}>
              <p
                className={cn(
                  "font-display text-xl font-semibold",
                  ai.state === "generated" && "text-verdict-danger",
                  ai.state === "authentic" && "text-verdict-safe",
                  ai.state !== "generated" && ai.state !== "authentic" && "text-verdict-warn",
                )}
              >
                {aiHeadline}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ConfidenceMeter
                  value={ai.probability}
                  label="AI probability"
                  tone={ai.state === "generated" ? "danger" : "primary"}
                />
                <ConfidenceMeter value={ai.confidence} label="Confidence" tone="primary" />
              </div>
              {!ai.serviceConfigured ? (
                <p className="mt-4 rounded-md border border-verdict-warn/40 bg-verdict-warn/10 p-3 text-xs text-verdict-warn">
                  No external AI-detection model is configured. Results are based only on evidence embedded
                  in the file — pixel-level detection is unavailable.
                </p>
              ) : null}
              <Note>{ai.message}</Note>
              <ul className="mt-3 space-y-1.5">
                {ai.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <StatusIcon status="neutral" className="mt-0.5" />
                    {r}
                  </li>
                ))}
              </ul>
            </SectionCard>

            {/* Possible AI source */}
            <SectionCard title="Possible AI Source" icon={<Sparkles className="size-4" />}>
              {report.possibleGenerator.determined ? (
                <>
                  <p className="font-display text-xl font-semibold">{report.possibleGenerator.generator}</p>
                  <div className="mt-4 max-w-sm">
                    <ConfidenceMeter value={report.possibleGenerator.confidence} tone="warn" />
                  </div>
                  <p className="mt-4 text-xs tracking-wider text-muted-foreground uppercase">Evidence</p>
                  <ul className="mt-2 space-y-1.5">
                    {report.possibleGenerator.evidence.map((e, i) => (
                      <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                        <StatusIcon status="warning" className="mt-0.5" />
                        {e}
                      </li>
                    ))}
                  </ul>
                  <Note>{report.possibleGenerator.message}</Note>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">AI source could not be determined.</p>
              )}
            </SectionCard>

            {/* Device */}
            <SectionCard title="Device Information" icon={<Cpu className="size-4" />}>
              {report.metadata.device.identified ? (
                <>
                  <p className="mb-3 flex items-center gap-2 text-sm text-verdict-safe">
                    <StatusIcon status="positive" /> Device identified from metadata
                  </p>
                  <DataRow label="Manufacturer" value={report.metadata.device.manufacturer} certainty="confirmed" />
                  <DataRow label="Device" value={report.metadata.device.model} certainty="confirmed" />
                  <DataRow label="Model code" value={report.metadata.device.modelCode} certainty="confirmed" />
                  <DataRow label="Lens" value={report.metadata.device.lens} certainty="confirmed" />
                  <DataRow label="Software" value={report.metadata.device.software} certainty="confirmed" />
                  <DataRow label="Firmware" value={report.metadata.device.firmware} certainty="confirmed" />
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-sm text-verdict-warn">
                    <StatusIcon status="warning" /> Device information unavailable
                  </p>
                  <Note>
                    No camera make/model tags are present. Device inference from pixel content is not
                    performed, so no device is guessed.
                  </Note>
                </>
              )}
            </SectionCard>

            {/* Metadata */}
            <SectionCard
              title="Metadata / EXIF"
              icon={<Activity className="size-4" />}
              subtitle={report.metadata.message}
            >
              {report.metadata.available ? (
                <>
                  <DataRow label="Original date/time" value={report.metadata.capture.dateTimeOriginal} certainty="confirmed" />
                  <DataRow label="Dimensions" value={report.metadata.capture.dimensions} certainty="confirmed" />
                  <DataRow label="Orientation" value={report.metadata.capture.orientation} certainty="confirmed" />
                  <DataRow label="ISO" value={report.metadata.capture.iso} certainty="confirmed" />
                  <DataRow label="Shutter speed" value={report.metadata.capture.shutterSpeed} certainty="confirmed" />
                  <DataRow label="Aperture" value={report.metadata.capture.aperture} certainty="confirmed" />
                  <DataRow label="Focal length" value={report.metadata.capture.focalLength} certainty="confirmed" />
                  <DataRow label="Flash" value={report.metadata.capture.flash} certainty="confirmed" />
                  <DataRow label="White balance" value={report.metadata.capture.whiteBalance} certainty="confirmed" />
                  <DataRow
                    label="GPS coordinates"
                    value={
                      report.metadata.capture.gps
                        ? `${report.metadata.capture.gps.lat.toFixed(6)}, ${report.metadata.capture.gps.lon.toFixed(6)}`
                        : null
                    }
                    certainty="confirmed"
                    mono
                  />
                </>
              ) : (
                <>
                  <p className="text-sm text-verdict-warn">Metadata unavailable or removed.</p>
                  <ul className="mt-3 space-y-1.5">
                    {report.metadata.strippedIndicators.map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                        <StatusIcon status="warning" className="mt-0.5" /> {s}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </SectionCard>

            {/* Content credentials */}
            <SectionCard title="Content Credentials (C2PA)" icon={<BadgeCheck className="size-4" />}>
              <p
                className={cn(
                  "font-display text-lg font-semibold",
                  report.provenance.state === "not_found" ? "text-muted-foreground" : "text-verdict-warn",
                )}
              >
                {report.provenance.state === "not_found"
                  ? "Not found"
                  : "Found — could not be verified"}
              </p>
              {report.provenance.state !== "not_found" ? (
                <div className="mt-3">
                  <DataRow label="Creator" value={report.provenance.creator} certainty="inferred" />
                  <DataRow label="Application" value={report.provenance.application} certainty="inferred" />
                  <DataRow label="Action" value={report.provenance.action} certainty="inferred" />
                  <DataRow
                    label="Markers detected"
                    value={report.provenance.markers.join(", ") || null}
                    certainty="confirmed"
                    mono
                  />
                  {report.provenance.history.length ? (
                    <ul className="mt-3 space-y-1.5">
                      {report.provenance.history.map((h, i) => (
                        <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                          <StatusIcon status="neutral" className="mt-0.5" /> {h}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <Note>{report.provenance.message}</Note>
            </SectionCard>

            {/* Manipulation */}
            <SectionCard title="Manipulation Analysis" icon={<ShieldAlert className="size-4" />}>
              <div className="flex items-center gap-3">
                <span className="text-xs tracking-wider text-muted-foreground uppercase">Risk</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono",
                    report.manipulation.risk === "LOW" && "border-verdict-safe/50 text-verdict-safe",
                    report.manipulation.risk === "MEDIUM" && "border-verdict-warn/50 text-verdict-warn",
                    report.manipulation.risk === "HIGH" && "border-verdict-danger/50 text-verdict-danger",
                  )}
                >
                  {report.manipulation.risk}
                </Badge>
              </div>
              <div className="mt-4 max-w-sm">
                <ConfidenceMeter
                  value={report.manipulation.confidence}
                  tone={report.manipulation.risk === "HIGH" ? "danger" : "primary"}
                />
              </div>
              {report.manipulation.evidence.length ? (
                <ul className="mt-4 space-y-1.5">
                  {report.manipulation.evidence.map((e, i) => (
                    <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                      <StatusIcon status="warning" className="mt-0.5" /> {e}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 flex gap-2 text-sm text-verdict-safe">
                  <StatusIcon status="positive" className="mt-0.5" /> No strong manipulation indicators
                  detected.
                </p>
              )}
              <Note>{report.manipulation.message}</Note>
            </SectionCard>

            {/* Social media */}
            <SectionCard title="Social Media Analysis" icon={<Share2 className="size-4" />}>
              <DataRow
                label="Possible platform"
                value={report.socialMedia.platform}
                certainty={report.socialMedia.platform ? "inferred" : "unknown"}
              />
              <div className="mt-4 max-w-sm">
                <ConfidenceMeter value={report.socialMedia.confidence} tone="warn" />
              </div>
              {report.socialMedia.indicators.length ? (
                <ul className="mt-4 space-y-1.5">
                  {report.socialMedia.indicators.map((e, i) => (
                    <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                      <StatusIcon status="warning" className="mt-0.5" /> {e}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Note>{report.socialMedia.message}</Note>
            </SectionCard>

            {/* File info */}
            <SectionCard
              title="File Information"
              icon={<FileDigit className="size-4" />}
              action={
                <Button size="sm" variant="outline" onClick={() => copy(report.file.sha256, "SHA-256 hash")}>
                  <Copy className="size-3.5" /> Copy hash
                </Button>
              }
            >
              <DataRow label="Filename" value={report.file.name} certainty="confirmed" />
              <DataRow label="Extension" value={report.file.extension.toUpperCase()} certainty="confirmed" />
              <DataRow label="MIME type" value={report.file.mimeType} certainty="confirmed" mono />
              <DataRow label="File size" value={`${report.file.sizeLabel} (${report.file.size} bytes)`} certainty="confirmed" />
              <DataRow
                label="Resolution"
                value={report.file.width && report.file.height ? `${report.file.width} × ${report.file.height}` : null}
                certainty="confirmed"
              />
              <DataRow
                label="Duration"
                value={report.file.duration ? formatDuration(report.file.duration) : null}
                certainty="confirmed"
              />
              <DataRow label="Frame rate" value={report.file.frameRate ? `${report.file.frameRate} fps` : null} certainty="inferred" />
              <DataRow label="Codec / container" value={report.file.codec} certainty="confirmed" />
              <DataRow
                label="Bitrate"
                value={report.file.bitrate ? `${Math.round(report.file.bitrate / 1000)} kbps (average)` : null}
                certainty="inferred"
              />
              <DataRow label="Color space" value={report.file.colorSpace} certainty="confirmed" />
              <DataRow label="Modified" value={report.file.lastModified} certainty="confirmed" />
              <DataRow label="SHA-256" value={report.file.sha256} certainty="confirmed" mono />
            </SectionCard>
          </div>

          {/* Timeline */}
          <SectionCard
            title="Media History / Timeline"
            icon={<History className="size-4" />}
            subtitle="Only events supported by evidence are shown. Nothing is invented."
          >
            {report.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No timeline events could be established for this file.
              </p>
            ) : (
              <ol className="relative space-y-5 border-l border-border pl-6">
                {report.timeline.map((t, i) => (
                  <li key={i} className="relative">
                    <span
                      className={cn(
                        "absolute top-1.5 -left-[1.72rem] size-2.5 rounded-full ring-4 ring-background",
                        t.certainty === "confirmed" ? "bg-verdict-safe" : "bg-verdict-warn",
                      )}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {t.date ?? "date unknown"}
                      </span>
                      <CertaintyTag certainty={t.certainty} />
                    </div>
                    <p className="mt-1 text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.detail}</p>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>

          {/* Evidence */}
          <SectionCard title="Evidence Found" icon={<StatusIcon status="positive" />}>
            <Accordion type="multiple" className="w-full">
              {report.evidence.map((g) => (
                <AccordionItem key={g.category} value={g.category}>
                  <AccordionTrigger className="text-sm">
                    <span className="flex items-center gap-3">
                      {g.category}
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {g.items.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-3">
                      {g.items.map((item, i) => (
                        <li key={i} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusIcon status={item.status} />
                            <span className="text-sm font-medium">{item.title}</span>
                            <CertaintyTag certainty={item.certainty} />
                            {item.confidence !== null ? (
                              <span className="ml-auto font-mono text-xs text-primary">
                                {item.confidence}%
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-xs break-words text-muted-foreground">{item.explanation}</p>
                          <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                            source: {item.source}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </SectionCard>

          {/* Technical */}
          <div>
            <Button size="sm" variant="ghost" onClick={() => setShowTech((s) => !s)}>
              <Terminal className="size-4" /> {showTech ? "Hide" : "View"} raw technical data
            </Button>
            {showTech ? (
              <SectionCard
                title="Technical Details"
                icon={<Terminal className="size-4" />}
                subtitle="Raw signals used to produce this report"
                className="mt-3"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(JSON.stringify(report.technical, null, 2), "Technical data")}
                  >
                    <Copy className="size-3.5" /> Copy
                  </Button>
                }
              >
                <pre className="mono-xs max-h-[28rem] overflow-auto rounded-lg border border-border bg-background/70 p-4 whitespace-pre-wrap">
                  {JSON.stringify(report.technical, null, 2)}
                </pre>
              </SectionCard>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
