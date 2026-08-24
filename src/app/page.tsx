import { LandingAnalyzer } from "@/components/landing-analyzer";
import { ArrowDownRight, Circle, MoveUpRight } from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden">
      <header className="relative border-b border-white/10">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="display-type flex items-baseline gap-2 text-xl text-[#f4ead3]">
            STRIDE<span className="text-[#f05236]">/</span>LAB
          </div>
          <div className="hidden items-center gap-6 font-mono text-[10px] tracking-[0.18em] text-[#b8ad93] uppercase sm:flex">
            <span>Form analysis</span>
            <span>Community pace</span>
            <span className="flex items-center gap-2 text-[#d3f35b]">
              <span className="size-1.5 rounded-full bg-[#d3f35b]" />
              Model online
            </span>
          </div>
          <div className="rounded-full border border-[#f4ead3]/20 px-3 py-1 font-mono text-[10px] text-[#f4ead3] sm:hidden">
            BETA 01
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pt-8 pb-10 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:pt-12 lg:pb-14">
          <div className="relative z-10">
            <div className="mb-5 flex items-center gap-3 font-mono text-[10px] tracking-[0.2em] text-[#f05236] uppercase">
              <span>Run together</span>
              <span className="h-px w-12 bg-[#f05236]" />
              <span>Land better</span>
            </div>
            <h1 className="display-type max-w-4xl text-[clamp(3.5rem,9vw,8rem)] leading-[0.82] text-[#f4ead3] uppercase">
              같이 달리고,
              <br />
              <span className="text-[#f05236]">더 잘</span> 착지한다.
            </h1>
            <div className="mt-7 grid max-w-2xl gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
              <p className="max-w-xl text-sm leading-7 text-[#b8ad93] sm:text-base">
                한 사람의 착지를 숫자로만 보지 않습니다. 러닝 영상 속 리듬을 읽고,
                반복되는 충격과 발의 주법을 한 장의 세션 리포트로 만듭니다.
              </p>
              <a
                href="#analyze"
                className="group flex size-14 items-center justify-center rounded-full bg-[#d3f35b] text-[#18200f] transition-transform hover:rotate-6 hover:scale-105"
                aria-label="분석 시작으로 이동"
              >
                <ArrowDownRight className="size-6 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
              </a>
            </div>
          </div>

          <div className="route-grid relative min-h-72 overflow-hidden border border-[#f4ead3]/15 bg-[#23271a] p-5 sm:min-h-96">
            <div className="absolute top-5 left-5 font-mono text-[10px] tracking-[0.18em] text-[#b8ad93] uppercase">
              Community run / Seoul 37.5665° N
            </div>
            <div className="absolute top-5 right-5 flex -space-x-2">
              {["#f05236", "#d3f35b", "#f4ead3", "#697455"].map((color, index) => (
                <span
                  key={color}
                  className="flex size-8 items-center justify-center rounded-full border-2 border-[#23271a] font-mono text-[9px] text-[#18200f]"
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
                stroke="#f4ead3"
                strokeWidth="2"
                strokeDasharray="3 8"
                strokeLinecap="round"
              />
              <path
                d="M34 231 C82 221 72 153 127 163 C179 172 159 249 218 232 C270 216 217 90 290 80"
                fill="none"
                stroke="#f05236"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <circle cx="34" cy="231" r="8" fill="#d3f35b" />
              <circle cx="290" cy="80" r="8" fill="#f05236" />
            </svg>
            <div className="absolute bottom-5 left-5">
              <p className="display-type text-5xl text-[#f4ead3]">5.24</p>
              <p className="font-mono text-[10px] tracking-[0.18em] text-[#b8ad93] uppercase">
                KM / Morning loop
              </p>
            </div>
            <div className="absolute right-5 bottom-5 text-right">
              <p className="font-mono text-xs text-[#d3f35b]">PACE 05&apos;24&quot;</p>
              <p className="mt-1 font-mono text-[10px] text-[#b8ad93]">CREW 08</p>
            </div>
          </div>
        </div>

        <div className="flex overflow-hidden border-t border-white/10 bg-[#f05236] py-2 text-[#17190f]">
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
        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 font-mono text-[10px] tracking-[0.2em] text-[#f05236] uppercase">
              Session 01 / Form check
            </p>
            <h2 className="display-type text-4xl text-[#f4ead3] sm:text-5xl">
              오늘의 러닝을 읽어보세요.
            </h2>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#b8ad93]">
            <MoveUpRight className="size-4 text-[#d3f35b]" />
            영상은 브라우저 안에서만 처리됩니다
          </div>
        </div>
        <LandingAnalyzer />
      </main>

      <footer className="border-t border-white/10 bg-[#11130d]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="display-type text-2xl text-[#f4ead3]">STRIDE/LAB</p>
            <p className="mt-1 text-xs text-[#766f60]">RUN WITH PEOPLE. TRAIN WITH CONTEXT.</p>
          </div>
          <p className="max-w-xl text-xs leading-5 text-[#766f60] sm:text-right">
            영상 기반 추정은 힘판·IMU 측정과 다릅니다. 카메라 각도, 가려짐, 프레임률을
            품질 점수에 반영하며 불확실한 경우 숫자를 표시하지 않습니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
