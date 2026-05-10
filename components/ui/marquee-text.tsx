"use client"

import { useRef, useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface MarqueeTextProps {
  text: string
  className?: string
  speed?: number // pixels per second
}

export function MarqueeText({ text, className, speed = 40 }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [shouldScroll, setShouldScroll] = useState(false)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const textEl = textRef.current
    if (!container || !textEl) return

    const check = () => {
      const overflowing = textEl.scrollWidth > container.clientWidth + 2
      setShouldScroll(overflowing)
      if (overflowing) {
        // duration = distance / speed. Add gap (40px) to the travel distance.
        setDuration((textEl.scrollWidth + 40) / speed)
      }
    }

    check()
    const ro = new ResizeObserver(check)
    ro.observe(container)
    return () => ro.disconnect()
  }, [text, speed])

  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden whitespace-nowrap", className)}
    >
      {shouldScroll ? (
        <span
          className="inline-flex"
          style={{
            animation: `marquee ${duration}s linear infinite`,
          }}
        >
          <span ref={textRef}>{text}</span>
          {/* Gap + duplicate for seamless loop */}
          <span aria-hidden className="pl-10">{text}</span>
        </span>
      ) : (
        <span ref={textRef}>{text}</span>
      )}

      <style>{`
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  )
}
