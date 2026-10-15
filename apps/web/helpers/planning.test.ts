import { describe, expect, it } from "vitest";
import {
  getHierarchyRootIds,
  getHierarchyRows,
  getExpandedHierarchyIds,
  getPlanningFilters,
  getResourceConflict,
  normalizePlanningPreferences,
  planningWidgets,
} from "./planning";

describe("work item hierarchy", () => {
  const issues = { parent: {}, child: { parent_id: "parent" }, grandchild: { parent_id: "child" } };
  it("shows children only under their visible parent", () => {
    expect(getHierarchyRootIds(["parent", "child", "grandchild"], issues)).toEqual(["parent"]);
  });
  it("keeps filtered or unloaded parents' children reachable", () => {
    expect(getHierarchyRootIds(["child", "grandchild"], issues)).toEqual(["child"]);
    expect(getHierarchyRootIds(["grandchild"], issues)).toEqual(["grandchild"]);
  });
  it("reacts to reparenting and removing a parent", () => {
    expect(getHierarchyRootIds(["parent", "child"], { ...issues, child: {} })).toEqual(["parent", "child"]);
  });
  it("does not hide cyclic or self-referencing legacy data", () => {
    expect(getHierarchyRootIds(["parent", "child"], { parent: { parent_id: "child" }, child: issues.child })).toEqual([
      "parent",
      "child",
    ]);
    expect(getHierarchyRootIds(["child"], { child: { parent_id: "child" } })).toEqual(["child"]);
  });
  it("preserves order and removes duplicate ids", () => {
    expect(getHierarchyRootIds(["child", "parent", "parent", "other"], issues)).toEqual(["parent", "other"]);
  });
  it("expands the timeline recursively without duplicate rows", () => {
    const ids = ["parent", "child", "grandchild", "child"];
    expect(getHierarchyRows(ids, issues, new Set())).toEqual([{ id: "parent", depth: 0 }]);
    expect(getHierarchyRows(ids, issues, new Set(["parent", "child"]))).toEqual([
      { id: "parent", depth: 0 },
      { id: "child", depth: 1 },
      { id: "grandchild", depth: 2 },
    ]);
  });
  it("only loads children reachable from the current view", () => {
    const children: Record<string, string[]> = { parent: ["child"], child: ["grandchild"], old: ["old-child"] };
    const expanded = new Set(["parent", "child", "old"]);
    expect(getExpandedHierarchyIds(["parent"], expanded, (id) => children[id])).toEqual(["parent", "child", "grandchild"]);
  });
});

describe("personal project preferences", () => {
  it("fills defaults and isolates unsupported schema versions", () => {
    expect(normalizePlanningPreferences({}).default_layout).toBe("list");
    expect(normalizePlanningPreferences({}).enabled_widgets).not.toContain("timeline");
    expect(normalizePlanningPreferences({}).enabled_widgets).toContain("projects");
    expect(normalizePlanningPreferences({ schema_version: 9, default_layout: "dashboard" }).default_layout).toBe(
      "list"
    );
  });
  it("preserves widget order without duplicates and appends missing widgets", () => {
    const preferences = normalizePlanningPreferences({
      widget_order: ["people", "people", "timeline"],
      enabled_widgets: [],
    });
    expect(preferences.widget_order?.slice(0, 2)).toEqual(["people", "timeline"]);
    expect(preferences.widget_order).toHaveLength(planningWidgets.length);
    expect(preferences.enabled_widgets).toEqual([]);
  });
  it("explicit URLs override saved filters, including cleared selections", () => {
    const filters = getPlanningFilters(
      { search: "saved", project_ids: "old" },
      new URLSearchParams("search=current&project_ids=&layout=timeline&unknown=secret")
    );
    expect(filters).toEqual({ search: "current", project_ids: "" });
  });
  it("recognizes plain and wrapped resource errors without trusting arbitrary dates", () => {
    expect(
      getResourceConflict({ response: { data: { code: "RESOURCE_CAPACITY_EXCEEDED", date: "2026-10-12" } } })?.date
    ).toBe("2026-10-12");
    expect(getResourceConflict({ code: "RESOURCE_IN_USE", date: "invalid" })?.date).toBeUndefined();
    expect(getResourceConflict({ code: "OTHER_ERROR" })).toBeUndefined();
  });
});
