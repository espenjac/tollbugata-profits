import { describe, expect, it } from "vitest";
import { marketSession, simulatorMayTick } from "./session";

describe("marketSession", () => {
  it("is open during Oslo trading hours on a weekday", () => {
    expect(marketSession(new Date("2026-11-04T10:00:00+01:00"))).toBe("open");
    expect(marketSession(new Date("2026-11-04T16:29:00+01:00"))).toBe("open");
  });

  it("is pre-market before 09:00 and closed after 16:30", () => {
    expect(marketSession(new Date("2026-11-04T08:59:00+01:00"))).toBe("pre");
    expect(marketSession(new Date("2026-11-04T16:31:00+01:00"))).toBe("closed");
  });

  it("is closed on weekends", () => {
    expect(marketSession(new Date("2026-11-07T12:00:00+01:00"))).toBe("closed");
  });

  it("is closed on Oslo Børs holidays", () => {
    expect(marketSession(new Date("2026-04-03T12:00:00+02:00"))).toBe("closed");
    expect(marketSession(new Date("2026-05-14T12:00:00+02:00"))).toBe("closed");
    expect(marketSession(new Date("2026-12-24T12:00:00+01:00"))).toBe("closed");
  });

  it("is open on an ordinary weekday after a Sunday holiday", () => {
    expect(marketSession(new Date("2026-05-18T10:00:00+02:00"))).toBe("open");
  });
});

describe("simulatorMayTick", () => {
  it("waits five minutes after the open", () => {
    expect(simulatorMayTick(new Date("2026-11-04T09:00:00+01:00"))).toBe(false);
    expect(simulatorMayTick(new Date("2026-11-04T09:04:00+01:00"))).toBe(false);
    expect(simulatorMayTick(new Date("2026-11-04T09:05:00+01:00"))).toBe(true);
  });

  it("does not tick outside the session or on holidays", () => {
    expect(simulatorMayTick(new Date("2026-11-04T08:59:00+01:00"))).toBe(false);
    expect(simulatorMayTick(new Date("2026-11-04T16:31:00+01:00"))).toBe(false);
    expect(simulatorMayTick(new Date("2026-12-24T12:00:00+01:00"))).toBe(false);
  });
});
