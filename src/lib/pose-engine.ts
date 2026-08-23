import type { Landmark } from "@/lib/pose";

type PoseLandmarker = {
  detect: (image: HTMLVideoElement | HTMLCanvasElement) => {
    landmarks: Landmark[][];
  };
  close: () => void;
};

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

export async function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

async function createLandmarker(): Promise<PoseLandmarker> {
  const vision = await import("@mediapipe/tasks-vision");
  const files = await vision.FilesetResolver.forVisionTasks("/mediapipe");
  return vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: "/models/pose_landmarker_lite.task",
      delegate: "CPU",
    },
    runningMode: "IMAGE",
    numPoses: 1,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
}

export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
      resolve();
      return;
    }
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("영상을 읽는 중 오류가 났습니다."));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001));
  });
}

export async function waitMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && Number.isFinite(video.duration)) return;
  await new Promise<void>((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("영상 정보를 읽지 못했습니다."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", ok);
      video.removeEventListener("error", fail);
    };
    video.addEventListener("loadedmetadata", ok, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}
