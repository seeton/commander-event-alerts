import { describe, expect, it } from "vitest";
import { landingPage } from "../src/worker/pages";

describe("subscription page", () => {
  it("posts only to this service without client JavaScript", () => {
    const page = landingPage({
      appName: "Test",
      enabled: true,
    });
    expect(page).toContain('action="/api/subscribe"');
    expect(page).toContain('name="email"');
    expect(page).not.toContain("<script");
    expect(page).not.toContain("buttondown");
  });

  it("shows a safe preparation page until delivery is configured", () => {
    const page = landingPage({ appName: "Test", enabled: false });
    expect(page).toContain("公開準備中");
    expect(page).not.toContain('name="email"');
  });
});
