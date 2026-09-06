// apps/web/components/tutorial-modal.tsx
"use client";

import { useCallback, useEffect, useState } from "react";

type MobileView = "send" | "receive";

interface TutorialModalProps {
  open: boolean;
  onClose: () => void;
  /** Only needed for the mobile flow — lets the tour flip the Send/Receive
   * toggle itself as it walks through each panel. Desktop ignores these
   * (both panels are already on screen at once). */
  mobileView?: MobileView;
  setMobileView?: (view: MobileView) => void;
}

interface TourStep {
  target: string | null;
  title: string;
  body: string;
  side?: "top" | "bottom";
  /** Mobile-only: which panel should be showing before this step's target
   * is highlighted. The tour flips the toggle itself and waits for the
   * panel to actually be visible before drawing the spotlight on it. */
  switchTo?: MobileView;
}

// ---------------------------------------------------------------------------
// Desktop flow — unchanged from before. Both panels are visible side by
// side, so there's no toggle step and nothing ever needs to be switched.
// ---------------------------------------------------------------------------
const desktopSteps: TourStep[] = [
  {
    target: null,
    title: "Quick tour, I promise.",
    body: "Nine tiny steps and you'll know exactly how to move a file from one browser to another. Let's go.",
  },
  {
    target: "send-panel",
    title: "This whole box is the Sender.",
    body: "Everything you need to send a file lives in this panel — pick files, get a code, watch it fly.",
    side: "bottom",
  },
  {
    target: "receive-panel",
    title: "And this is the Receiver.",
    body: "Whoever's catching the file uses this panel — they just need the code from the sender's side.",
    side: "bottom",
  },
  {
    target: "file-dropzone",
    title: "Upload the file here.",
    body: "Drop a file in, or click to choose one from your device.",
    side: "bottom",
  },
  {
    target: "send-button",
    title: "Click this.",
    body: "This kicks the transfer off and generates your pairing code.",
    side: "top",
  },
  {
    target: null,
    title: "Your code appears",
    body: "Send this code to the receiver — any way you like, text, chat, carrier pigeon.",
    side: "bottom",
  },
  {
    target: "receive-input",
    title: "Paste the sender's code here.",
    body: "This is where the receiver drops in the code they were just sent.",
    side: "bottom",
  },
  {
    target: "receive-button",
    title: "Click the Receive button.",
    body: "This connects to the sender and starts pulling the file straight into this browser.",
    side: "top",
  },
  {
    target: null,
    title: "Done — the file's on its way!",
    body: "That's the whole trick. Nothing touched our servers — it went straight from one browser to the other.",
  },
];

// ---------------------------------------------------------------------------
// Mobile flow — only one panel is ever on screen, so the tour has to teach
// the toggle first, then flip it for you as it moves between panels.
// ---------------------------------------------------------------------------
const mobileSteps: TourStep[] = [
  {
    target: null,
    title: "Quick tour, I promise.",
    body: "A dozen quick beats and you'll know exactly how kimo works on your phone.",
  },
  {
    target: "mobile-toggle",
    title: "This flips between Sender and Receiver.",
    body: "On mobile, only one panel shows at a time — tap either side of this switch to hop over.",
    side: "bottom",
  },
  {
    target: "send-panel",
    switchTo: "send",
    title: "This is the Sender.",
    body: "Everything you need to send a file lives here — pick files, get a code, watch it fly.",
    side: "bottom",
  },
  {
    target: "receive-panel",
    switchTo: "receive",
    title: "And this is the Receiver.",
    body: "Whoever's catching the file uses this panel — they just need the code from the sender's side.",
    side: "bottom",
  },
  {
    target: null,
    switchTo: "send",
    title: "Let's actually send something.",
    body: "Hopping back over to Send so we can walk through a real transfer, start to finish.",
  },
  {
    target: "file-dropzone",
    title: "Upload the file here.",
    body: "Drop a file in, or tap to choose one from your device.",
    side: "bottom",
  },
  {
    target: "send-button",
    title: "Tap this.",
    body: "This kicks the transfer off and generates your pairing code.",
    side: "top",
  },
  {
    target: "code-area",
    title: "Your code shows up here.",
    body: "Send this code to the receiver — text it, say it out loud, however you like.",
    side: "bottom",
  },
  {
    target: "receive-input",
    switchTo: "receive",
    title: "Now, over to Receive.",
    body: "Flipping the toggle to the Receiver side — this is where that code goes.",
    side: "bottom",
  },
  {
    target: "receive-input",
    title: "Paste the sender's code here.",
    body: "Drop in the code you were just sent.",
    side: "bottom",
  },
  {
    target: "receive-button",
    title: "Tap the Receive button.",
    body: "This connects to the sender and starts pulling the file straight into this browser.",
    side: "top",
  },
  {
    target: null,
    title: "Done — that's the whole trick!",
    body: "Nothing touched our servers — it went straight from one browser to the other.",
  },
];

