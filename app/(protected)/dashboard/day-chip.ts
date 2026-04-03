export type DayTone = "rest" | "upcoming" | "today-remaining" | "today-complete" | "completed" | "missed" | "adapted";

export function getDayToneClass(tone: DayTone) {
  if (tone === "today-remaining") {
    return "border-[rgba(190,255,0,0.32)] bg-[rgba(190,255,0,0.11)]";
  }

  if (tone === "today-complete") {
    return "border-[rgba(190,255,0,0.2)] bg-[rgba(190,255,0,0.06)]";
  }

  if (tone === "completed") {
    return "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]";
  }

  if (tone === "missed") {
    return "border-[rgba(255,90,40,0.24)] bg-[rgba(255,90,40,0.09)]";
  }

  if (tone === "adapted") {
    return "border-[hsl(var(--warning)/0.34)] bg-[rgba(255,180,60,0.10)]";
  }

  if (tone === "upcoming") {
    return "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.035)]";
  }

  return "border-[rgba(255,255,255,0.06)] bg-transparent";
}

export function getDayChipContent(day: { tone: DayTone; stateLabel: string; microLabel: string }) {
  if (day.tone === "completed" || day.tone === "today-complete") {
    return {
      title: day.microLabel.replace(/ done$/i, ""),
      meta: day.tone === "today-complete" ? "Today" : "Done"
    };
  }

  if (day.tone === "missed") {
    return {
      title: day.microLabel.replace(/ missed$/i, ""),
      meta: "Missed"
    };
  }

  if (day.tone === "upcoming") {
    return {
      title: day.stateLabel,
      meta: day.microLabel.replace(/ planned$/i, "") || "Upcoming"
    };
  }

  if (day.tone === "today-remaining") {
    const [title, meta] = day.microLabel.split(" · ");
    return {
      title: title ?? day.stateLabel,
      meta: meta ?? "Today"
    };
  }

  return {
    title: day.stateLabel,
    meta: day.microLabel === day.stateLabel ? "" : day.microLabel
  };
}

export function getDayChipTitleClass(day: { tone: DayTone; stateLabel: string }) {
  if (day.tone === "upcoming" && day.stateLabel.length > 8) {
    return "mt-1 text-[12px] font-medium leading-tight text-white";
  }

  return "mt-1 text-[13px] font-medium leading-tight text-white";
}
