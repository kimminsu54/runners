import { CompareSessions } from "@/components/compare-sessions";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "세션 비교 · 착지 충격 랩",
  description: "저장한 두 세션의 접지·부하율·무릎·반력 변화를 나란히 봅니다.",
};

export default function ComparePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-section sm:px-6">
      <div className="mb-8 border-b border-border pb-6">
        <p className="mb-2 font-mono text-micro tracking-[0.2em] text-primary uppercase">
          05 / Compare
        </p>
        <h1 className="display-type text-4xl text-foreground sm:text-5xl">
          바꾼 게 통했는지 봅니다.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          한 번에 한 가지만 바꾸고 같은 코스를 다시 찍으면, 그 변화가 접지·부하율·무릎에
          어떻게 나타나는지 여기서 확인할 수 있습니다. 저장된 값은 이 브라우저에만
          있습니다.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
        >
          ← 새 영상 분석하기
        </Link>
      </div>
      <CompareSessions />
    </div>
  );
}
