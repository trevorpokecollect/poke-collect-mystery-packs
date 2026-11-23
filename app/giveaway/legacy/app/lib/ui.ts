type Tone = "neutral" | "info" | "success" | "caution" | "warning" | "critical";

export function statusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SCHEDULED":
    case "PENDING_VERIFICATION":
      return "info";
    case "HELD":
      return "warning";
    case "DISQUALIFIED":
      return "critical";
    default:
      return "neutral";
  }
}

/**
 * Badge color for a risk score. Someone who confirmed their email code with only weak
 * signals (under the hold score) is almost always a real person, so that shows grey.
 */
export function riskTone(score: number, status?: string): Tone {
  if (score >= 80) return "critical";
  if (score >= 50) return "warning";
  if (status === "ACTIVE") return score > 0 ? "neutral" : "success";
  if (score >= 20) return "caution";
  return "success";
}
