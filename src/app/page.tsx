import { LandingAnalyzer } from "@/components/landing-analyzer";
import { ArrowDownRight, Circle, MoveUpRight } from "lucide-react";
import Image from "next/image";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative isolate overflow-hidden border-b border-border">
        <div className="absolute inset-0 -z-20">
          <Image
            src="/images/run-hero.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[72%_45%]"
          />
        </div>
        {/* The headline sits on the left, so the wash is opaque there and thins
            out over the runner on the right. */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-white via-white/95 to-white/75 lg:via-white/92 lg:to-white/35" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-background to-transparent" />
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-14 -z-10 h-44 w-full opacity-70"
          viewBox="0 0 1200 200"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M-20 168 C160 150 190 74 330 84 C470 94 452 178 604 166 C742 155 760 60 900 52 C1010 46 1090 92 1220 72"
            fill="none"
            stroke="#c9cfda"
            strokeWidth="2"
            strokeDasharray="3 9"
            strokeLinecap="round"
          />
          <path
            d="M-20 168 C160 150 190 74 330 84 C470 94 452 178 604 166 C742 155 760 60 900 52"
            fill="none"
            stroke="#e0402a"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="900" cy="52" r="6" fill="#e0402a" />
        </svg>

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
          <div className="rounded-full border border-border bg-white/70 px-3 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-sm sm:hidden">
            BETA 01
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl px-4 pt-10 pb-16 sm:px-6 lg:pt-16 lg:pb-28">
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
              className="group flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:rotate-6 hover:scale-105"
              aria-label="분석 시작으로 이동"
            >
              <ArrowDownRight className="size-6 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
            </a>
          </div>

          <div className="mt-12 flex flex-wrap items-end gap-x-10 gap-y-6 rounded-2xl border border-border bg-white/75 px-5 py-4 backdrop-blur-sm sm:mt-16 lg:max-w-2xl">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                KM / Morning loop
              </p>
              <p className="display-type text-4xl text-foreground">5.24</p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                Average pace
              </p>
              <p className="font-mono text-lg text-primary">05&apos;24&quot;</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                Crew 08
              </p>
              <div className="flex -space-x-2">
                {["#e0402a", "#1f2430", "#8a93a5", "#c9cfda"].map((color, index) => (
                  <span
                    key={color}
                    className="flex size-7 items-center justify-center rounded-full border-2 border-white font-mono text-[9px] text-white"
                    style={{ backgroundColor: color }}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
            </div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              Seoul 37.5665° N
            </p>
          </div>
        </div>

        <div className="relative flex overflow-hidden border-y border-border bg-primary py-2 text-primary-foreground">
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

      <footer className="border-t border-border bg-white">
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
