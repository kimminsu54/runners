import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Download, FileText } from "lucide-react";
import Link from "next/link";

const FILES = [
  {
    name: "Readme.md",
    kind: "문서 · MD",
    href: "/downloads/Readme.md",
    note: "A-1 · A-2 · A-3 설명",
  },
  {
    name: "Footstrike.ts",
    kind: "TS",
    href: "/downloads/Footstrike.ts",
    note: "주법 판정. 바깥 구간 먼저, NaN은 unknown",
  },
  {
    name: "Shoeranking.ts",
    kind: "TS",
    href: "/downloads/Shoeranking.ts",
    note: "Nike → Asics → Adidas. unknown은 general",
  },
  {
    name: "Footstrike.test.ts",
    kind: "TS",
    href: "/downloads/Footstrike.test.ts",
    note: "경계값 9개",
  },
  {
    name: "Shoeranking.test.ts",
    kind: "TS",
    href: "/downloads/Shoeranking.test.ts",
    note: "순서를 뒤집어도 같은 브랜드 순위",
  },
  {
    name: "check-language.mjs",
    kind: "MJS",
    href: "/downloads/check-language.mjs",
    note: "면책은 통과, 위반만 잡고 종료 코드 1",
  },
] as const;

export default function DownloadsPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8 sm:px-6">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link href="/" className="display-type text-xl text-foreground">
          STRIDE<span className="text-primary">/</span>LAB
        </Link>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          분석으로 돌아가기
        </Link>
      </div>

      <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
        Files / A-1 A-2 A-3
      </p>
      <h1 className="display-type mt-2 text-4xl text-foreground">파일 받기</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        주법 판정, 브랜드 순위, 금지어 검사 파일을 하나씩 받거나 한꺼번에 받을 수
        있습니다.
      </p>

      <a
        href="/downloads/stride-lab-rules.zip"
        download="stride-lab-rules.zip"
        className={cn(buttonVariants({ size: "lg" }), "mt-6 w-fit")}
      >
        <Download />
        여섯 파일 한꺼번에 받기
      </a>

      <ul className="mt-8 divide-y divide-border rounded-2xl border border-border bg-white">
        {FILES.map((file) => (
          <li
            key={file.name}
            className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                  {file.kind}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{file.note}</p>
              </div>
            </div>
            <a
              href={file.href}
              download={file.name}
              className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}
            >
              <Download />
              다운로드 및 열기
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
