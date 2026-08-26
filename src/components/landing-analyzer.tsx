"use client";

import { AnalysisDetails, AnalysisDetailsProvider } from "@/components/analysis-details";
import { ImpactChart } from "@/components/impact-chart";
import { InjuryGuidance } from "@/components/injury-guidance";
import { LandingCard } from "@/components/landing-card";
import { LiveReadout } from "@/components/live-readout";
import { SessionSummaryCard } from "@/components/session-summary";
import { PoseOverlay, PoseSketch } from "@/components/pose-overlay";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  analyzeLandings,
  analyzeLandingsAuto,
  formatSeconds,
  type AnalysisResult,
  type PoseFrame,
} from "@/lib/landing-analysis";
import {
  analysisTimeFromVideo,
  liveMomentAt,
  nearestPoseFrame,
  videoTimeFromAnalysis,
} from "@/lib/live-readout";
import type { Landmark } from "@/lib/pose";
import { getPoseLandmarker, seekVideo, waitMetadata } from "@/lib/pose-engine";
import { syntheticRunningFrames } from "@/lib/synthetic-jump";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "idle" | "loading-model" | "analyzing" | "done" | "error";

const MAX_SECONDS = 18;
// Sprint stance lasts about 100 ms, so sample far above video frame rate when
// the clip is short enough to afford it.
const FRAME_BUDGET = 540;
const MIN_FPS = 24;
const MAX_FPS = 60;

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
  const poseFramesRef = useRef<PoseFrame[]>([]);
  const clockFactor =
    detectedSlowMotion && detectedSlowMotion > 0 ? detectedSlowMotion : 1;

  useEffect(() => {
    if (!videoUrl) return;
    return () => URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("demo") !== "report") {
      return;
    }
    const frames = syntheticRunningFrames();
    const demo = analyzeLandings(frames, {
      statureM: 1.7,
      massKg: 70,
      width: 1280,
      height: 720,
    });
    poseFramesRef.current = frames;
    setFileName("샘플 세션");
    setResult(demo);
    setDetectedSlowMotion(1);
    setStatus("done");
    const start = demo.landings[0]?.tContact ?? 0;
    setPlayheadT(start);
    setOverlay(nearestPoseFrame(frames, start)?.landmarks ?? null);
    setDemoPlaying(true);
  }, []);

  useEffect(() => {
    const stream = streamRef.current;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const attachFile = useCallback((file: File) => {
    poseFramesRef.current = [];
    setResult(null);
    setError(null);
    setStatus("idle");
    setSelected(0);
    setOverlay(null);
    setPlayheadT(0);
    setDemoPlaying(false);
    setFileName(file.name);
    setVideoUrl(URL.createObjectURL(file));
  }, []);

  const onFile = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    const looksLikeVideo =
      file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
    if (!looksLikeVideo) {
      setError("영상 파일만 올릴 수 있습니다.");
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
      poseFramesRef.current = [];
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
      poseFramesRef.current = frames;
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
      setSelected(0);
      setStatus("done");
      setProgress(100);
      const factor = usedFactor > 0 ? usedFactor : 1;
      if (analysis.landings[0]) {
        const analysisT = analysis.landings[0].tContact;
        setPlayheadT(analysisT);
        await seekVideo(video, videoTimeFromAnalysis(analysisT, factor));
        video.pause();
        const frame = nearestPoseFrame(
          frames,
          videoTimeFromAnalysis(analysisT, factor),
        );
        setOverlay(frame?.landmarks ?? null);
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "분석에 실패했습니다.");
    }
  };

  const selectedLanding = result?.landings[selected];
  const liveMoment = useMemo(
    () => (result ? liveMomentAt(result, playheadT, overlay) : null),
    [result, playheadT, overlay],
  );

  const jumpTo = async (analysisT: number) => {
    setPlayheadT(analysisT);
    const video = videoRef.current;
    const videoT = videoTimeFromAnalysis(analysisT, clockFactor);
    if (video && videoUrl) {
      await seekVideo(video, videoT);
      video.pause();
      setVideoPlaying(false);
    }
    const frame = nearestPoseFrame(
      poseFramesRef.current,
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
      const analysisT = analysisTimeFromVideo(video.currentTime, clockFactor);
      setPlayheadT(analysisT);
      const frame = nearestPoseFrame(poseFramesRef.current, video.currentTime);
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
  }, [result, videoUrl, clockFactor]);

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

  useEffect(() => {
    if (videoUrl) return;
    const frame = nearestPoseFrame(poseFramesRef.current, playheadT);
    if (frame?.landmarks) setOverlay(frame.landmarks);
  }, [playheadT, videoUrl]);

  useEffect(() => {
    if (liveMoment?.phase === "stance" && liveMoment.landingIndex >= 0) {
      setSelected(liveMoment.landingIndex);
    }
  }, [liveMoment?.phase, liveMoment?.landingIndex]);

  const summary = useMemo(() => {
    if (!result?.landings.length) return null;
    const scores = result.landings.map((l) => l.damageScore);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const worst = result.landings.reduce((a, b) => (a.damageScore >= b.damageScore ? a : b));
    return { avg, worst, count: result.landings.length };
  }, [result]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="overflow-hidden rounded-2xl border-border bg-white">
          <div
            className={cn(
              "relative aspect-video transition",
              videoUrl || cameraOn || (status === "done" && Boolean(result))
                ? "bg-neutral-900"
                : "bg-neutral-50",
              dragging && "ring-2 ring-primary ring-inset",
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
            <div className="pointer-events-none absolute top-3 right-3 z-10 rounded-full border border-border bg-white/90 px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-muted-foreground uppercase backdrop-blur-sm">
              01 / Run clip
            </div>
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
                landmarks={overlay}
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              <PoseOverlay
                videoRef={videoRef}
                landmarks={overlay}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              />
            )}
            {!videoUrl && !cameraOn && status !== "done" ? (
              <label className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 px-6 text-center">
                <input
                  type="file"
                  accept="video/*,.mp4,.mov,.m4v,.webm"
                  className="sr-only"
                  onChange={(e) => {
                    onFile(e.target.files);
                    e.target.value = "";
                  }}
                />
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  영상 업로드
                </span>
                <span className="max-w-sm text-sm text-muted-foreground">
                  전신이 나오는 달리기·점프 영상을 끌어다 놓거나 눌러서 고르세요. 옆모습이 무릎 각도를 더 잘 잡습니다.
                </span>
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
            <p className="truncate text-sm text-muted-foreground">
              {fileName ?? (cameraOn ? "카메라 미리보기" : "선택된 영상 없음")}
              {status === "done" && result
                ? " · 재생하면 오른쪽이 그 순간을 따라갑니다"
                : ""}
            </p>
            <div className="flex flex-wrap gap-2">
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

        <details
          className={
            status === "done" && result
              ? "rounded-2xl border border-border bg-white"
              : "contents"
          }
          open={status === "done" && result ? undefined : true}
        >
          {status === "done" && result ? (
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
              러너 세팅 바꾸기
            </summary>
          ) : null}

        <Card className="rounded-2xl border-border bg-white">
          <CardHeader className="border-b border-border pb-4">
            <p className="font-mono text-[9px] tracking-[0.18em] text-primary uppercase">
              02 / Runner setup
            </p>
            <CardTitle className="display-type text-2xl text-foreground">러너 세팅</CardTitle>
            <CardDescription>
              신체 정보와 촬영 조건을 맞추면 영상의 픽셀을 실제 움직임으로 바꿀 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="stature">키 (cm)</Label>
                <Input
                  id="stature"
                  type="number"
                  min={120}
                  max={220}
                  value={statureCm}
                  onChange={(e) => setStatureCm(Number(e.target.value) || 170)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mass">체중 (kg)</Label>
                <Input
                  id="mass"
                  type="number"
                  min={30}
                  max={160}
                  value={massKg}
                  onChange={(e) => setMassKg(Number(e.target.value) || 70)}
                />
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
        </details>
        </div>
      </div>

      {status === "done" && result ? (
        <AnalysisDetailsProvider>
        <div className="flex flex-col gap-6">
        <SessionSummaryCard
          result={result}
          onSelectPeak={(index) => {
            setSelected(index);
            const landing = result.landings[index];
            if (landing) void jumpTo(landing.tContact);
          }}
        />
        <AnalysisDetails>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Card className="rounded-2xl border-border bg-white">
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
                      <p className="text-lg font-semibold tabular-nums">
                        {summary.worst.damageScore} · {formatSeconds(summary.worst.tContact)}
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
            {selectedLanding && result.quality.level !== "poor" ? (
              <InjuryGuidance landing={selectedLanding} />
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            {result.landings.length === 0 ? (
              <Card className="rounded-2xl border-border bg-white">
                <CardHeader>
                  <CardTitle>결과 없음</CardTitle>
                  <CardDescription>
                    점프 후 착지, 또는 제자리 구보처럼 발이 땅에서 떨어졌다가 닿는 장면이 더 잘 잡힙니다.
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
          </div>
        </div>
        </AnalysisDetails>
        </div>
        </AnalysisDetailsProvider>
      ) : null}
    </div>
  );
}
