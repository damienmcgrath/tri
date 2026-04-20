import { render, screen, waitFor } from "@testing-library/react";
import { DebriefAutoRefresh } from "./debrief-auto-refresh";

const mockRefresh = jest.fn();
const mockUseRouter = jest.fn(() => ({ refresh: mockRefresh }));

jest.mock("next/navigation", () => ({
  useRouter: (...args: unknown[]) => (mockUseRouter as unknown as (...args: unknown[]) => unknown)(...args)
}));

describe("DebriefAutoRefresh", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockRefresh.mockClear();
    mockUseRouter.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("does not fetch or render when disabled", () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { container } = render(<DebriefAutoRefresh weekStart="2026-04-13" enabled={false} />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test("posts to the refresh endpoint once and calls router.refresh on success", async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<DebriefAutoRefresh weekStart="2026-04-13" enabled={true} />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/weekly-debrief/refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ weekStart: "2026-04-13" })
      })
    );
  });

  test("swallows fetch errors so stale artifact stays visible", async () => {
    const fetchSpy = jest.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<DebriefAutoRefresh weekStart="2026-04-13" enabled={true} />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
