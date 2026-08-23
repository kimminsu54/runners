import { LandingAnalyzer } from "@/components/landing-analyzer";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-white/10 bg-black/20">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 sm:px-6">
          <p className="text-xs font-medium tracking-[0.2em] text-amber-400 uppercase">
            Landing impact lab
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
            뛰는 영상으로 착지 충격을 가늠합니다
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
            관절 위치를 프레임마다 추적해 무게중심이 얼마나 빠르게 내려오다 멈추는지 봅니다.
            그 감속으로부터 체중 배수 지면반력, 흡수 시간, 무릎이 얼마나 굽혀졌는지를 추정합니다.
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <LandingAnalyzer />
      </main>
      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
        추정값은 카메라 각도·렌즈 왜곡·가려짐에 민감합니다. 힘판·IMU 측정과 같지는 않습니다.
      </footer>
    </div>
  );
}
