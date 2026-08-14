import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names using clsx + tailwind-merge (same helper as app/privacy-explorer). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
