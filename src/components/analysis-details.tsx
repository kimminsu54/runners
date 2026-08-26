"use client";

import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

const AnalysisDetailsContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

export function AnalysisDetailsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <AnalysisDetailsContext.Provider value={{ open, setOpen }}>
      {children}
    </AnalysisDetailsContext.Provider>
  );
}

export function useAnalysisDetailsOpen() {
  return useContext(AnalysisDetailsContext)?.open ?? true;
}

export function AnalysisDetailsButton() {
  const ctx = useContext(AnalysisDetailsContext);
  if (!ctx) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full"
      aria-expanded={ctx.open}
      onClick={() => ctx.setOpen(!ctx.open)}
    >
      {ctx.open ? "세부 분석 접기" : "세부 분석 내용 보기"}
      {ctx.open ? <ChevronUp /> : <ChevronDown />}
    </Button>
  );
}

export function AnalysisDetails({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(AnalysisDetailsContext);
  if (ctx && !ctx.open) return null;
  return <div className={className}>{children}</div>;
}
