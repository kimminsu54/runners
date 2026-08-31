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

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Link href="/" className="display-type text-lg text-foreground">
            STRIDE<span className="text-primary">/</span>LAB
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/compare"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              세션 비교
            </Link>
            <Link
              href="/downloads"
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              파일 받기
            </Link>
            <a
              href="#analyze"
              className="ml-2 hidden rounded-full bg-foreground px-4 py-1.5 font-medium text-background transition-opacity hover:opacity-90 sm:inline-block"
            >
              분석 시작
            </a>
          </nav>
        </div>
      </header>

      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-14 lg:py-20">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden />
              영상은 업로드되지 않고 브라우저 안에서만 처리됩니다
            </p>
            <h1 className="display-type mt-6 text-[clamp(2.75rem,6.5vw,4.5rem)] leading-[0.95] text-foreground">
              내 착지를,
              <br />
              <span className="text-primary">한 장</span>으로 읽는다.
            </h1>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              러닝 영상 속 리듬을 읽고, 반복되는 충격과 발의 주법을 한 장의 세션
              리포트로 만듭니다.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#analyze"
                className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                영상으로 시작하기
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <Link
                href="/compare"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                지난 세션과 비교
              </Link>
            </div>
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-secondary lg:aspect-[3/4] lg:w-[22rem]">
            <Image
              src="/images/run-hero.jpg"
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 22rem, 100vw"
              className="object-cover object-[68%_45%]"
            />
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <dl className="hairline-grid grid sm:grid-cols-3">
            {READS.map((item) => (
              <div key={item.label} className="bg-background px-1 py-6 sm:px-5 sm:first:pl-0 sm:last:pr-0">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="mt-1.5 text-[15px] font-medium text-foreground">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <main
        id="analyze"
        className="mx-auto w-full max-w-6xl flex-1 scroll-mt-16 px-4 py-14 sm:px-6"
      >
        <div className="mb-8 max-w-xl">
          <h2 className="display-type text-3xl text-foreground sm:text-4xl">
            오늘의 러닝을 읽어보세요.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            키와 체중을 맞춰야 영상의 픽셀이 실제 움직임으로 바뀝니다.
          </p>
        </div>
        <LandingAnalyzer />
      </main>

      <section className="border-t border-border bg-card">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-sm font-medium text-muted-foreground">어떻게 동작하나요</h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-3 sm:gap-10">
            {STEPS.map((step, index) => (
              <div key={step.title}>
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-foreground">
                    <step.icon className="size-4" aria-hidden />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-medium text-foreground">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
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
