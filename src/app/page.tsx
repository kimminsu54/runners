import { LandingAnalyzer } from "@/components/landing-analyzer";
import { ArrowRight, Footprints, LineChart, ShieldCheck, Upload } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const READS = [
  { label: "착지마다", value: "반력 · 부하율 · 무릎 각도" },
  { label: "주법 판정", value: "리어풋 · 미드풋 · 포어풋" },
  { label: "신발 추천", value: "주법과 페이스 기반" },
];

const STEPS = [
  {
    icon: Upload,
    title: "영상 올리기",
    body: "전신이 나오는 3~8초짜리 러닝 영상이면 됩니다. 옆모습이 무릎 각도를 가장 잘 잡습니다.",
  },
  {
    icon: LineChart,
    title: "브라우저가 분석",
    body: "자세를 프레임마다 추적해 접지와 체공 시간을 재고, 거기서 착지 충격을 추정합니다.",
  },
  {
    icon: Footprints,
    title: "리포트 읽기",
    body: "착지 하나하나의 수치와 주법, 그 주법에 맞는 신발까지 한 장으로 정리해 보여줍니다.",
  },
];

/** Repeated ground-reaction peaks — the shape this app actually measures. */
const GRF_TRACE =
  "M0 78 L48 78 C64 78 68 30 84 30 C100 30 104 78 120 78 L168 78 C184 78 188 22 204 22 C220 22 224 78 240 78 L288 78 C304 78 308 34 324 34 C340 34 344 78 360 78 L408 78 C424 78 428 18 444 18 C460 18 464 78 480 78 L560 78";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-ink/85 text-white backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Link href="/" className="display-type text-lg text-white">
            STRIDE<span className="text-primary">/</span>LAB
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/compare"
              className="rounded-full px-3 py-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              세션 비교
            </Link>
            <Link
              href="/downloads"
              className="rounded-full px-3 py-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              파일 받기
            </Link>
            <a
              href="#analyze"
              className="ml-2 hidden rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 sm:inline-block"
            >
              분석 시작
            </a>
          </nav>
        </div>
      </header>

      {/* A free-licence Unsplash photograph by Miguel A Amutio: marathon
          runners' legs, which is the thing this app measures — and where the
          colour the page wanted was hiding all along, in the shoes. Graded by
          scripts/grade-hero.py, which amplifies what is there rather than
          repainting it, and lays the indigo bed for the headline into the
          asset so it survives every crop. See public/images/CREDITS.md. */}
      <section className="relative isolate overflow-hidden bg-ink text-white">
        <div className="absolute inset-0 -z-20">
          <Image
            src="/images/run-hero.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[64%_62%]"
          />
        </div>
        {/* The asset carries its own dark bed down the left edge, but a narrow
            viewport crops straight past it into the legs, so the wash has to
            cover the whole frame there and only thin out once there is room
            for the headline to sit on the quiet side. */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[oklch(0.16_0.1_290/0.88)] via-[oklch(0.16_0.1_290/0.66)] to-[oklch(0.16_0.1_290/0.5)] sm:via-[oklch(0.16_0.1_290/0.28)] sm:to-transparent" />

        <div className="mx-auto w-full max-w-6xl px-4 py-section sm:px-6 lg:py-hero">
          <p className="animate-rise inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm">
            <ShieldCheck className="size-3.5 text-volt" aria-hidden />
            영상은 업로드되지 않고 브라우저 안에서만 처리됩니다
          </p>
          <h1
            className="display-type animate-rise mt-6 text-[clamp(3rem,8vw,6.5rem)] leading-[0.88] text-white"
            style={{ animationDelay: "80ms" }}
          >
            내 착지를,
            <br />
            <span className="text-primary">한 장</span>으로 읽는다.
          </h1>
          <div
            className="animate-rise mt-7 max-w-xl"
            style={{ animationDelay: "160ms" }}
          >
            <p className="text-base leading-7 text-white/75">
              러닝 영상 속 리듬을 읽고, 반복되는 충격과 발의 주법을 한 장의 세션
              리포트로 만듭니다.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#analyze"
                className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition hover:scale-[1.02] hover:opacity-95"
              >
                영상으로 시작하기
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </a>
              <Link
                href="/compare"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-sm text-white transition-colors hover:bg-white/10"
              >
                지난 세션과 비교
              </Link>
            </div>
          </div>

          {/* The trace is the measurement itself: four ground contacts, each a
              force peak, with the playhead sitting on the tallest. */}
          <div className="animate-rise mt-14 max-w-lg" style={{ animationDelay: "240ms" }}>
            <p className="mb-1 text-xs text-white/55">착지마다의 추정 지면반력</p>
            <svg viewBox="0 0 560 96" className="h-16 w-full" fill="none" aria-hidden>
              <path d={GRF_TRACE} stroke="oklch(1 0 0 / 0.16)" strokeWidth="6" strokeLinecap="round" />
              <path
                d={GRF_TRACE}
                stroke="var(--volt)"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity="0.9"
              />
              <path
                d={GRF_TRACE}
                stroke="#fff"
                strokeWidth="3.5"
                strokeLinecap="round"
                className="animate-trace"
                style={{ strokeDasharray: "22 620" }}
              />
              <circle cx="444" cy="18" r="6" fill="var(--volt)" className="animate-ping-slow" />
              <circle cx="444" cy="18" r="3.5" fill="var(--volt)" />
            </svg>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-card">
        {/* Three outputs, stated once. On a phone this was three stacked rows
            with hairlines between them, which reads as a table with no data —
            so there it is a spec list, label left and value right on one line,
            and only the wide layout gets the columns. */}
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <dl className="grid divide-y divide-border sm:hairline-grid sm:grid-cols-3 sm:divide-y-0">
            {READS.map((item) => (
              <div
                key={item.label}
                className="flex items-baseline justify-between gap-4 bg-card py-3.5 sm:block sm:px-5 sm:py-6 sm:first:pl-0 sm:last:pr-0"
              >
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-primary" />
                  {item.label}
                </dt>
                <dd className="text-sm font-medium text-foreground sm:mt-1.5">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <main
        id="analyze"
        className="mx-auto w-full max-w-6xl flex-1 scroll-mt-16 px-4 py-section sm:px-6"
      >
        <div className="mb-8 max-w-xl">
          <span className="mb-4 block h-1 w-14 rounded-full bg-gradient-to-r from-[oklch(0.4_0.19_290)] to-[oklch(0.72_0.18_45)]" />
          <h2 className="display-type text-3xl text-foreground sm:text-4xl">
            오늘의 러닝을 읽어보세요.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            키와 체중을 맞춰야 영상의 픽셀이 실제 움직임으로 바뀝니다.
          </p>
        </div>
        <LandingAnalyzer />
      </main>

      <section className="relative isolate overflow-hidden border-t border-border bg-ink text-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(55%_75%_at_88%_0%,oklch(0.68_0.19_45/0.4),transparent_65%),radial-gradient(45%_70%_at_10%_100%,oklch(0.4_0.19_290/0.45),transparent_70%)]" />
        <div className="mx-auto w-full max-w-6xl px-4 py-section sm:px-6">
          <h2 className="text-sm font-medium text-volt">어떻게 동작하나요</h2>
          <div className="mt-8 grid gap-10 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title} className="border-t border-white/15 pt-5">
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white">
                    <step.icon className="size-4" aria-hidden />
                  </span>
                  <span className="display-type text-3xl text-white/15">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-medium text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/65">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-block sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <p className="display-type text-xl text-foreground">
              STRIDE<span className="text-primary">/</span>LAB
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              읽고, 한 가지만 바꿔보세요.
            </p>
          </div>
          <p className="max-w-md text-xs leading-5 text-muted-foreground sm:text-right">
            영상 기반 추정은 힘판·IMU 측정과 다릅니다. 카메라 각도, 가려짐, 프레임률을
            품질 점수에 반영하며 불확실한 경우 숫자를 표시하지 않습니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
