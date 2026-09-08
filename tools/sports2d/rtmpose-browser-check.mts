/**
 * The whole browser RTMPose chain in TypeScript, checked against rtmlib.
 *
 * The affine already matched the reference input tensor to a tenth of a grey
 * level. This closes the loop: the same frame and box through my
 * preprocessing, the model under the WASM backend a browser would use, and my
 * own SimCC decoding — compared against rtmlib's keypoints for the same frame,
 * box and model. If the two agree the plan has no unverified code path left.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as ort from "onnxruntime-web";

const SP =
  "C:/Users/Owner/AppData/Local/Temp/claude/c--Users-Owner-ai-service/0bb35f78-1216-45b2-bc11-750a98790972/scratchpad";
const meta = JSON.parse(readFileSync(`${SP}/ref_preproc.json`, "utf8")) as {
  width: number; height: number; bbox: number[];
};
const ref = JSON.parse(readFileSync(`${SP}/ref_keypoints.json`, "utf8")) as {
  keypoints: number[][]; scores: number[];
};
const frame = new Uint8Array(readFileSync(`${SP}/ref_preproc_frame.bin`));

const IN_W = 192;
const IN_H = 256;
const PADDING = 1.25;
const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];
const SPLIT = 2;

const [x1, y1, x2, y2] = meta.bbox;
const center = [(x1 + x2) / 2, (y1 + y2) / 2];
let bw = (x2 - x1) * PADDING;
let bh = (y2 - y1) * PADDING;
if (bw > bh * (IN_W / IN_H)) bh = bw / (IN_W / IN_H);
else bw = bh * (IN_W / IN_H);
const scale = [bw, bh];

const pixel = (x: number, y: number, c: number) =>
  frame[
    (Math.min(meta.height - 1, Math.max(0, y)) * meta.width +
      Math.min(meta.width - 1, Math.max(0, x))) *
      3 +
      c
  ];
const sample = (fx: number, fy: number, c: number) => {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const dx = fx - x0;
  const dy = fy - y0;
  return (
    pixel(x0, y0, c) * (1 - dx) * (1 - dy) +
    pixel(x0 + 1, y0, c) * dx * (1 - dy) +
    pixel(x0, y0 + 1, c) * (1 - dx) * dy +
    pixel(x0 + 1, y0 + 1, c) * dx * dy
  );
};

// CHW, which is what the model wants; the reference tensor was HWC and got
// transposed later.
const data = new Float32Array(3 * IN_H * IN_W);
const sx = scale[0] / IN_W;
const sy = scale[1] / IN_H;
for (let y = 0; y < IN_H; y++) {
  for (let x = 0; x < IN_W; x++) {
    for (let c = 0; c < 3; c++) {
      const v = sample(center[0] + (x - IN_W / 2) * sx, center[1] + (y - IN_H / 2) * sy, c);
      data[c * IN_H * IN_W + y * IN_W + x] = (v - MEAN[c]) / STD[c];
    }
  }
}

ort.env.wasm.numThreads = 1;
const model = join(
  homedir(),
  ".cache/rtmlib/hub/checkpoints",
  "rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.onnx",
);
const session = await ort.InferenceSession.create(readFileSync(model), {
  executionProviders: ["wasm"],
});
const out = await session.run({
  input: new ort.Tensor("float32", data, [1, 3, IN_H, IN_W]),
});
const sxx = out.simcc_x.data as Float32Array;
const syy = out.simcc_y.data as Float32Array;
const [, K, Wx] = out.simcc_x.dims as number[];
const Wy = (out.simcc_y.dims as number[])[2];

const mine: number[][] = [];
const scores: number[] = [];
for (let k = 0; k < K; k++) {
  let bestX = 0;
  let bestXi = 0;
  for (let i = 0; i < Wx; i++) {
    const v = sxx[k * Wx + i];
    if (v > bestX) { bestX = v; bestXi = i; }
  }
  let bestY = 0;
  let bestYi = 0;
  for (let i = 0; i < Wy; i++) {
    const v = syy[k * Wy + i];
    if (v > bestY) { bestY = v; bestYi = i; }
  }
  const score = (bestX + bestY) / 2;
  // locs / split ratio, then out of the crop and back into the frame.
  const px = (bestXi / SPLIT / IN_W) * scale[0] + center[0] - scale[0] / 2;
  const py = (bestYi / SPLIT / IN_H) * scale[1] + center[1] - scale[1] / 2;
  mine.push(score > 0 ? [px, py] : [-1, -1]);
  scores.push(score);
}

let worst = 0;
let total = 0;
const NAMES: Record<number, string> = {
  15: "왼발목", 16: "오른발목", 20: "왼엄지", 21: "오른엄지", 24: "왼발꿈치", 25: "오른발꿈치",
};
console.log("키포인트   내 구현            rtmlib             차이(px)");
for (let k = 0; k < K; k++) {
  const d = Math.hypot(mine[k][0] - ref.keypoints[k][0], mine[k][1] - ref.keypoints[k][1]);
  worst = Math.max(worst, d);
  total += d;
  if (NAMES[k]) {
    console.log(
      `  ${NAMES[k].padEnd(9)}(${mine[k][0].toFixed(2).padStart(7)},${mine[k][1].toFixed(2).padStart(8)})` +
        ` (${ref.keypoints[k][0].toFixed(2).padStart(7)},${ref.keypoints[k][1].toFixed(2).padStart(8)})` +
        `  ${d.toFixed(3)}`,
    );
  }
}
// The tolerance is one SimCC bin, not one pixel. The model's output is
// quantised: a bin is half an input pixel, which here is 0.5 * 664.21/256 =
// 1.30 frame pixels, so two runtimes disagreeing by one bin on a near-tied
// argmax differ by exactly that and nothing is wrong. A first version asked
// for under a pixel — stricter than the model can express — and called a
// one-bin difference a failure.
const bin = scale[1] / IN_H / SPLIT;
const exact = mine.filter((point, k) => point[0] === ref.keypoints[k][0] && point[1] === ref.keypoints[k][1]).length;
console.log(`26개 전체: 평균 ${(total / K).toFixed(3)}px · 최대 ${worst.toFixed(3)}px`);
console.log(`SimCC 한 칸 = ${bin.toFixed(3)}px · 정확히 일치 ${exact}/${K}`);
console.log(
  worst <= bin * 1.01
    ? "→ 전체 사슬이 rtmlib과 일치합니다 (최대 한 칸, 니어타이 argmax 차이)"
    : "→ 불일치. 디코딩이나 전처리를 다시 봐야 합니다",
);
