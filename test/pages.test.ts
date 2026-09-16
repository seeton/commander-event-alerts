import { describe, expect, it } from "vitest";
import { landingPage } from "../src/worker/pages";

describe("subscription page", () => {
  it("posts the email directly to Buttondown without client JavaScript", () => {
    const page = landingPage({
      appName: "Test",
      buttondownUsername: "commander-events",
      enabled: true,
    });
    expect(page).toContain('action="https://buttondown.com/api/emails/embed-subscribe/commander-events"');
    expect(page).toContain('name="email"');
    expect(page).not.toContain("<script");
    expect(page).not.toContain("/api/subscribe");
  });

  it("shows a safe preparation page until delivery is configured", () => {
    const page = landingPage({ appName: "Test", buttondownUsername: "", enabled: false });
    expect(page).toContain("公開準備中");
    expect(page).not.toContain('name="email"');
  });
});
