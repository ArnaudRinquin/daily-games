/** "1:42" -> 102, "1:02:03" -> 3723. Null if the shape is wrong. */
export function timeToSeconds(text: string): number | null {
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((p) => (/^\d{1,2}$/.test(p.trim()) ? Number(p.trim()) : NaN));
  if (nums.some(Number.isNaN)) return null;
  // Every part after the first must be two digits and below 60.
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!.trim();
    if (p.length !== 2 || Number(p) > 59) return null;
  }
  return nums.length === 2
    ? nums[0]! * 60 + nums[1]!
    : nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
}

/** Strips thousands separators LinkedIn and Wordle put in puzzle numbers. */
export function toInt(text: string): number | null {
  const cleaned = text.replace(/[,  \s.]/g, '');
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}
