import { render, screen } from "@testing-library/react";
import { PlanRationalePanel } from "./plan-rationale-panel";

describe("PlanRationalePanel", () => {
  it("renders protected, flexible, and optional sessions as rationale rather than another calendar", () => {
    render(
      <PlanRationalePanel
        block="Build 2"
        objective="Build bike durability while keeping run frequency steady."
        primaryEmphasis="Bike durability"
        progressionNote="+45 min bike load, run load stable."
        coachNotes="Keep Thursday easy enough to arrive fresh for the weekend."
        protectedSessions={[
          { id: "1", title: "Wed power bike" },
          { id: "2", title: "Sat long bike" }
        ]}
        flexibleSessions={[{ id: "3", title: "Thu easy run" }]}
        optionalSessions={[{ id: "4", title: "Sun recovery swim" }]}
      />
    );

    expect(screen.getByText("Week objective")).toBeInTheDocument();
    expect(screen.getByText("Build bike durability while keeping run frequency steady.")).toBeInTheDocument();
    expect(screen.getByText("Wed power bike, Sat long bike")).toBeInTheDocument();
    expect(screen.getByText("Thu easy run")).toBeInTheDocument();
    expect(screen.getByText("Sun recovery swim")).toBeInTheDocument();
  });
});