const SEEN_KEY = "kimo-tutorial-seen-v1";
const GAP = 10;
const CALLOUT_GAP = 16;
const CARD_ESTIMATED_HEIGHT = 220;
const CARD_WIDTH = 380;
const MOBILE_BREAKPOINT_QUERY = "(max-width: 639px)"; // matches Tailwind's `sm:` cutoff used for MobileViewToggle

export function useTutorialAutoOpen(setOpen: (open: boolean) => void) {
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(SEEN_KEY)) {
        setOpen(true);
        window.localStorage.setItem(SEEN_KEY, "1");
      }
    } catch {
      // Storage disabled / private mode
    }
  }, [setOpen]);
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const FALLBACK_RECT: Rect = { top: -9999, left: -9999, width: 0, height: 0 };

export function TutorialModal({ open, onClose, mobileView = "send", setMobileView }: TutorialModalProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Track the same breakpoint MobileViewToggle uses, so the tour picks the
  // matching flow and re-checks on rotation/resize.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const steps = isMobile ? mobileSteps : desktopSteps;
  const current = steps[step];
  const total = steps.length;
  const isFirst = step === 0;
  const isLast = step === total - 1;

  // Mobile only: if this step needs a particular panel showing first, flip
  // the toggle. Until the panel actually switches, treat the step as if it
  // had no target (a plain dimmed card) instead of drawing a spotlight
  // around a still-hidden, zero-size element.
  const pendingSwitch = Boolean(current.switchTo) && mobileView !== current.switchTo;
  const hasTarget = current.target !== null && !pendingSwitch;

  useEffect(() => {
    if (open) setStep(0);
  }, [open, isMobile]);

  useEffect(() => {
    if (!open) return;
    if (current.switchTo && setMobileView && mobileView !== current.switchTo) {
      setMobileView(current.switchTo);
    }
  }, [open, step, current.switchTo, mobileView, setMobileView]);

  const measure = useCallback(() => {
    if (!hasTarget || !current.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
    if (!el) {
      setRect(FALLBACK_RECT);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [current.target, hasTarget]);

  // Sync rect position on step change, on the mobile panel actually
  // switching, or on resize/scroll.
  useEffect(() => {
    if (!open) return;

    measure();

    const handleUpdate = () => measure();
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);

    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
    };
  }, [open, step, measure, mobileView]);

  // Handle keyboard events without altering body overflow
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !isLast) setStep((s) => s + 1);
      if (e.key === "ArrowLeft" && !isFirst) setStep((s) => s - 1);
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, isFirst, isLast]);

  if (!open) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  const box: Rect = rect
    ? {
        top: rect.top - GAP,
        left: rect.left - GAP,
        width: rect.width + GAP * 2,
        height: rect.height + GAP * 2,
      }
    : { top: vh / 2 - 40, left: vw / 2 - 40, width: 80, height: 80 };

  const spaceRight = vw - (box.left + box.width);
  const spaceLeft = box.left;

  const placeOnRight = spaceRight >= CARD_WIDTH;
  const placeOnLeft = !placeOnRight && spaceLeft >= CARD_WIDTH;

  // Desktop positioning — exactly as before. Tries beside the target first
  // (left/right), falls back to above/below, centered under the target.
  const getCardStyleDesktop = (): React.CSSProperties => {
    if (!hasTarget) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }

    if (placeOnRight) {
      return {
        top: Math.max(16, Math.min(box.top, vh - CARD_ESTIMATED_HEIGHT - 16)),
        left: box.left + box.width + CALLOUT_GAP,
      };
    }

    if (placeOnLeft) {
      return {
        top: Math.max(16, Math.min(box.top, vh - CARD_ESTIMATED_HEIGHT - 16)),
        left: Math.max(10, box.left - CARD_WIDTH - CALLOUT_GAP),
      };
    }

    const renderOnTop = current.side === "top" || box.top + box.height + CARD_ESTIMATED_HEIGHT > vh - 20;

    if (renderOnTop) {
      return {
        top: Math.max(16, box.top - CARD_ESTIMATED_HEIGHT - CALLOUT_GAP),
        left: Math.max(16, box.left + box.width / 2),
        transform: "translateX(-50%)",
      };
    }

    return {
      top: Math.min(box.top + box.height + CALLOUT_GAP, vh - CARD_ESTIMATED_HEIGHT - 16),
      left: Math.max(16, box.left + box.width / 2),
      transform: "translateX(-50%)",
    };
  };

  // Mobile positioning — panels run full-width, so there's never real side
  // space. Always sit above or below the target and stay horizontally
  // pinned to the center of the screen (not the target's x-position), which
  // is what keeps the card from clipping off narrow viewport edges.
  const getCardStyleMobile = (): React.CSSProperties => {
    if (!hasTarget) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }

    const renderOnTop = current.side === "top" || box.top + box.height + CARD_ESTIMATED_HEIGHT > vh - 20;

    if (renderOnTop) {
      return {
        top: Math.max(16, box.top - CARD_ESTIMATED_HEIGHT - CALLOUT_GAP),
        left: "50%",
        transform: "translateX(-50%)",
      };
    }

    return {
      top: Math.min(box.top + box.height + CALLOUT_GAP, vh - CARD_ESTIMATED_HEIGHT - 16),
      left: "50%",
      transform: "translateX(-50%)",
    };
  };

  const getCardStyle = isMobile ? getCardStyleMobile : getCardStyleDesktop;

  const dimStripBase =
    "absolute bg-[#141414]/55 backdrop-blur-[2px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="How kimo works"
      onClick={!hasTarget ? onClose : undefined}
    >
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="tutorial-rough" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {!hasTarget ? (
        <div className="absolute inset-0 bg-[#141414]/50 backdrop-blur-[3px] transition-opacity duration-300" />
      ) : (
        <>
          <div className={dimStripBase} style={{ top: 0, left: 0, width: "100%", height: Math.max(0, box.top) }} />
          <div
            className={dimStripBase}
            style={{ top: box.top + box.height, left: 0, width: "100%", height: Math.max(0, vh - (box.top + box.height)) }}
          />
          <div className={dimStripBase} style={{ top: box.top, left: 0, width: Math.max(0, box.left), height: box.height }} />
          <div
            className={dimStripBase}
            style={{ top: box.top, left: box.left + box.width, width: Math.max(0, vw - (box.left + box.width)), height: box.height }}
          />
        </>
      )}

      <div
        className="absolute w-[92vw] max-w-sm px-1 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={getCardStyle()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <div className="pointer-events-none absolute inset-0" style={{ filter: "url(#tutorial-rough)" }} aria-hidden="true">
            <svg viewBox="0 0 300 190" preserveAspectRatio="none" className="h-full w-full">
              <rect x="4" y="4" width="292" height="182" rx="10" fill="#f7f4ee" stroke="#141414" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          <div className="relative z-10 flex flex-col px-5 py-5 sm:px-6 sm:py-6">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close tutorial"
              className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center text-[#575656] transition-opacity hover:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M5 5 L19 19 M19 5 L5 19" />
              </svg>
            </button>

            <h2 className="mb-1.5 pr-6 text-base font-semibold text-[#141414] sm:text-lg">{current.title}</h2>
            <p className="mb-4 text-sm leading-relaxed text-[#595858]">{current.body}</p>

            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-xs font-medium text-[#8a8577]">
                {step + 1} / {total}
              </span>

              <div className="flex items-center gap-2">
                {!isFirst && (
                  <button
                    type="button"
                    onClick={() => setStep((s) => s - 1)}
                    className="rounded-[6px] border-2 border-[#141414] px-3.5 py-1.5 text-sm font-bold text-[#141414] transition-colors hover:bg-[#141414]/5"
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
                  className="rounded-[6px] border-2 border-[#141414] bg-[#141414] px-4 py-1.5 text-sm font-bold text-white transition-opacity hover:opacity-85"
                >
                  {isLast ? "Got it" : "Next"}
                </button>
              </div>
            </div>

            <div className="mt-3 flex justify-center gap-1.5">
              {steps.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to step ${i + 1}`}
                  onClick={() => setStep(i)}
                  className="h-1.5 rounded-full transition-all"
                  style={{ width: i === step ? 16 : 6, backgroundColor: i === step ? "#141414" : "#d8d3c8" }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}