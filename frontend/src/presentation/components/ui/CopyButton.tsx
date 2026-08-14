/**
 * CopyButton — icon button that copies a value to the clipboard and shows a
 * tick for 1.5s. Same contract as privacy-explorer's.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "./cn";

interface CopyButtonProps {
  value: string;
  className?: string;
  /** Accessible label; defaults to a generic one. */
  label?: string;
}

export function CopyButton({ value, className, label = "Copy to clipboard" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Rows unmount as nodes leave the feed; clear the timer so it can't fire
  // setState on a dead component.
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context, denied permission) */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={copied ? "Copied!" : "Copy"}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center transition-colors",
        "hover:bg-overlay-hover active:scale-95",
        copied ? "text-success" : "text-muted",
        className,
      )}
    >
      {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} />}
    </button>
  );
}
