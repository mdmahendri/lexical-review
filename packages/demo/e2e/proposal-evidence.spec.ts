import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?proposal-evidence");
  await page.waitForFunction(() => window.__proposalEvidence !== undefined);
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

async function snapshot(page: Page) {
  return page.evaluate(() => window.__proposalEvidence!.snapshot());
}

async function setupTwo(page: Page) {
  await page.getByTestId("reset-baseline").click();
  await page.getByTestId("insert-first").click();
  await page.getByTestId("insert-second").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(2);
}

for (const action of ["accept", "reject", "remove"] as const) {
  test(`${action} targets only the selected proposal and preserves the other`, async ({
    page,
  }) => {
    await setupTwo(page);
    await page.locator('[data-proposal-id="proposal-2"]').click();
    await expect(page.getByTestId("selected-details")).toContainText(
      "proposal-2",
    );

    await page.getByTestId(`${action}-selected`).click();

    await expect(page.getByTestId("proposal-item")).toHaveCount(1);
    await expect(page.getByTestId("proposal-item")).toHaveAttribute(
      "data-proposal-id",
      "proposal-1",
    );
    await expect(page.getByTestId("selected-details")).toContainText(
      "No proposal selected.",
    );
    await expect(page.getByTestId("accept-selected")).toBeDisabled();
    await expect(page.getByTestId("reject-selected")).toBeDisabled();
    await expect(page.getByTestId("remove-selected")).toBeDisabled();
    await expect(page.getByTestId("outcome-pane")).toContainText("changed");

    const expectedText = action === "accept" ? "AxBy" : "AxB";
    await expect
      .poll(async () => (await snapshot(page)).text)
      .toBe(expectedText);

    await page.locator('[data-proposal-id="proposal-1"]').click();
    await expect(page.getByTestId("selected-details")).toContainText(
      "proposal-1",
    );
  });
}

test("ordinary typing in B while inspecting A keeps the inspected ID", async ({
  page,
}) => {
  await setupTwo(page);

  const selectionBefore = (await snapshot(page)).selection;
  await page.locator('[data-proposal-id="proposal-1"]').click();
  await expect(page.getByTestId("selected-details")).toContainText(
    "proposal-1",
  );
  expect((await snapshot(page)).selection).toEqual(selectionBefore);

  await page.getByTestId("place-caret-second").click();
  await page.getByTestId("focus-editor").click();
  await page.keyboard.type("!");
  await expect.poll(async () => (await snapshot(page)).text).toBe("AxBy!");
  await expect(page.getByTestId("selected-details")).toContainText(
    "proposal-1",
  );
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  expect((await snapshot(page)).proposals).toEqual([
    "proposal-1",
    "proposal-2",
  ]);

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  await page.locator('[data-proposal-id="proposal-2"]').click();
  await expect(page.getByTestId("selected-details")).toContainText(
    "proposal-2",
  );
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
});

test("last-proposal resolution empties the list and keeps doc-wide evidence", async ({
  page,
}) => {
  await page.getByTestId("reset-baseline").click();
  await page.getByTestId("insert-first").click();
  await page.locator('[data-proposal-id="proposal-1"]').click();
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");

  await page.getByTestId("accept-selected").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  await expect(page.getByTestId("proposal-list")).toContainText(
    "No pending proposals.",
  );
  await expect(page.getByTestId("selected-details")).toContainText(
    "No proposal selected.",
  );
  await expect(page.getByTestId("accept-selected")).toBeDisabled();
  await expect(page.getByTestId("evidence-status")).toHaveText("Stale");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  await expect(page.getByTestId("accepted-preview")).toHaveText("AxB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxB");
  await expect(page.getByTestId("native-export")).toContainText("AxB");
});

test("semantic content separates accepted, all-accepted, and pending-only native", async ({
  page,
}) => {
  await setupTwo(page);
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxBy");
  const native = await page.getByTestId("native-export").textContent();
  expect(native).toContain("review-insertion");
  expect(native).toContain("proposal-1");
  expect(native).toContain("proposal-2");
  expect(native).not.toContain("terminal");
});

test("refusal preserves document and selection with a refused outcome", async ({
  page,
}) => {
  await page.getByTestId("reset-baseline").click();
  await page.getByTestId("insert-first").click();
  await page.evaluate(() => window.__proposalEvidence!.selectAccepted());
  const before = await snapshot(page);

  await page.getByTestId("refuse-deletion").click();

  await expect(page.getByTestId("outcome-pane")).toContainText("refused");
  const after = await snapshot(page);
  expect(stripKeys(after.document)).toEqual(stripKeys(before.document));
  expect(after.selection).toEqual(before.selection);
  expect(after.text).toEqual(before.text);
});

test("preview lifecycle stays separate from the operation outcome", async ({
  page,
}) => {
  await expect(page.getByTestId("evidence-status")).toHaveText("Not generated");

  await page.getByTestId("insert-first").click();
  await page.getByTestId("insert-second").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(2);
  await expect(page.getByTestId("evidence-status")).toHaveText("Not generated");
  const operationOutcome = await page.getByTestId("outcome-pane").textContent();

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  expect(await page.getByTestId("outcome-pane").textContent()).toBe(
    operationOutcome,
  );

  await page.getByTestId("place-caret-second").click();
  await page.getByTestId("focus-editor").click();
  await page.keyboard.type("!");
  await expect(page.getByTestId("evidence-status")).toHaveText("Stale");
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  expect(await page.getByTestId("outcome-pane").textContent()).not.toContain(
    "Preview",
  );
  await expect(page.getByTestId("evidence-reason")).toHaveCount(0);

  await page.evaluate(() => window.__proposalEvidence!.compositionStart());
  await expect(page.getByTestId("evidence-status")).toHaveText("Unavailable");
  await expect(page.getByTestId("evidence-reason")).toHaveText(
    "Preview unavailable during composition",
  );
  await expect(page.getByTestId("generate-evidence")).toBeDisabled();
  await expect(page.getByTestId("outcome-pane")).not.toContainText("Preview");
  await expect(page.getByTestId("evidence-reason")).not.toContainText(
    "refused",
  );

  await page.evaluate(() => window.__proposalEvidence!.compositionEnd());
  await expect(page.getByTestId("evidence-status")).not.toHaveText(
    "Unavailable",
  );
  await expect(page.getByTestId("generate-evidence")).toBeEnabled();
});

test("capability surface is labelled non-normative", async ({ page }) => {
  await expect(page.getByTestId("capability-label")).toHaveText(
    "Capability demo — non-normative, not a host UI pattern",
  );
});
