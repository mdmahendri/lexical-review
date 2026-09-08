import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?scenarios");
  await page.waitForFunction(() => window.__scenarios !== undefined);
  await expect(page.getByTestId("scenario-editor")).toBeVisible();
  await page
    .getByText("Developer details · proposal data, outcomes & export")
    .click();
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
  return page.evaluate(() => window.__scenarios!.snapshot());
}

async function rail(page: Page, id: string) {
  await page
    .locator(`[data-testid="scenario-item"][data-scenario="${id}"]`)
    .click();
}

test("R1 insertion continuation keeps one identity via native typing", async ({
  page,
}) => {
  await rail(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await page.getByTestId("focus-editor").click();
  await page.keyboard.type("x");
  await page.keyboard.type("y");

  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText("insertion");
  await expect(page.getByTestId("selected-details")).toContainText("xy");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxyB");
  const native = await page.getByTestId("native-export").textContent();
  expect(native).toContain("review-insertion");
  expect(native).toContain("scenario-1");
  expect(native).not.toContain("terminal");
});

test("generated evidence follows the freshness lifecycle", async ({ page }) => {
  await rail(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Not generated");

  await page.getByTestId("act-insert-x").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Not generated");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");

  // Selecting a proposal never marks generated evidence stale.
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");

  await page.getByTestId("act-insert-y").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Stale");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxyB");
});

test("R1 action buttons produce the same single proposal", async ({ page }) => {
  await rail(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await page.getByTestId("act-insert-x").click();
  await page.getByTestId("act-insert-y").click();

  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  expect((await snapshot(page)).text).toBe("AxyB");
});

test("R2 correction keeps identity then direct removal empties the list", async ({
  page,
}) => {
  await rail(page, "r2");
  const loaded = await snapshot(page);
  expect(loaded.proposals).toHaveLength(1);
  await page.getByTestId("focus-editor").click();
  await page.keyboard.type("z");

  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  const corrected = await snapshot(page);
  expect(corrected.text).toBe("AxzyB");
  // Correction continues the pending proposal under the same identity.
  expect(corrected.proposals).toEqual(loaded.proposals);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText("xzy");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AxzyB");

  await page.getByTestId("remove-selected").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  expect((await snapshot(page)).text).toBe("AB");
  await expect(page.getByTestId("selected-details")).toContainText(
    "No proposal selected.",
  );

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AB");
});

test("R3 accepted-side deletion refuses with zero mutation", async ({
  page,
}) => {
  await rail(page, "r3");
  const before = await snapshot(page);
  expect(before.proposals).toHaveLength(1);

  await page.getByTestId("act-delete-forward").click();

  await expect(page.getByTestId("outcome-pane")).toContainText("refused");
  await expect(page.getByTestId("outcome-pane")).toContainText(
    "deletion-target-unavailable",
  );
  const after = await snapshot(page);
  expect(stripKeys(after.document)).toEqual(stripKeys(before.document));
  expect(after.selection).toEqual(before.selection);
  expect(after.text).toEqual(before.text);
  expect(after.proposals).toHaveLength(1);

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("ABX");
});

test("N1 atomic replacement carries one shared identity", async ({ page }) => {
  await rail(page, "n1");
  await page.getByTestId("act-replace").click();

  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText(
    "replacement",
  );
  await expect(page.getByTestId("selected-details")).toContainText("oldText");
  await expect(page.getByTestId("selected-details")).toContainText("newText");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("accepted-preview")).toHaveText("cat");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("bat");
});

test("N2 paragraph split via native Enter keeps accepted and all-accepted in sync", async ({
  page,
}) => {
  await rail(page, "n2");
  await page.getByTestId("focus-editor").click();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText("split");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  const allAccepted = await page
    .getByTestId("all-accepted-preview")
    .textContent();
  expect(allAccepted).toContain("A");
  expect(allAccepted).toContain("B");
  expect((await snapshot(page)).paragraphs).toEqual(["A", "B"]);
});

test("N3 simulated paste normalizes text/plain into one fragment", async ({
  page,
}) => {
  await rail(page, "n3");
  await page.getByTestId("act-paste").click();

  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await expect(page.getByTestId("normalization-report")).toContainText(
    "text/plain",
  );
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText("fragment");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  const allAccepted = await page
    .getByTestId("all-accepted-preview")
    .textContent();
  expect(allAccepted).toContain("Ax");
  expect(allAccepted).toContain("yB");
  expect((await snapshot(page)).paragraphs).toEqual(["Ax", "yB"]);
  const native = await page.getByTestId("native-export").textContent();
  expect(native).toContain("review-fragment");
  expect(native).toContain("scenario-1");
  expect(native).not.toContain("terminal");
});

