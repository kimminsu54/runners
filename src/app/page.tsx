import { LandingAnalyzer } from "@/components/landing-analyzer";
import { ArrowDownRight, Circle, MoveUpRight } from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-white">
      <header className="relative border-b border-border">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="display-type flex items-baseline gap-2 text-xl text-foreground">
            STRIDE<span className="text-primary">/</span>LAB
          </div>
          <div className="hidden items-center gap-6 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase sm:flex">
            <span>Form analysis</span>
            <span>Community pace</span>
            <span className="flex items-center gap-2 text-emerald-600">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Model online
            </span>
          </div>
          <div className="rounded-full border border-border px-3 py-1 font-mono text-[10px] text-muted-foreground sm:hidden">
            BETA 01
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pt-8 pb-10 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:pt-12 lg:pb-14">
          <div className="relative z-10">
            <div className="mb-5 flex items-center gap-3 font-mono text-[10px] tracking-[0.2em] text-primary uppercase">
              <span>Run together</span>
              <span className="h-px w-12 bg-primary" />
              <span>Land better</span>
            </div>
            <h1 className="display-type max-w-4xl text-[clamp(3.5rem,9vw,8rem)] leading-[0.82] text-foreground uppercase">
              같이 달리고,
              <br />
              <span className="text-primary">더 잘</span> 착지한다.
            </h1>
            <div className="mt-7 grid max-w-2xl gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
              <p className="max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
                한 사람의 착지를 숫자로만 보지 않습니다. 러닝 영상 속 리듬을 읽고,
                반복되는 충격과 발의 주법을 한 장의 세션 리포트로 만듭니다.
              </p>
              <a
                href="#analyze"
                className="group flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:rotate-6 hover:scale-105"
                aria-label="분석 시작으로 이동"
              >
                <ArrowDownRight className="size-6 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
              </a>
            </div>
          </div>

          <div className="route-grid relative min-h-72 overflow-hidden rounded-2xl border border-border bg-neutral-50 p-5 sm:min-h-96">
            <div className="absolute top-5 left-5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              Community run / Seoul 37.5665° N
            </div>
            <div className="absolute top-5 right-5 flex -space-x-2">
              {["#e0402a", "#1f2430", "#8a93a5", "#c9cfda"].map((color, index) => (
                <span
                  key={color}
                  className="flex size-8 items-center justify-center rounded-full border-2 border-white font-mono text-[9px] text-white"
                  style={{ backgroundColor: color }}
                >
                  {index + 1}
                </span>
              ))}
            </div>
            <svg
              viewBox="0 0 480 300"
              className="absolute inset-x-3 bottom-5 h-[75%] w-[calc(100%-1.5rem)]"
              aria-hidden
            >
              <path
                d="M34 231 C82 221 72 153 127 163 C179 172 159 249 218 232 C270 216 217 90 290 80 C351 71 326 180 377 173 C419 167 410 103 452 75"
                fill="none"
                stroke="#c9cfda"
                strokeWidth="2"
                strokeDasharray="3 8"
                strokeLinecap="round"
              />
              <path
                d="M34 231 C82 221 72 153 127 163 C179 172 159 249 218 232 C270 216 217 90 290 80"
                fill="none"
                stroke="#e0402a"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <circle cx="34" cy="231" r="8" fill="#1f2430" />
              <circle cx="290" cy="80" r="8" fill="#e0402a" />
            </svg>
            <div className="absolute bottom-5 left-5">
              <p className="display-type text-5xl text-foreground">5.24</p>
              <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                KM / Morning loop
              </p>
            </div>
            <div className="absolute right-5 bottom-5 text-right">
              <p className="font-mono text-xs text-primary">PACE 05&apos;24&quot;</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">CREW 08</p>
            </div>
          </div>
        </div>

        <div className="flex overflow-hidden border-y border-border bg-primary py-2 text-primary-foreground">
          <div className="flex min-w-max items-center gap-5 font-mono text-[11px] font-semibold tracking-[0.14em] uppercase">
            {["Upload the run", "Read the rhythm", "Know your landing", "Train with intent"].map(
              (item) => (
                <span key={item} className="flex items-center gap-5">
                  {item} <Circle className="size-2 fill-current" />
                </span>
              ),
            )}
          </div>
        </div>
      </header>

      <main id="analyze" className="mx-auto w-full max-w-7xl flex-1 px-4 py-12 sm:px-6 lg:py-16">
        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 font-mono text-[10px] tracking-[0.2em] text-primary uppercase">
              Session 01 / Form check
            </p>
            <h2 className="display-type text-4xl text-foreground sm:text-5xl">
              오늘의 러닝을 읽어보세요.
            </h2>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <MoveUpRight className="size-4 text-primary" />
            영상은 브라우저 안에서만 처리됩니다
          </div>
        </div>
        <LandingAnalyzer />
      </main>

      <footer className="border-t border-border bg-neutral-50">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="display-type text-2xl text-foreground">STRIDE/LAB</p>
            <p className="mt-1 text-xs text-muted-foreground">
              RUN WITH PEOPLE. TRAIN WITH CONTEXT.
            </p>
          </div>
          <p className="max-w-xl text-xs leading-5 text-muted-foreground sm:text-right">
            영상 기반 추정은 힘판·IMU 측정과 다릅니다. 카메라 각도, 가려짐, 프레임률을
            품질 점수에 반영하며 불확실한 경우 숫자를 표시하지 않습니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
