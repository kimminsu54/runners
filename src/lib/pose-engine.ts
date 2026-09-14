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

// More than one, or `pickSubject` has nothing to choose between and the
// wrong-person switch it exists to prevent cannot be seen. Three rather than
// more: the crowded clip in this sample had the intended subject and one
// interloper in frame at once, and a fourth has not been measured.
//
// The cost is a ceiling, not a count. Timed against `numPoses: 1` on the same
// frames, three bodies cost 5-13 ms per frame on the crowded clip and nothing
// measurable on a clip with one runner, because the estimator returns 1.27
// bodies on the first and 0.98 on the second. Against a frame that spends
// ~210 ms, 123 ms of it here, that is 2-6%.
export const SUBJECT_CANDIDATES = 3;

/**
 * The three MediaPipe pose models, smallest first.
 *
 * The app ships `lite`, which the Sports2D design note calls the least
 * accurate of the three. Which of them is loaded is otherwise invisible, so
 * the names live here rather than as a path spelled into a call.
 */
export const POSE_MODELS = {
  lite: "/models/pose_landmarker_lite.task",
  full: "/models/pose_landmarker_full.task",
  heavy: "/models/pose_landmarker_heavy.task",
} as const;

export type PoseModel = keyof typeof POSE_MODELS;

/** What the app runs. */
export const SHIPPED_MODEL: PoseModel = "lite";

async function createLandmarker(
  numPoses: number = SUBJECT_CANDIDATES,
  model: PoseModel = SHIPPED_MODEL,
): Promise<PoseLandmarker> {
  const vision = await import("@mediapipe/tasks-vision");
  const files = await vision.FilesetResolver.forVisionTasks("/mediapipe");
  return vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: POSE_MODELS[model],
      delegate: "CPU",
    },
    runningMode: "IMAGE",
    numPoses,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
}

/**
 * A second estimator, for measurement only.
 *
 * `getPoseLandmarker` caches one instance because the app wants exactly one.
 * Comparing two settings wants two alive at once, so both can be asked about
 * the same frame and whatever the machine is doing at that moment applies to
 * both. Comparing whole runs instead could not answer the question: this
 * machine drifted faster run over run by more than the setting changed.
 *
 * Kept out of the cache so an experiment cannot leave the app holding an
 * estimator configured for it. The caller closes what it opens.
 */
export function createProbeLandmarker(
  numPoses: number,
  model: PoseModel = SHIPPED_MODEL,
): Promise<PoseLandmarker> {
  return createLandmarker(numPoses, model);
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