test("N4 simulated composition commit yields one insertion", async ({
  page,
}) => {
  await rail(page, "n4");
  await page.getByTestId("act-compose").click();

  await expect(page.getByTestId("outcome-pane")).toContainText("changed", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText("insertion");
  await expect(page.getByTestId("selected-details")).toContainText("あ");

  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("accepted-preview")).toHaveText("AB");
  await expect(page.getByTestId("all-accepted-preview")).toHaveText("AあB");
});

test("switching scenarios resets edits without reporting an outcome", async ({
  page,
}) => {
  await rail(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await page.getByTestId("act-insert-x").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await page.getByTestId("proposal-item").click();
  await expect(page.getByTestId("selected-details")).toContainText(
    "scenario-1",
  );
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  await expect(page.getByTestId("evidence-pane")).toBeVisible();

  await rail(page, "n1");
  await page
    .getByText("Developer details · proposal data, outcomes & export")
    .click();

  // Selection, inspection, outcome, and generated evidence are discarded.
  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  await expect(page.getByTestId("outcome-pane")).toContainText("none yet");
  await expect(page.getByTestId("outcome-pane")).toContainText(
    "Reported outcomes this baseline: 0",
  );
  await expect(page.getByTestId("evidence-status")).toHaveText("Not generated");
  await expect(page.getByTestId("evidence-pane")).toHaveCount(0);
  await expect(page.getByTestId("normalization-report")).toHaveCount(0);
  await expect(page.getByTestId("selected-details")).toContainText(
    "No proposal selected.",
  );
  expect((await snapshot(page)).text).toBe("cat");

  // Re-activating the already-selected rail item does not reset edits.
  await page.getByTestId("act-replace").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  await rail(page, "n1");
  await expect(page.getByTestId("proposal-item")).toHaveCount(1);
  expect((await snapshot(page)).text).toBe("cbat");

  await page.getByTestId("reset-scenario").click();
  await expect(page.getByTestId("proposal-item")).toHaveCount(0);
  expect((await snapshot(page)).text).toBe("cat");
  await expect(page.getByTestId("outcome-pane")).toContainText("none yet");
});

test("accept settles the selected proposal through the shared evidence pane", async ({
  page,
}) => {
  await rail(page, "n3");
  await page.getByTestId("act-paste").click();
  await page.getByTestId("proposal-item").click();
  await page.getByTestId("accept-selected").click();

  await expect(page.getByTestId("outcome-pane")).toContainText("changed");
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("Current");
  const accepted = await page.getByTestId("accepted-preview").textContent();
  expect(accepted).toContain("Ax");
  expect(accepted).toContain("yB");
});

test("capability surface is labelled non-normative with live/docs leads", async ({
  page,
}) => {
  await expect(page.getByTestId("capability-label")).toHaveText(
    "Capability demo — non-normative, not a host UI pattern",
  );
  await expect(page.getByTestId("scenario-rail")).toBeVisible();
  await expect(page.getByTestId("scenario-item")).toHaveCount(7);
});

test("narrow widths keep the rail available without page overflow", async ({
  page,
}) => {
  // Generate the widest content (native export JSON) before measuring.
  await rail(page, "r1");
  await page.getByTestId("reset-scenario").click();
  await page.getByTestId("act-insert-x").click();
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-pane")).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByTestId("scenario-rail")).toBeVisible();
  await expect(page.getByTestId("scenario-editor")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("the rail stays available after scrolling through evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await rail(page, "n3");
  await page.getByTestId("act-paste").click();
  await page.getByTestId("generate-evidence").click();
  await expect(page.getByTestId("evidence-pane")).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByTestId("scenario-rail")).toBeInViewport();
  await expect(
    page.locator('[data-testid="scenario-item"][data-scenario="n1"]'),
  ).toBeInViewport();
});

test("guided path reviews a change and advances to a fresh example", async ({
  page,
}) => {
  await page
    .getByText("Developer details · proposal data, outcomes & export")
    .click();
  await expect(page.getByTestId("outcome-pane")).toBeHidden();
  await page.getByTestId("act-insert-x").click();
  await page.getByTestId("act-insert-y").click();
  await page.getByTestId("proposal-item").click();
  await page.getByTestId("reject-selected").click();
  await expect(page.getByTestId("scenario-editor")).toHaveText("AB");
  await expect(page.getByRole("status")).toContainText(
    "No pending proposals remain",
  );
  await page
    .getByRole("button", { name: "Next: Revise a suggestion →" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revise a suggestion", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("scenario-editor")).toHaveText("AxyB");
  await expect(page.getByTestId("outcome-pane")).toBeHidden();
});
