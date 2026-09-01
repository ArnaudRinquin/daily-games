export interface ParsedScore {
  /** Normalised so that LOWER IS ALWAYS BETTER. Higher-is-better games negate. */
  value: number;
  /** Player-facing, in the game's own units: "1:42", "4/6", "870 pts". */
  display: string;
}

export interface GameParser {
  /** Stable DB key. Never rename without a migration. */
  id: string;
  label: string;
  url: string;
  emoji: string;
  /**
   * True while the parser is a placeholder. Hidden games are never offered in
   * the catalog, never linked in a reminder, and never counted in a ranking
   * field — otherwise players submit all week and score nothing.
   */
  hidden?: boolean;
  /** Cheap first pass, usually a header line. */
  detect(text: string): boolean;
  /** Null when detect matched but the score is unreadable. */
  parse(text: string): ParsedScore | null;
}

export interface Match extends ParsedScore {
  game: string;
}
