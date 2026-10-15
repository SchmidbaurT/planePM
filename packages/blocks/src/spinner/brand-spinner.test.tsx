import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandSpinner } from "./brand-spinner";
import { PlaneLockup } from "../icons/brand/plane-lockup";
import { PlaneLogo } from "../icons/brand/plane-logo";

describe("SchmidbaurPM branding", () => {
  it("announces loading with a decorative mark", () => {
    const { container } = render(<BrandSpinner label="Wird geladen" />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Wird geladen");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(container.querySelector("img")?.getAttribute("src")).toContain("schmidbaur-mark.png");
  });

  it("preserves compact logo sizing and uses the supplied mark", () => {
    const { container } = render(<PlaneLogo width={24} height={24} className="compact" />);
    expect(screen.getByRole("img", { name: "SchmidbaurPM" }).getAttribute("width")).toBe("24");
    expect(container.querySelector("image")?.getAttribute("href")).toContain("schmidbaur-mark.png");
  });

  it("uses the full wordmark with its native aspect ratio", () => {
    const { container } = render(<PlaneLockup />);
    expect(screen.getByRole("img", { name: "SchmidbaurPM" }).getAttribute("viewBox")).toBe("0 0 711 212");
    expect(container.querySelector("image")?.getAttribute("href")).toContain("schmidbaur-logo.png");
  });
});
