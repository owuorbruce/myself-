export function normalize(text: string): string;
export function grade(input: string, answers: string): "right" | "close" | "wrong";
export function schedule(
  previous: { interval?: number; ease?: number },
  rating: 0 | 1 | 2 | 3,
  now?: number,
): { interval: number; ease: number; due: number };
export function label(interval: number): string;
export function localDay(time?: number): string;
export function streak(days: string[], now?: number): number;


export function gradeRating(result: "right" | "close" | "wrong"): 0 | 2;
export function gradeCorrect(result: "right" | "close" | "wrong"): boolean;
