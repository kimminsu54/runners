"use client";

import { ImpactChart } from "@/components/impact-chart";
import { InjuryGuidance } from "@/components/injury-guidance";
import { LandingCard } from "@/components/landing-card";
import { PoseOverlay } from "@/components/pose-overlay";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  analyzeLandings,
  formatSeconds,
  type AnalysisResult,
} from "@/lib/landing-analysis";
import type { Landmark } from "@/lib/pose";
import { getPoseLandmarker, seekVideo, waitMetadata } from "@/lib/pose-engine";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "idle" | "loading-model" | "analyzing" | "done" | "error";

const MAX_SECONDS = 18;
const TARGET_FPS = 24;

export function LandingAnalyzer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [statureCm, setStatureCm] = useState(170);
  const [massKg, setMassKg] = useState(70);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [overlay, setOverlay] = useState<Landmark[] | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!videoUrl) return;
    return () => URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    const stream = streamRef.current;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const attachFile = useCallback((file: File) => {
    setResult(null);
    setError(null);
    setStatus("idle");
    setSelected(0);
    setOverlay(null);
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
      const n = Math.min(Math.round(duration * TARGET_FPS), 420);
      const frames = [];
      for (let i = 0; i < n; i++) {
        const t = (i / Math.max(1, n - 1)) * duration;
        await seekVideo(video, t);
        const det = landmarker.detect(video);
        frames.push({ t, landmarks: det.landmarks[0] ?? null });
        if (i % 2 === 0) setProgress(Math.round(((i + 1) / n) * 100));
      }
      const analysis = analyzeLandings(frames, {
        statureM: statureCm / 100,
        massKg,
        width: video.videoWidth || 640,
        height: video.videoHeight || 360,
      });
      setResult(analysis);
      setSelected(0);
      setStatus("done");
      setProgress(100);
      if (analysis.landings[0]) {
        await seekVideo(video, analysis.landings[0].tContact);
        video.pause();
        const det = landmarker.detect(video);
        setOverlay(det.landmarks[0] ?? null);
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "분석에 실패했습니다.");
    }
  };

  const selectedLanding = result?.landings[selected];

  const jumpTo = async (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    await seekVideo(video, t);
    video.pause();
    try {
      const landmarker = await getPoseLandmarker();
      const det = landmarker.detect(video);
      setOverlay(det.landmarks[0] ?? null);
    } catch {
      setOverlay(null);
    }
  };

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
        <Card className="overflow-hidden bg-card/80">
          <div
            className={cn(
              "relative aspect-video bg-black transition",
              dragging && "ring-2 ring-amber-400 ring-inset",
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
              className="h-full w-full object-contain"
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
            <PoseOverlay
              videoRef={videoRef}
              landmarks={overlay}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            />
            {!videoUrl && !cameraOn ? (
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
                <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-medium text-amber-300">
                  영상 업로드
                </span>
                <span className="max-w-sm text-sm text-zinc-300">
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

        <Card>
          <CardHeader>
            <CardTitle>신체 정보</CardTitle>
            <CardDescription>
              키는 픽셀을 미터로 바꿀 때, 체중은 뉴턴 단위 힘을 가늠할 때 씁니다. 대략 값이면 충분합니다.
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
            <Button size="lg" onClick={analyze} disabled={status === "analyzing" || status === "loading-model"}>
              {status === "loading-model"
                ? "자세 모델 준비 중…"
                : status === "analyzing"
                  ? "착지 분석 중…"
                  : "착지 충격 분석"}
            </Button>
            {status === "analyzing" || status === "loading-model" ? (
              <div className="space-y-2">
                <Progress value={status === "loading-model" ? 8 : progress} />
                <p className="text-xs text-muted-foreground">
                  브라우저에서 프레임마다 관절을 추적합니다. 앞 {MAX_SECONDS}초까지 봅니다.
                </p>
              </div>
            ) : null}
            {error ? (
              <p className="rounded-lg bg-destructive/15 px-3 py-2 text-sm text-destructive">{error}</p>
            ) : null}
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>힘판이 아니라 2D 영상 추정입니다. 의료·훈련 처방이 아닙니다.</li>
              <li>카메라가 크게 움직이거나 사람이 작게 나오면 오차가 커집니다.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {status === "done" && result ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>추정 지면반력</CardTitle>
                <CardDescription>1 BW는 가만히 서 있을 때의 체중 하중입니다. 세로 선은 착지 순간입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                {result.warnings.map((w) => (
                  <p key={w} className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    {w}
                  </p>
                ))}
                {summary ? (
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
                  <p className="mb-4 text-sm text-muted-foreground">착지가 감지되지 않았습니다.</p>
                )}
                <ImpactChart
                  series={result.series}
                  landingTimes={result.landings.map((l) => l.tContact)}
                  selectedTime={selectedLanding?.tContact ?? null}
                  onSelectTime={(t) => {
                    void jumpTo(t);
                  }}
                />
              </CardContent>
            </Card>
            {selectedLanding ? (
              <InjuryGuidance landing={selectedLanding} />
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            {result.landings.length === 0 ? (
              <Card>
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
                  onSelect={() => {
                    setSelected(i);
                    void jumpTo(landing.tContact);
                  }}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
