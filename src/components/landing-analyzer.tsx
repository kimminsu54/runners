"use client";

import { AnalysisDetails, AnalysisDetailsProvider } from "@/components/analysis-details";
import { FrontalAlignment } from "@/components/frontal-alignment";
import { ImpactChart } from "@/components/impact-chart";
import { InjuryGuidance } from "@/components/injury-guidance";
import { LandingCard } from "@/components/landing-card";
import { LiveReadout } from "@/components/live-readout";
import { SessionSummaryCard } from "@/components/session-summary";
import { SideBreakdown } from "@/components/side-breakdown";
import { ThresholdEvidence } from "@/components/threshold-evidence";
import { PipelineCompare } from "@/components/pipeline-compare";
import { PoseOverlay, PoseSketch } from "@/components/pose-overlay";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { renderExportFrame } from "@/lib/export-frame";
import { FACE_COVER_LABEL } from "@/lib/face-blur";
import { buildHudFrame } from "@/lib/hud-frame";
import {
  analyzeLandings,
  analyzeLandingsAuto,
  formatSeconds,
  type AnalysisResult,
  type PoseFrame,
} from "@/lib/landing-analysis";
import { buildSessionSummary } from "@/lib/session-summary";
import {
  analysisTimeFromVideo,
  liveMomentAt,
  nearestPoseFrame,
  videoTimeFromAnalysis,
} from "@/lib/live-readout";
import type { Landmark } from "@/lib/pose";
import { getPoseLandmarker, seekVideo, waitMetadata } from "@/lib/pose-engine";
import {
  syntheticFrontRunFrames,
  syntheticRunningFrames,
} from "@/lib/synthetic-jump";
import type { PipelinePass } from "@/lib/pipeline-compare";
import { importTrc, isImportCandidate, type NamedText } from "@/lib/trc-import";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, ImageDown, UploadCloud } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** The query string does not change while the analyzer is mounted. */
const subscribeNever = () => () => {};

type Status = "idle" | "loading-model" | "analyzing" | "done" | "error";

const MAX_SECONDS = 12;
/**
 * Frames sampled from one clip, whatever its length.
 *
 * Sprint stance lasts about 100 ms, so sample far above video frame rate when
 * the clip is short enough to afford it. The budget moved down with
 * MAX_SECONDS rather than staying put: at 540 a twelve-second clip would have
 * been sampled at 45 fps and taken exactly as long to analyse as eighteen
 * seconds used to, which is not what shortening the window was for. 360 over
 * 12 s is 30 fps — the same density the old limit gave — for a third less
 * work. Clips under nine seconds are unaffected either way; they hit MAX_FPS
 * before they hit the budget.
 */
const FRAME_BUDGET = 360;
const MIN_FPS = 24;
const MAX_FPS = 60;

/**
 * Whether to offer importing a Sports2D result.
 *
 * Sports2D cannot run in a browser — it is Python driving native onnxruntime —
 * so this is not a way to analyse with it here. It reads a run Sports2D
 * already did, so its numbers can be read in this report next to the
 * browser's own pass over the same clip. That is a measurement instrument for
 * comparing the two pipelines, not a feature for someone checking their form,
 * and it stays out of the shipped interface for the same reason the reference
 * tool lives in tools/ rather than src/.
 */
const OFFER_TRC_IMPORT = process.env.NODE_ENV === "development";

/** A Sports2D result the dev server found on disk. */
type Sports2dRun = { id: string; name: string; frames: number; rate: number };

