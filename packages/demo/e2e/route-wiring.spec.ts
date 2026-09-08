import { expect, test } from "@playwright/test";
import type {} from "./RouteWiringFixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/?route-wiring");
  await page.waitForFunction(() => window.__routeWiringFixture !== undefined);
});

function stripKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "key")
        .map(([key, entry]) => [key, stripKeys(entry)]),
    );
  }
  return value;
}

test("keyboard and programmatic routes reach the same insertion intent", async ({
  page,
}) => {
  const rootSnapshot = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    window.__routeWiringFixture!.insertRoot("x");
    return window.__routeWiringFixture!.snapshot();
  });
  await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
  });
  await page.keyboard.type("x");
  const keyboardSnapshot = await page.evaluate(() =>
    window.__routeWiringFixture!.snapshot(),
  );

  for (const snapshot of [rootSnapshot, keyboardSnapshot]) {
    expect(snapshot.proposals).toEqual(["route-wiring-1"]);
    expect(snapshot.text).toBe("AxB");
    expect(snapshot.lastOutcome).toMatchObject({ status: "changed" });
  }
  expect(stripKeys(keyboardSnapshot.document)).toEqual(
    stripKeys(rootSnapshot.document),
  );
  expect(keyboardSnapshot.proposal).toEqual(rootSnapshot.proposal);
});

test("toolbar and programmatic routes reach the same formatting intent", async ({
  page,
}) => {
  const rootSnapshot = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.formatRoot();
    return window.__routeWiringFixture!.snapshot();
  });
  const toolbarSnapshot = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.formatToolbar();
    return window.__routeWiringFixture!.snapshot();
  });

  for (const snapshot of [rootSnapshot, toolbarSnapshot]) {
    expect(snapshot.proposals).toEqual(["route-wiring-1"]);
    expect(snapshot.text).toBe("AB");
    expect(snapshot.lastOutcome).toMatchObject({ status: "changed" });
  }
  expect(stripKeys(toolbarSnapshot.document)).toEqual(
    stripKeys(rootSnapshot.document),
  );
  expect(toolbarSnapshot.proposal).toEqual(rootSnapshot.proposal);
});

test("proposal-side continuation keeps identity with changed", async ({
  page,
}) => {
  const snapshot = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    window.__routeWiringFixture!.insertRoot("x");
    window.__routeWiringFixture!.continueProposal("!");
    return window.__routeWiringFixture!.snapshot();
  });
  expect(snapshot.proposals).toEqual(["route-wiring-1"]);
  expect(snapshot.text).toBe("Ax!B");
  expect(snapshot.lastOutcome).toMatchObject({ status: "changed" });
  expect(snapshot.proposal).toMatchObject({
    value: {
      kind: "insertion",
      proposal: { proposalId: "route-wiring-1", text: "x!" },
    },
  });
});

test("accepted-side deletion refuses without mutation or selection change", async ({
  page,
}) => {
  const before = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    window.__routeWiringFixture!.insertRoot("x");
    window.__routeWiringFixture!.selectAccepted();
    return window.__routeWiringFixture!.snapshot();
  });
  const after = await page.evaluate(() => {
    window.__routeWiringFixture!.refuseDeletion();
    return window.__routeWiringFixture!.snapshot();
  });
  expect(after.lastOutcome).toMatchObject({
    code: "deletion-target-unavailable",
    status: "refused",
  });
  expect(stripKeys(after.document)).toEqual(stripKeys(before.document));
  expect(after.selection).toEqual(before.selection);
  expect(after.text).toEqual(before.text);
});

test("one physical action is claimed once", async ({ page }) => {
  const claimed = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    return window.__routeWiringFixture!.claimSameObject();
  });
  expect(claimed.after - claimed.before).toBe(1);
  const snapshot = await page.evaluate(() =>
    window.__routeWiringFixture!.snapshot(),
  );
  expect(snapshot.proposals).toEqual(["route-wiring-1"]);
  expect(snapshot.text).toBe("AzB");

  await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
  });
  await page.keyboard.type("x");
  const keyboardCount = await page.evaluate(
    () => window.__routeWiringFixture!.snapshot().outcomeCount,
  );
  expect(keyboardCount).toBe(1);
});

test("toolbar resolve matches direct resolution as one action", async ({
  page,
}) => {
  const viaCommand = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    window.__routeWiringFixture!.insertRoot("x");
    window.__routeWiringFixture!.resolveViaCommand("accept");
    return window.__routeWiringFixture!.snapshot();
  });
  const direct = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    window.__routeWiringFixture!.insertRoot("x");
    window.__routeWiringFixture!.resolveRoot("accept");
    return window.__routeWiringFixture!.snapshot();
  });
  for (const snapshot of [viaCommand, direct]) {
    expect(snapshot.lastOutcome).toMatchObject({ status: "changed" });
    expect(snapshot.proposals).toEqual([]);
    expect(snapshot.text).toBe("AxB");
  }
  expect(stripKeys(viaCommand.document)).toEqual(stripKeys(direct.document));
});

test("capability surface is labelled, narrow-safe, and free of legacy step concepts", async ({
  page,
}) => {
  await expect(page.getByTestId("capability-label")).toHaveText(
    "Capability demo — non-normative, not a host UI pattern",
  );
  const legacyAbsent = await page.evaluate(
    () =>
      !("__lexicalReviewEditorFixture" in window) &&
      !("undo" in (window.__routeWiringFixture as object)),
  );
  expect(legacyAbsent).toBe(true);
  const failedSlot = await page.evaluate(
    () => window.__routeWiringFixture!.snapshot().failedExample,
  );
  expect(failedSlot).toMatchObject({ status: "failed" });

  await page.setViewportSize({ height: 800, width: 320 });
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
