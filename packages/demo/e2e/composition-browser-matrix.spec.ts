import { expect, test, type TestInfo } from "@playwright/test";
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

async function attachMatrixReport(testInfo: TestInfo, detail: string) {
  const body = [
    `browser-matrix harness (#83) — ${testInfo.title}`,
    `browser: ${testInfo.project.name}`,
    "Playwright WebKit results do not certify native Safari or iOS Safari.",
    "Android: deferred because no Android runner exists in this repository/CI (no emulator/device farm); see https://github.com/mahendrimd/lexical-review/issues/84.",
    detail,
  ].join("\n");
  await testInfo.attach("browser-matrix", {
    body,
    contentType: "text/plain",
  });
}

test("IME commit あ at accepted caret inserts one proposal", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    window.__routeWiringFixture!.compose("あ");
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__routeWiringFixture!.snapshot().outcomeCount),
    )
    .toBe(1);

  const snapshot = await page.evaluate(() =>
    window.__routeWiringFixture!.snapshot(),
  );
  expect(snapshot.lastOutcome).toMatchObject({ status: "changed" });
  expect(snapshot.outcomeCount).toBe(1);
  expect(snapshot.proposals).toEqual(["route-wiring-1"]);
  expect(snapshot.text).toBe("AあB");
  expect(snapshot.proposal).toMatchObject({
    value: {
      kind: "insertion",
      proposal: { proposalId: "route-wiring-1", text: "あ" },
    },
  });
  expect(snapshot.selectionCollapsed).toBe(true);
  expect(snapshot.selectionParentType).toBe("review-insertion");

  const editor = page.getByTestId("route-wiring-editor");
  await expect(editor.locator("ins")).toHaveCount(1);
  await expect(editor.locator("ins")).toHaveText("あ");

  await attachMatrixReport(
    test.info(),
    "IME あ: changed x1, single insertion.",
  );
});

test("trailing-newline commit refuses without split or second outcome", async ({
  page,
}) => {
  const before = await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    return window.__routeWiringFixture!.snapshot();
  });
  const beforeHtml = await page.getByTestId("route-wiring-editor").innerHTML();

  await page.evaluate(() => {
    window.__routeWiringFixture!.compose("確定\n");
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__routeWiringFixture!.snapshot().outcomeCount),
    )
    .toBe(1);
  await page.waitForTimeout(200);

  const after = await page.evaluate(() =>
    window.__routeWiringFixture!.snapshot(),
  );
  expect(after.lastOutcome).toMatchObject({
    code: "unsupported-input",
    status: "refused",
  });
  expect(after.outcomeCount).toBe(1);
  expect(after.text).toBe(before.text);
  expect(after.paragraphCount).toBe(before.paragraphCount);
  expect(after.paragraphCount).toBe(1);
  expect(stripKeys(after.document)).toEqual(stripKeys(before.document));
  expect(after.selection).toEqual(before.selection);
  expect(after.proposals).toEqual([]);

  const editor = page.getByTestId("route-wiring-editor");
  await expect(editor.locator("p")).toHaveCount(1);
  await expect(editor.locator("ins")).toHaveCount(0);
  await expect(editor.locator("del")).toHaveCount(0);
  expect(await editor.innerHTML()).toBe(beforeHtml);

  await attachMatrixReport(
    test.info(),
    "確定\\n: refused/unsupported-input x1, no split, no second outcome.",
  );
});

for (const order of ["insert-first", "end-first"] as const) {
  test(`Safari insertFromComposition + compositionend (${order}) claims once`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__routeWiringFixture!.reset();
      window.__routeWiringFixture!.selectAccepted();
      window.__routeWiringFixture!.startComposition();
    });
    expect(
      await page.evaluate(() => window.__routeWiringFixture!.isComposing()),
    ).toBe(true);

    await page.evaluate((order) => {
      window.__routeWiringFixture!.commitSafari("あ", order);
    }, order);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__routeWiringFixture!.snapshot().outcomeCount,
        ),
      )
      .toBe(1);

    const snapshot = await page.evaluate(() =>
      window.__routeWiringFixture!.snapshot(),
    );
    expect(snapshot.lastOutcome).toMatchObject({ status: "changed" });
    expect(snapshot.outcomeCount).toBe(1);
    expect(snapshot.proposals).toEqual(["route-wiring-1"]);
    expect(snapshot.text).toBe("AあB");
    expect(snapshot.proposal).toMatchObject({
      value: {
        kind: "insertion",
        proposal: { proposalId: "route-wiring-1", text: "あ" },
      },
    });
    expect(snapshot.selectionCollapsed).toBe(true);
    expect(snapshot.selectionParentType).toBe("review-insertion");

    const editor = page.getByTestId("route-wiring-editor");
    await expect(editor.locator("ins")).toHaveCount(1);
    await expect(editor.locator("ins")).toHaveText("あ");

    await attachMatrixReport(
      test.info(),
      `Safari dedup (${order}): changed x1, no double-apply.`,
    );
  });
}

test("Firefox deferred end flushes one insertion after update", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__routeWiringFixture!.reset();
    window.__routeWiringFixture!.selectAccepted();
    window.__routeWiringFixture!.startComposition();
  });
  expect(
    await page.evaluate(() => window.__routeWiringFixture!.isComposing()),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => window.__routeWiringFixture!.snapshot().outcomeCount,
    ),
  ).toBe(0);

  // Synthetic compositions finalize through the command directly (cf98110):
  // direct dispatch bypasses browser-specific intermediate composition
  // state, so the deferred flush is observed via poll rather than a
  // synchronous zero immediately after dispatch.
  await page.evaluate(() => {
    window.__routeWiringFixture!.commitComposition("あ");
  });

  await expect
    .poll(() =>
      page.evaluate(() => window.__routeWiringFixture!.snapshot().outcomeCount),
    )
    .toBe(1);

  const snapshot = await page.evaluate(() =>
    window.__routeWiringFixture!.snapshot(),
  );
  expect(snapshot.lastOutcome).toMatchObject({ status: "changed" });
  expect(snapshot.outcomeCount).toBe(1);
  expect(snapshot.proposals).toEqual(["route-wiring-1"]);
  expect(snapshot.text).toBe("AあB");
  expect(snapshot.proposal).toMatchObject({
    value: {
      kind: "insertion",
      proposal: { proposalId: "route-wiring-1", text: "あ" },
    },
  });
  expect(snapshot.selectionCollapsed).toBe(true);
  expect(snapshot.selectionParentType).toBe("review-insertion");

  const editor = page.getByTestId("route-wiring-editor");
  await expect(editor.locator("ins")).toHaveCount(1);
  await expect(editor.locator("ins")).toHaveText("あ");

  await attachMatrixReport(
    test.info(),
    "Firefox deferred end: 0 while composing, 1 after update flush.",
  );
});