export function LandingAnalyzer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [statureCm, setStatureCm] = useState(170);
  const [massKg, setMassKg] = useState(70);
  const [paceMinutes, setPaceMinutes] = useState<string>("");
  const [paceSeconds, setPaceSeconds] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [overlay, setOverlay] = useState<Landmark[] | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);
  // 0 means let the analyzer infer the capture rate from the gait itself.
  // Default to 8x because that is what the phone slow-motion mode records.
  const [slowMotionFactor, setSlowMotionFactor] = useState(8);
  const [detectedSlowMotion, setDetectedSlowMotion] = useState<number | null>(null);
  const [suggestedSlowMotion, setSuggestedSlowMotion] = useState<number | null>(null);
  const [playheadT, setPlayheadT] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [demoPlaying, setDemoPlaying] = useState(false);
  // Rendering reads these (the sketch overlay follows the playhead), so they are
  // state, not a ref.
  const [poseFrames, setPoseFrames] = useState<PoseFrame[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  // On by default. The preview is the other place a face can be seen — a shared
  // screen, a recording, someone standing behind you — and the export already
  // covers the file. Off is a deliberate choice, which is why it is a visible
  // control rather than a setting.
  const [faceHidden, setFaceHidden] = useState(true);
  /**
   * Face landmarks for a preview that has no analysis behind it yet.
   *
   * Two cases, and they had opposite bugs. Framing a shot on the camera happens
   * before anything is tracked; so does looking at a clip you have just chosen
   * and not yet analysed. In both, `overlay` is empty, and the fail-closed
   * answer — cover the upper third — turns the preview into a grey slab you
   * cannot frame or scrub against. Tracking the face a few times a second
   * covers the face itself instead, for a fraction of a core.
   *
   * Kept apart from `overlay` so no skeleton appears over someone who is still
   * setting the camera up, and dropped once the analysis owns the frames: those
   * carry a pose for every sampled frame, which tracks better than this can.
   */
  const [previewFace, setPreviewFace] = useState<Landmark[] | null>(null);
  const clockFactor =
    detectedSlowMotion && detectedSlowMotion > 0 ? detectedSlowMotion : 1;

  useEffect(() => {
    if (!videoUrl) return;
    return () => URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  // `?demo=report` seeds the sample session, and `?demo=front` seeds one shot
  // from in front — the two reports differ enough that the second is worth
  // being able to look at without finding a frontal clip first. The query
  // string is client-only, so it is read through the store hook and the seeding
  // happens during render rather than in a mount effect — the effect version
  // set seven pieces of state after the first paint, which flashed the empty
  // upload state and is the shape React warns about.
  const demoRequested = useSyncExternalStore(
    subscribeNever,
    () => {
      const value = new URLSearchParams(window.location.search).get("demo");
      return value === "report" || value === "front" ? value : null;
    },
    () => null,
  );
  const [demoSeeded, setDemoSeeded] = useState(false);
  /** What an imported Sports2D file was, so the report says where it came from. */
  const [trcNote, setTrcNote] = useState<string | null>(null);
  /** The offline runs sitting in tools/sports2d/out, as the dev server sees them. */
  const [runs, setRuns] = useState<Sports2dRun[] | null>(null);
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
  /**
   * One completed pass per estimator, kept so the two can be compared.
   *
   * Held here rather than in the report because a pass outlives what produced
   * it: importing a TRC replaces the clip on screen, and the browser's numbers
   * for that clip have to survive it or there is nothing to compare against.
   */
  const [passes, setPasses] = useState<Partial<Record<"browser" | "sports2d", PipelinePass>>>(
    {},
  );
  /**
   * Whether the pose on screen can supply a face.
   *
   * MediaPipe returns eyes, ears and a nose; a Sports2D TRC has only the nose,
   * because Sports2D does not write the others. So a TRC-sourced pose cannot
   * produce a face box, and covering has to come from somewhere else or the
   * ladder falls through to blurring the top third of the frame — which is
   * both useless and, for a runner who is not in the top third, a face left
   * showing.
   */
  const [faceFromPose, setFaceFromPose] = useState(true);
  /**
   * Where in the clip the analysis window starts, in video seconds.
   *
   * A TRC times itself from zero whatever part of the clip it covers, so
   * without this a run of seconds 5 to 8 would line up against the first three
   * seconds of footage and look plausible while being wrong.
   */
  const [analysisOffsetS, setAnalysisOffsetS] = useState(0);
  if (demoRequested && !demoSeeded) {
    const frames =
      demoRequested === "front"
        ? syntheticFrontRunFrames({ valgus: 0.018, pelvicDrop: 0.009 })
        : syntheticRunningFrames();
    const demo = analyzeLandings(frames, {
      statureM: 1.7,
      massKg: 70,
      width: 1280,
      height: 720,
    });
    setDemoSeeded(true);
    setPoseFrames(frames);
    setFileName(demoRequested === "front" ? "샘플 세션 · 정면" : "샘플 세션");
    setResult(demo);
    setDetectedSlowMotion(1);
    setStatus("done");
    setPlayheadT(demo.landings[0]?.tContact ?? 0);
    setDemoPlaying(true);
  }

  useEffect(() => {
    const stream = streamRef.current;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  // Also while a TRC-sourced report is on screen over real footage: the
  // skeleton is Sports2D's, the face box is MediaPipe's, and the video stays
  // covered.
  const needsPreviewFace =
    faceHidden && (cameraOn || (Boolean(videoUrl) && (!result || !faceFromPose)));

  useEffect(() => {
    if (!needsPreviewFace) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const video = videoRef.current;
      if (!live || !video || !video.videoWidth) {
        timer = setTimeout(tick, 400);
        return;
      }
      try {
        const landmarker = await getPoseLandmarker();
        if (!live) return;
        const det = landmarker.detect(video);
        setPreviewFace(det.landmarks[0] ?? null);
      } catch {
        // Leave the last box in place. PoseOverlay holds it, and holding is the
        // fail-closed answer here: a dropped detection is not evidence that the
        // face has gone.
      }
      if (live) timer = setTimeout(tick, 250);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      // Cleared on the way out rather than on the way in, so the last box does
      // not survive into a different clip.
      setPreviewFace(null);
    };
  }, [needsPreviewFace]);

  // Not memoized: it appears in no dependency array, so a useCallback here
  // bought nothing and stopped the React Compiler optimising this component at
  // all — it could not prove the empty dependency list matched what the body
  // reads, and reported that against an unrelated line.
  const attachFile = (file: File) => {
    // Both passes belong to the clip that produced them.
    setPasses({});
    setFaceFromPose(true);
    setAnalysisOffsetS(0);
    setTrcNote(null);
    setPoseFrames([]);
    setResult(null);
    setError(null);
    setStatus("idle");
    setSelected(0);
    setOverlay(null);
    setPlayheadT(0);
    setDemoPlaying(false);
    setFileName(file.name);
    setVideoUrl(URL.createObjectURL(file));
  };

  /**
   * Take whatever was dropped or picked and send it down the right path.
   *
   * Sorting by what the files are, rather than by which control was used,
   * means the drop zone that already accepts a clip also accepts a Sports2D
   * result — select the TRC and the calib.toml in the output folder and drag
   * them in. That is one gesture instead of navigating a dialog four levels
   * deep, which is where this was easy to get stuck.
   */
  /**
   * Publish both passes for the offline comparison harness to read.
   *
   * The browser's landings exist only in this browser, and the comparison the
   * project needs is per landing, not per average: an average hides whether
   * the two estimators disagree a little about every contact or completely
   * about a few. tools/sports2d/compare-all.py reads this over the DevTools
   * protocol and writes the CSV.
   *
   * A measurement hook, behind the same development-only condition as the
   * import that feeds it, and write-only — nothing in the app reads it back,
   * so it cannot become a second source of truth for the report.
   */
  useEffect(() => {
    if (!OFFER_TRC_IMPORT) return;
    const target = window as unknown as { __strideLabPasses?: unknown };
    target.__strideLabPasses = {
      browser: passes.browser
        ? {
            label: passes.browser.label,
            clip: passes.browser.clip,
            windowS: passes.browser.windowS,
            clockFactor: passes.browser.clockFactor,
            trackedFrames: passes.browser.trackedFrames,
            totalFrames: passes.browser.totalFrames,
            quality: passes.browser.result.quality,
            landings: passes.browser.result.landings,
          }
        : null,
      sports2d: passes.sports2d
        ? {
            label: passes.sports2d.label,
            clip: passes.sports2d.clip,
            windowS: passes.sports2d.windowS,
            clockFactor: passes.sports2d.clockFactor,
            trackedFrames: passes.sports2d.trackedFrames,
            totalFrames: passes.sports2d.totalFrames,
            quality: passes.sports2d.result.quality,
            landings: passes.sports2d.result.landings,
          }
        : null,
    };
    return () => {
      delete target.__strideLabPasses;
    };
  }, [passes]);

  // Ask the dev server what offline runs exist, once.
  useEffect(() => {
    if (!OFFER_TRC_IMPORT) return;
    let live = true;
    void fetch("/api/sports2d")
      .then((response) => (response.ok ? response.json() : { runs: [] }))
      .then((body) => {
        if (live) setRuns(Array.isArray(body?.runs) ? body.runs : []);
      })
      .catch(() => {
        if (live) setRuns([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const onFile = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;

    const forImport = files.filter((file) => isImportCandidate(file.name));
    if (forImport.length) {
      void importSports2d(forImport);
      return;
    }

    const file = files[0];
    const looksLikeVideo =
      file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
    if (!looksLikeVideo) {
      // Naming the TRC pair here because a stray .trc is otherwise rejected as
      // "not a video", which is true and useless.
      setError(
        OFFER_TRC_IMPORT
          ? "영상 파일, 또는 Sports2D의 픽셀 TRC와 _calib.toml 을 함께 올려 주세요."
          : "영상 파일만 올릴 수 있습니다.",
      );
      setStatus("error");
      return;
    }
    attachFile(file);
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setRecording(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      setResult(null);
      setPasses({});
      setFaceFromPose(true);
      setAnalysisOffsetS(0);
      setTrcNote(null);
      setPoseFrames([]);
      setDemoPlaying(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setError("카메라 권한이 필요합니다. 브라우저에서 허용해 주세요.");
      setStatus("error");
    }
  };

  const toggleRecord = () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      stopCamera();
      attachFile(new File([blob], "camera-clip.webm", { type: blob.type }));
    };
    recorderRef.current = rec;
    rec.start();
    setRecording(true);
  };

  /**
   * Fill the report from a Sports2D run instead of from this browser's pass.
   *
   * The files are read here and nowhere else — the same promise the hero makes
   * about video holds for these. What arrives is the same PoseFrame[] the
   * MediaPipe loop produces, so every card below renders unchanged; that is
   * the point, because a comparison is only worth anything if the analysis on
   * both sides is literally the same code.
   */
  const importNamed = (named: NamedText[]) => {
    setError(null);
    setTrcNote(null);
    const parsed = importTrc(named);
    if (!parsed.ok) {
      setError(parsed.reason);
      setStatus("error");
      return;
    }

    const {
      frames,
      width,
      height,
      rate,
      markerCount,
      trackedFrames,
      verticalAxis,
      sourceName,
      clip,
      startS,
      mode,
    } = parsed.value;
    stopCamera();

    // Draw over the footage when we can prove it is the right footage. The
    // manifest names the clip Sports2D read; if that is what is loaded, the
    // skeleton belongs on it. Without a manifest, or over a different clip, the
    // video goes — a skeleton on the wrong video looks like a tracking failure
    // and reads as one.
    const loaded = fileName;
    const overFootage = Boolean(videoUrl && clip && loaded && clip === loaded);
    if (!overFootage) setVideoUrl(null);
    setAnalysisOffsetS(overFootage ? startS : 0);
    setFaceFromPose(false);
    setDemoPlaying(false);
    setOverlay(null);
    setPoseFrames(frames);

    // preFiltered because Sports2D already ran Hampel and a 6 Hz Butterworth
    // before writing; smoothing again would widen the effective window and we
    // would be measuring our own filter and calling it a pose difference.
    //
    // slowMotionFactor 1 rather than the auto detector, because TRC timestamps
    // are already real time. The detector reads frame spacing to decide
    // whether a clip was shot in slow motion, and here that spacing is the
    // sample rate of the reference tool, which means nothing about the runner.
    const analysis = analyzeLandings(frames, {
      statureM: statureCm / 100,
      massKg,
      width,
      height,
      slowMotionFactor: 1,
      preFiltered: true,
      reportedPaceMinPerKm:
        Number(paceMinutes) > 0
          ? Number(paceMinutes) +
            Math.min(59, Math.max(0, Number(paceSeconds) || 0)) / 60
          : undefined,
    });

    setResult(analysis);
    setSelected(0);
    setDetectedSlowMotion(1);
    setSuggestedSlowMotion(null);
    setFileName(overFootage ? loaded : sourceName);
    setPasses((kept) => ({
      ...kept,
      sports2d: {
        key: "sports2d",
        label: "Sports2D",
        result: analysis,
        trackedFrames,
        totalFrames: frames.length,
        // The manifest is the statement of which clip this was. Falling back
        // to the output's own name keeps runs made before the manifest
        // comparable, at the cost of trusting Sports2D's naming.
        clip: (clip ?? sourceName.replace(/_Sports2D.*$/, "")).replace(/\.[^.]+$/, ""),
        // The analysed span in analysis seconds, which for an imported run is
        // real time because the clock is pinned to 1.
        windowS: analysis.series.at(-1)?.t ?? 0,
        clockFactor: 1,
      },
    }));
    setTrcNote(
      [
        `Sports2D${mode ? ` ${mode}` : ""}`,
        `${width}×${height} · ${rate} fps`,
        `마커 ${markerCount}개 · 추적 ${trackedFrames}/${frames.length}`,
        `y축 ${verticalAxis} · 내부 평활 반영`,
        overFootage
          ? `영상 위 · ${startS.toFixed(0)}초부터`
          : clip
            ? `영상 없음 (이 결과는 ${clip})`
            : "영상 없음 (어느 클립인지 기록 없음)",
      ].join(" · "),
    );
    const firstContact = analysis.landings[0]?.tContact ?? 0;
    setPlayheadT(firstContact);
    if (overFootage && videoRef.current) {
      const video = videoRef.current;
      void seekVideo(video, firstContact + startS).then(() => {
        video.pause();
        const frame = nearestPoseFrame(frames, firstContact);
        if (frame?.landmarks) setOverlay(frame.landmarks);
      });
    }
    setStatus("done");
    setProgress(100);
  };

  const importSports2d = async (files: File[]) => {
    if (!files.length) return;
    // Only the two files that matter get read. A Sports2D folder also holds a
    // rendered video and a few dozen images, and dragging the whole folder in
    // is the obvious thing to do.
    const named = await Promise.all(
      files.map(async (file) => ({ name: file.name, text: await file.text() })),
    );
    importNamed(named);
  };

  /**
   * Load one of the offline runs without a file dialog.
   *
   * The results live in this repository, so asking the dev server for them is
   * one click where picking two files four directories down was several steps
   * and a guess about which two. It goes through the same importTrc as a
   * picked file — including every refusal — so there is one way this data can
   * enter the report, not two.
   */
  const loadRun = async (id: string) => {
    setLoadingRun(id);
    // No try/finally: the React Compiler cannot preserve this component's
    // manual memoization across one, and it bails out of optimising the whole
    // component with an error that points at an unrelated useCallback.
    const failed = (message: string) => {
      setError(message);
      setStatus("error");
    };
    const body = await fetch(`/api/sports2d?id=${encodeURIComponent(id)}`)
      .then((response) => response.json().catch(() => null))
      .catch(() => null);
    setLoadingRun(null);
    if (!body) {
      failed("개발 서버에서 Sports2D 결과를 받지 못했습니다.");
      return;
    }
    if (!body.trc || !body.calib) {
      failed(body.error ?? `${id} 를 읽지 못했습니다.`);
      return;
    }
    // The manifest travels with the pair. Without it the import cannot say which
    // clip the run belongs to, so it refuses to draw over footage — correct
    // behaviour reached for the wrong reason, and the skeleton lands on black.
    importNamed([
      { name: body.name, text: body.trc },
      { name: "run_calib.toml", text: body.calib },
      ...(body.manifest ? [{ name: "stride-lab.json", text: body.manifest }] : []),
    ]);
  };

  const analyze = async () => {
    const video = videoRef.current;
    if (!video || !videoUrl) {
      setError("먼저 영상을 올리거나 카메라로 찍어 주세요.");
      setStatus("error");
      return;
    }
    setError(null);
    setResult(null);
    setStatus("loading-model");
    setProgress(0);

    try {
      await waitMetadata(video);
      const duration = Math.min(video.duration || 0, MAX_SECONDS);
      if (!Number.isFinite(duration) || duration < 0.4) {
        throw new Error("영상이 너무 짧습니다. 0.5초 이상을 올려 주세요.");
      }
      const landmarker = await getPoseLandmarker();
      setStatus("analyzing");
      const sampleFps = Math.min(
        MAX_FPS,
        Math.max(MIN_FPS, FRAME_BUDGET / duration),
      );
      const n = Math.min(Math.round(duration * sampleFps), FRAME_BUDGET);
      const frames: PoseFrame[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / Math.max(1, n - 1)) * duration;
        await seekVideo(video, t);
        const det = landmarker.detect(video);
        frames.push({ t, landmarks: det.landmarks[0] ?? null });
        if (i % 2 === 0) setProgress(Math.round(((i + 1) / n) * 100));
      }
      setPoseFrames(frames);
      const {
        result: analysis,
        slowMotionFactor: usedFactor,
        suggestedFactor,
      } = analyzeLandingsAuto(
        frames,
        {
          statureM: statureCm / 100,
          massKg,
          width: video.videoWidth || 640,
          height: video.videoHeight || 360,
          slowMotionFactor: slowMotionFactor || undefined,
          reportedPaceMinPerKm:
            Number(paceMinutes) > 0
              ? Number(paceMinutes) +
                Math.min(59, Math.max(0, Number(paceSeconds) || 0)) / 60
              : undefined,
        },
      );
      setDetectedSlowMotion(usedFactor);
      setSuggestedSlowMotion(suggestedFactor ?? null);
      setResult(analysis);
      setPasses((kept) => ({
        ...kept,
        browser: {
          key: "browser",
          label: "브라우저",
          result: analysis,
          trackedFrames: frames.filter((frame) => frame.landmarks).length,
          totalFrames: frames.length,
          clip: (fileName ?? "clip").replace(/\.[^.]+$/, ""),
          // Analysis seconds, not video seconds. A clip read as slow motion
          // covers its whole duration in a fraction of that time, and it is
          // the analysis clock the landings are timed on.
          windowS: analysis.series.at(-1)?.t ?? 0,
          clockFactor: usedFactor > 0 ? usedFactor : 1,
        },
      }));
      setSelected(0);
      setStatus("done");
      setProgress(100);
      const factor = usedFactor > 0 ? usedFactor : 1;
      if (analysis.landings[0]) {
        const analysisT = analysis.landings[0].tContact;
        setPlayheadT(analysisT);
        await seekVideo(video, videoTimeFromAnalysis(analysisT, factor, analysisOffsetS));
        video.pause();
        const frame = nearestPoseFrame(
          frames,
          videoTimeFromAnalysis(analysisT, factor, analysisOffsetS),
        );
        setOverlay(frame?.landmarks ?? null);
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "분석에 실패했습니다.");
    }
  };

  /**
   * Without a video element the pose comes from the frames we already have, so
   * it is a function of the playhead — derived, not stored. Storing it meant an
   * effect calling setOverlay on every animation frame, which React counts as a
   * cascading update and eventually refuses ("Maximum update depth exceeded").
   * The video and camera paths still own `overlay`, since theirs arrives from
   * async detection.
   */
  const shownOverlay = useMemo(() => {
    if (videoUrl) return overlay;
    const frame = nearestPoseFrame(poseFrames, playheadT);
    return frame?.landmarks ?? overlay;
  }, [videoUrl, playheadT, overlay, poseFrames]);

  const selectedLanding = result?.landings[selected];
  const liveMoment = useMemo(
    () => (result ? liveMomentAt(result, playheadT, shownOverlay) : null),
    [result, playheadT, shownOverlay],
  );

  /**
   * Saves the selected landing as a still: the frame, the skeleton over it, the
   * numbers, and the note about what a 2D estimate is. The face is covered by
   * renderExportFrame before anything else is drawn — see face-blur.ts for why
   * that path never opens on failure — and a frame it cannot cover is refused
   * rather than written out.
   */
  const exportFrame = async () => {
    if (!result) return;
    const landing = result.landings[selected];
    if (!landing) return;
    setExporting(true);
    setExportNote(null);
    try {
      await jumpTo(landing.tContact);
      const videoT = videoTimeFromAnalysis(landing.tContact, clockFactor, analysisOffsetS);
      const lookupT = videoUrl ? videoT : landing.tContact;
      const frameIndex = poseFrames.reduce(
        (best, frame, i) =>
          Math.abs(frame.t - lookupT) < Math.abs(poseFrames[best].t - lookupT)
            ? i
            : best,
        0,
      );
      const rendered = await renderExportFrame({
        video: videoUrl ? videoRef.current : null,
        frames: poseFrames,
        frameIndex,
        hud: buildHudFrame(result, landing, selected + 1),
        coverFace: faceHidden,
      });
      if (!rendered) {
        setExportNote(
          "이 프레임은 얼굴을 가리지 못해 내보내지 않았습니다. 다른 착지를 골라 보세요.",
        );
        return;
      }
      // Say which rung of the fail-closed ladder answered. Without it there is
      // no way to tell a sample session from a mosaic that did not run.
      setExportNote(`저장했습니다 · ${FACE_COVER_LABEL[rendered.faceCover]}`);
      const url = URL.createObjectURL(rendered.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stride-lab-착지${selected + 1}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportNote("이미지를 만들지 못했습니다. 영상을 다시 불러와 주세요.");
    } finally {
      setExporting(false);
    }
  };

  const jumpTo = async (analysisT: number) => {
    setPlayheadT(analysisT);
    const video = videoRef.current;
    const videoT = videoTimeFromAnalysis(analysisT, clockFactor, analysisOffsetS);
    if (video && videoUrl) {
      await seekVideo(video, videoT);
      video.pause();
      setVideoPlaying(false);
    }
    const frame = nearestPoseFrame(
      poseFrames,
      videoUrl ? videoT : analysisT,
    );
    if (frame?.landmarks) {
      setOverlay(frame.landmarks);
      return;
    }
    if (!video) {
      setOverlay(null);
      return;
    }
    try {
      const landmarker = await getPoseLandmarker();
      const det = landmarker.detect(video);
      setOverlay(det.landmarks[0] ?? null);
    } catch {
      setOverlay(null);
    }
  };

  const toggleLivePlay = async () => {
    const video = videoRef.current;
    if (video && videoUrl) {
      if (video.paused) await video.play();
      else video.pause();
      setVideoPlaying(!video.paused);
      return;
    }
    setDemoPlaying((playing) => !playing);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !result || !videoUrl) return;

    const apply = () => {
      const analysisT = analysisTimeFromVideo(video.currentTime, clockFactor, analysisOffsetS);
      setPlayheadT(analysisT);
      // poseFrames are timed from the start of the analysed window, which is
      // the start of the clip for a browser pass and wherever Sports2D was
      // told to begin for an imported one.
      const frame = nearestPoseFrame(poseFrames, video.currentTime - analysisOffsetS);
      if (frame?.landmarks) setOverlay(frame.landmarks);
    };

    video.addEventListener("timeupdate", apply);
    video.addEventListener("seeked", apply);
    const onPlay = () => {
      setVideoPlaying(true);
      apply();
    };
    const onPause = () => setVideoPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    let raf = 0;
    const tick = () => {
      if (!video.paused) apply();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("timeupdate", apply);
      video.removeEventListener("seeked", apply);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [result, videoUrl, clockFactor, poseFrames, analysisOffsetS]);

  useEffect(() => {
    if (!demoPlaying || videoUrl || !result) return;
    const duration = result.series.at(-1)?.t ?? 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayheadT((time) => {
        if (duration <= 0) return time;
        const next = time + dt;
        return next > duration ? 0 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [demoPlaying, videoUrl, result]);

  // Follow the landing being played, without an effect: adjusting state during
  // render is the supported way to react to a changing value, and it does not
  // commit an extra frame the way setState-in-effect does. `followedIndex`
  // remembers what playback last moved to, so a landing the runner clicked
  // stays selected until playback reaches a different one.
  const playingIndex =
    liveMoment?.phase === "stance" && liveMoment.landingIndex >= 0
      ? liveMoment.landingIndex
      : -1;
  const [followedIndex, setFollowedIndex] = useState(-1);
  if (playingIndex >= 0 && playingIndex !== followedIndex) {
    setFollowedIndex(playingIndex);
    setSelected(playingIndex);
  }

  const summary = useMemo(() => {
    if (!result?.landings.length) return null;
    const scores = result.landings.map((l) => l.damageScore);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const worst = result.landings.reduce((a, b) => (a.damageScore >= b.damageScore ? a : b));
    return { avg, worst, count: result.landings.length };
  }, [result]);

  // Rendered bare before a run and folded into a <details> after one. It used
  // to be one <details> with display:contents and no <summary> until the run
  // finished, which made Chrome draw its own — the stray "▼ 세부정보" that sat
  // above the form on a page that had no details to show yet.
  const runnerSetup = (
  <Card>
    <CardHeader className="border-b border-border pb-4">
      <CardTitle className="text-base font-semibold text-foreground">러너 세팅</CardTitle>
      <CardDescription>
        신체 정보와 촬영 조건을 맞추면 영상의 픽셀을 실제 움직임으로 바꿀 수 있습니다.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {/* Units sit inside the field, the way the pace row already did it. They
          used to be in the label here and in the field there, which is two
          conventions in one form. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="stature">키</Label>
          <div className="relative">
            <Input
              id="stature"
              type="number"
              min={120}
              max={220}
              value={statureCm}
              onChange={(e) => setStatureCm(Number(e.target.value) || 170)}
              className="pr-10"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
              cm
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mass">체중</Label>
          <div className="relative">
            <Input
              id="mass"
              type="number"
              min={30}
              max={160}
              value={massKg}
              onChange={(e) => setMassKg(Number(e.target.value) || 70)}
              className="pr-10"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
              kg
            </span>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pace-minutes">
          실제 페이스 <span className="text-muted-foreground">(선택)</span>
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <Input
              id="pace-minutes"
              inputMode="numeric"
              type="number"
              min={2}
              max={15}
              placeholder="5"
              value={paceMinutes}
              onChange={(event) => setPaceMinutes(event.target.value)}
              className="pr-10"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
              분
            </span>
          </div>
          <div className="relative">
            <Input
              inputMode="numeric"
              type="number"
              min={0}
              max={59}
              placeholder="30"
              value={paceSeconds}
              onChange={(event) => setPaceSeconds(event.target.value)}
              className="pr-12"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
              초/km
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          영상만으로 수평 속도를 재면 카메라 패닝에 속습니다. 알고 있다면
          입력한 페이스를 요약의 기준으로 사용합니다.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="slowmo">촬영 배속</Label>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 4, 8].map((factor) => (
            <Button
              key={factor}
              id={factor === 0 ? "slowmo" : undefined}
              size="sm"
              variant={slowMotionFactor === factor ? "default" : "outline"}
              onClick={() => {
                setSlowMotionFactor(factor);
                setSuggestedSlowMotion(null);
              }}
            >
              {factor === 0 ? "자동" : factor === 1 ? "일반" : `${factor}배`}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {slowMotionFactor === 0 && detectedSlowMotion
            ? detectedSlowMotion === 1
              ? "일반 속도 영상으로 판정했습니다."
              : `${detectedSlowMotion}배 슬로우 모션으로 판정했습니다. 틀렸다면 직접 골라 주세요.`
            : "240fps 슬로우 모션이면 8배입니다. 일반 속도로 찍었다면 반드시 바꿔야 접지·체공 시간과 페이스가 맞습니다."}
        </p>
        {suggestedSlowMotion ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span>
              이 영상은 사람이 낼 수 없는 보행이 됩니다.{" "}
              {suggestedSlowMotion === 1
                ? "일반 속도"
                : `${suggestedSlowMotion}배 슬로우`}
              가 맞아 보입니다.
            </span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setSlowMotionFactor(suggestedSlowMotion);
                setSuggestedSlowMotion(null);
              }}
            >
              바꾸고 다시 분석
            </Button>
          </div>
        ) : null}
      </div>
      <Button size="lg" onClick={analyze} disabled={status === "analyzing" || status === "loading-model"}>
        {status === "loading-model"
          ? "자세 모델 준비 중…"
          : status === "analyzing"
            ? "착지 분석 중…"
            : "세션 분석 시작 →"}
      </Button>
      {status === "analyzing" || status === "loading-model" ? (
        <div className="space-y-2">
          <Progress value={status === "loading-model" ? 8 : progress} />
          <p className="text-xs text-muted-foreground">
            접지·체공 시간을 재려고 초당 최대 {MAX_FPS}장까지 촘촘히 훑습니다.
            앞 {MAX_SECONDS}초가 대상입니다.
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
        <li>힘판이 아니라 2D 영상 추정입니다. 의료·훈련 처방이 아닙니다.</li>
        <li>카메라가 크게 움직이거나 사람이 작게 나오면 오차가 커집니다.</li>
      </ul>
    </CardContent>
  </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card>
          {/* With footage the box is the shape of the footage. Empty, it grows
              to whatever height the row has instead of holding a 16:9 hole:
              beside a taller settings card, a fixed aspect ratio left a third
              of the card blank under the drop target. */}
          <div
            className={cn(
              "relative transition",
              videoUrl || cameraOn || (status === "done" && Boolean(result))
                ? "aspect-video bg-neutral-900"
                : "m-3 flex min-h-64 flex-1 rounded-xl border-2 border-dashed border-border bg-secondary/40",
              dragging && "border-primary bg-accent",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              stopCamera();
              onFile(e.dataTransfer.files);
            }}
          >
            <video
              ref={videoRef}
              src={cameraOn ? undefined : videoUrl ?? undefined}
              className={cn(
                "h-full w-full object-contain",
                !videoUrl && !cameraOn && "hidden",
              )}
              playsInline
              controls={!cameraOn && Boolean(videoUrl)}
              muted
              onError={() => {
                if (!videoUrl) return;
                setStatus("error");
                setError(
                  "브라우저가 이 영상을 재생하지 못했습니다. iPhone HEVC(.mov)라면 MP4(H.264)로 변환해 올려 주세요.",
                );
              }}
            />
            {status === "done" && result && !videoUrl && !cameraOn ? (
              <PoseSketch
                landmarks={shownOverlay}
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              <PoseOverlay
                videoRef={videoRef}
                landmarks={shownOverlay}
                faceFrom={needsPreviewFace ? previewFace : shownOverlay}
                coverFace={faceHidden && (Boolean(videoUrl) || cameraOn)}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              />
            )}
            {!videoUrl && !cameraOn && status !== "done" ? (
              <label className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl px-6 text-center transition-colors hover:bg-secondary/70">
                <input
                  type="file"
                  accept="video/*,.mp4,.mov,.m4v,.webm"
                  className="sr-only"
                  onChange={(e) => {
                    onFile(e.target.files);
                    e.target.value = "";
                  }}
                />
                <span className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                  <UploadCloud className="size-5" aria-hidden />
                </span>
                <span className="text-sm font-medium text-foreground">
                  영상을 끌어다 놓거나 눌러서 고르세요
                </span>
                <span className="max-w-xs text-xs leading-5 text-muted-foreground">
                  전신이 나오는 러닝 영상. 옆모습이 무릎 각도를 더 잘 잡습니다.
                </span>
                {/* What an uploader is expected to tell you before you go and
                    find a file: what it takes, and how much of it it reads. */}
                <span className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
                  <span>MP4 · MOV · WebM</span>
                  <span aria-hidden className="text-border">·</span>
                  <span>앞 {MAX_SECONDS}초 분석</span>
                  <span aria-hidden className="text-border">·</span>
                  <span>업로드 없음</span>
                </span>
                {OFFER_TRC_IMPORT ? (
                  <span className="text-meta text-muted-foreground">
                    Sports2D 결과를 볼 때는 `_px_….trc` 와 `_calib.toml` 을 함께 놓으세요
                  </span>
                ) : null}
              </label>
            ) : null}
            {recording ? (
              <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1 text-xs font-medium text-white">
                <span className="size-2 animate-pulse rounded-full bg-white" />
                녹화 중
              </div>
            ) : null}
          </div>
          <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-micro tracking-[0.18em] text-muted-foreground uppercase">
                01 / Source clip
              </p>
              {/* The line that used to live here also said "playing it follows
                  along on the right", which is the sentence the live-frame card
                  opens with. Once is enough. */}
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {exportNote ??
                  fileName ??
                  (cameraOn ? "카메라 미리보기" : "선택된 영상 없음")}
              </p>
              {/* A report built from a TRC is not a report of this browser's
                  measurement, and nothing else on screen would say so. */}
              {trcNote ? (
                <p className="mt-1 font-mono text-meta leading-4 break-words text-muted-foreground">
                  {trcNote}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {videoUrl || cameraOn ? (
                <Button
                  size="sm"
                  variant={faceHidden ? "secondary" : "outline"}
                  aria-pressed={faceHidden}
                  onClick={() => setFaceHidden((on) => !on)}
                >
                  {faceHidden ? <EyeOff /> : <Eye />}
                  {faceHidden ? "얼굴 가림" : "얼굴 보임"}
                </Button>
              ) : null}
              {status === "done" && result?.landings.length ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  onClick={() => {
                    void exportFrame();
                  }}
                >
                  <ImageDown />
                  {exporting ? "만드는 중" : "이 착지 저장"}
                </Button>
              ) : null}
              <label className={buttonVariants({ variant: "outline", size: "sm" })}>
                파일 선택
                <input
                  type="file"
                  accept="video/*,.mp4,.mov,.m4v,.webm"
                  className="sr-only"
                  onChange={(e) => {
                    stopCamera();
                    onFile(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              {OFFER_TRC_IMPORT && runs && runs.length > 0 && !cameraOn
                ? runs.map((run) => (
                    <Button
                      key={run.id}
                      size="sm"
                      variant="secondary"
                      disabled={loadingRun !== null}
                      title={`${run.name} · ${run.frames}프레임 · ${run.rate} fps`}
                      onClick={() => {
                        void loadRun(run.id);
                      }}
                    >
                      {loadingRun === run.id
                        ? "읽는 중"
                        : `Sports2D ${run.id} · ${run.frames}f`}
                    </Button>
                  ))
                : null}
              {OFFER_TRC_IMPORT && !cameraOn ? (
                <label
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                  title={
                    "Sports2D 출력 폴더에서 ..._px_....trc 와 ..._calib.toml 을 " +
                    "같이 고르세요. 두 파일을 끌어다 놓아도 됩니다."
                  }
                >
                  TRC + calib 고르기
                  <input
                    type="file"
                    multiple
                    accept=".trc,.toml"
                    className="sr-only"
                    onChange={(e) => {
                      void importSports2d(
                        Array.from(e.target.files ?? []).filter((file) =>
                          isImportCandidate(file.name),
                        ),
                      );
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : null}
              {cameraOn ? (
                <>
                  <Button size="sm" variant={recording ? "destructive" : "default"} onClick={toggleRecord}>
                    {recording ? "녹화 종료" : "3~8초 녹화"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={stopCamera}>
                    카메라 끄기
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="secondary" onClick={startCamera}>
                  카메라로 찍기
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-4">
          {status === "done" && result && liveMoment ? (
            <LiveReadout
              result={result}
              moment={liveMoment}
              playing={videoUrl ? videoPlaying : demoPlaying}
              canPlay
              onTogglePlay={() => {
                void toggleLivePlay();
              }}
              onSeek={(time) => {
                void jumpTo(time);
              }}
            />
          ) : null}

        {status === "done" && result ? (
          <details className="rounded-card border border-border bg-white">
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
              러너 세팅 바꾸기
            </summary>
            {runnerSetup}
          </details>
        ) : (
          runnerSetup
        )}
        </div>
      </div>

      {status === "done" && result ? (
        <AnalysisDetailsProvider>
        <div className="flex flex-col gap-6">
        <SessionSummaryCard
          result={result}
          label={fileName ?? "세션"}
          onSelectPeak={(index) => {
            setSelected(index);
            const landing = result.landings[index];
            if (landing) void jumpTo(landing.tContact);
          }}
        />
        <AnalysisDetails>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>추정 지면반력</CardTitle>
                <CardDescription>1 BW는 가만히 서 있을 때의 체중 하중입니다. 세로 선은 착지 순간입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                {result.warnings.map((warning, index) => (
                  <p
                    key={`${index}-${warning}`}
                    className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  >
                    {warning}
                  </p>
                ))}
                {summary && result.quality.level !== "poor" ? (
                  <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">착지 횟수</p>
                      <p className="text-lg font-semibold tabular-nums">{summary.count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">평균 점수</p>
                      <p className="text-lg font-semibold tabular-nums">{Math.round(summary.avg)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">가장 센 착지</p>
                      {/* Every landing card reads "착지 N · 점수 M". Printing the
                          score first here made it read as a landing number, and
                          the two are often the same value. */}
                      <p className="text-lg font-semibold tabular-nums">
                        {formatSeconds(summary.worst.tContact)} · 점수{" "}
                        {summary.worst.damageScore}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mb-4 text-sm text-muted-foreground">
                    {result.landings.length
                      ? "촬영 품질이 부족해 착지 점수와 반력 숫자는 표시하지 않습니다."
                      : "착지가 감지되지 않았습니다."}
                  </p>
                )}
                {result.quality.level === "poor" ? (
                  <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
                    촬영 품질이 부족해 지면반력 곡선을 표시하지 않습니다.
                  </div>
                ) : (
                  <ImpactChart
                    series={result.series}
                    landingTimes={result.landings.map((l) => l.tContact)}
                    selectedTime={selectedLanding?.tContact ?? null}
                    onSelectTime={(t) => {
                      void jumpTo(t);
                    }}
                  />
                )}
              </CardContent>
            </Card>
            {result.cameraView === "front" ? (
              <FrontalAlignment
                landings={result.landings}
                trusted={result.quality.level !== "poor"}
              />
            ) : null}
            {result.quality.level !== "poor" ? (
              <SideBreakdown summary={buildSessionSummary(result)} />
            ) : null}
            {selectedLanding && result.quality.level !== "poor" ? (
              <InjuryGuidance landing={selectedLanding} />
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            {result.landings.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>결과 없음</CardTitle>
                  <CardDescription>
                    발이 땅에서 떨어졌다가 닿는 구간이 보여야 합니다. 제자리 구보처럼 반복 착지가 뚜렷한 장면이 더 잘 잡힙니다.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              result.landings.map((landing, i) => (
                <LandingCard
                  key={`${landing.tContact}-${i}`}
                  landing={landing}
                  order={i + 1}
                  selected={i === selected}
                  trusted={result.quality.level !== "poor"}
                  onSelect={() => {
                    setSelected(i);
                    void jumpTo(landing.tContact);
                  }}
                />
              ))
            )}
            {/* Last in the column on purpose: it explains the numbers above it,
                and it is the same table whatever the clip turned out to be —
                including a clip that was refused, where the reader most wants
                to know which boundary refused it. */}
            <ThresholdEvidence />
          </div>
        </div>
        </AnalysisDetails>
        {/* Outside the collapsible, unlike everything above it. The details
            section renders nothing while it is shut, and it starts shut, so a
            comparison placed inside it existed and was never seen — which is
            indistinguishable from a comparison that failed to appear. This is
            an answer to a question that was just asked, not detail to expand
            into. */}
        {OFFER_TRC_IMPORT && passes.browser && passes.sports2d ? (
          <PipelineCompare browser={passes.browser} sports2d={passes.sports2d} />
        ) : null}
        </div>
        </AnalysisDetailsProvider>
      ) : null}
    </div>
  );
}
