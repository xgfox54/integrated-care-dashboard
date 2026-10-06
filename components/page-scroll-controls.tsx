"use client";

import { Button } from "@/components/ui/button";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/ui/jeju-icons";

export function PageScrollControls() {
  const move = (edge: "top" | "bottom") => {
    const page = document.scrollingElement;
    if (!page) return;
    window.scrollTo({
      top: edge === "top" ? 0 : page.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };

  return (
    <nav
      aria-label="페이지 위아래 이동"
      className="fixed top-1/2 right-2 z-(--jeju-z-sticky) flex -translate-y-1/2 flex-col gap-2 print:hidden sm:right-4"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 rounded-full text-primary shadow-(--jeju-shadow) active:translate-y-0!"
        title="최상단 이동"
        aria-label="최상단 이동"
        onClick={() => move("top")}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 rounded-full text-primary shadow-(--jeju-shadow) active:translate-y-0!"
        title="최하단 이동"
        aria-label="최하단 이동"
        onClick={() => move("bottom")}
      >
        <ChevronDownIcon />
      </Button>
    </nav>
  );
}
