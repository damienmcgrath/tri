import assert from "node:assert/strict";
import test from "node:test";
import { pickAutoMatch, scoreCandidate } from "./activity-matching";

test("score candidate favors close time + sport", () => {
  const score = scoreCandidate(
    { sportType: "run", startTimeUtc: "2026-02-22T10:00:00.000Z", durationSec: 3600, distanceM: 10000 },
    { id: "a", sport: "run", startTimeUtc: "2026-02-22T10:10:00.000Z", targetDurationSec: 3500, targetDistanceM: 9500 }
  );

  assert.equal(score.candidateId, "a");
  assert.ok(score.confidence > 0.85);
});

test("pickAutoMatch rejects ambiguous best match", () => {
  const result = pickAutoMatch([
    { candidateId: "a", confidence: 0.9, reason: {} },
    { candidateId: "b", confidence: 0.82, reason: {} }
  ]);
  assert.equal(result, null);
});

test("pickAutoMatch accepts strong clear winner", () => {
  const result = pickAutoMatch([
    { candidateId: "a", confidence: 0.91, reason: {} },
    { candidateId: "b", confidence: 0.72, reason: {} }
  ]);
  assert.equal(result?.candidateId, "a");
});
