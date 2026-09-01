import { expect, test, type Page } from "@playwright/test";
import type {
  NativeCaret,
  ReviewMarkup,
  ReviewEditorScenario,
  ReviewSegment,
  ReviewTextRange,
} from "./ReviewEditorFixture.types";

type DeleteTraceEntry = {
  defaultPrevented: boolean;
  inputType?: string;
  key?: string;
  type: string;
};

declare global {
  interface Window {
    __deleteTrace?: DeleteTraceEntry[];
  }
}

async function openReviewEditorFixture(page: Page): Promise<void> {
  await page.goto(".");

  const editor = page.getByTestId("review-editor");
  await expect(editor).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.__lexicalReviewEditorFixture !== undefined),
    )
    .toBe(true);
}

async function getSegments(
  page: Page,
  scenario: ReviewEditorScenario,
): Promise<ReviewSegment[]> {
  return page.evaluate((scenario) => {
    const fixture = window.__lexicalReviewEditorFixture;

    if (fixture == null) {
      throw new Error("The review editor fixture is not ready.");
    }

    return fixture.getSegments(scenario);
  }, scenario);
}

async function getSessionSegments(page: Page): Promise<ReviewSegment[]> {
  return page.evaluate(() => {
    const fixture = window.__lexicalReviewSessionEditorFixture;

    if (fixture == null) {
      throw new Error("The deletion session fixture is not ready.");
    }

    return fixture.getSegments();
  });
}

async function getSessionCaret(page: Page): Promise<NativeCaret | null> {
  return page.evaluate(() => {
    const fixture = window.__lexicalReviewSessionEditorFixture;

    if (fixture == null) {
      throw new Error("The deletion session fixture is not ready.");
    }

    return fixture.getCaret();
  });
}

async function placeSessionCaret(page: Page, offset: number): Promise<void> {
  await page.evaluate((caretOffset) => {
    const fixture = window.__lexicalReviewSessionEditorFixture;

    if (fixture == null) {
      throw new Error("The deletion session fixture is not ready.");
    }

    fixture.placeCaret(caretOffset);
  }, offset);
}

async function placeSessionSegmentCaret(
  page: Page,
  segmentIndex: number,
  offset: number,
): Promise<void> {
  await page.evaluate(
    ({ segmentIndex, offset }) => {
      const fixture = window.__lexicalReviewSessionEditorFixture;

      if (fixture == null) {
        throw new Error("The deletion session fixture is not ready.");
      }

      fixture.placeSegmentCaret(segmentIndex, offset);
    },
    { offset, segmentIndex },
  );
}

async function selectSessionSegmentRange(
  page: Page,
  startSegmentIndex: number,
  startOffset: number,
  endSegmentIndex: number,
  endOffset: number,
): Promise<void> {
  await page.evaluate(
    ({ endOffset, endSegmentIndex, startOffset, startSegmentIndex }) => {
      const fixture = window.__lexicalReviewSessionEditorFixture;

      if (fixture == null) {
        throw new Error("The deletion session fixture is not ready.");
      }

      fixture.selectSegmentRange(
        startSegmentIndex,
        startOffset,
        endSegmentIndex,
        endOffset,
      );
    },
    { endOffset, endSegmentIndex, startOffset, startSegmentIndex },
  );
}

async function insertSessionText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const fixture = window.__lexicalReviewSessionEditorFixture;

    if (fixture == null) {
      throw new Error("The deletion session fixture is not ready.");
    }

    fixture.insertText(value);
  }, text);
}

async function dispatchSessionBeforeInput(
  page: Page,
  inputType: string,
): Promise<boolean> {
  return page.evaluate((type) => {
    const fixture = window.__lexicalReviewSessionEditorFixture;

    if (fixture == null) {
      throw new Error("The deletion session fixture is not ready.");
    }

    return fixture.dispatchBeforeInput(type);
  }, inputType);
}

async function compose(
  page: Page,
  scenario: ReviewEditorScenario,
  text: string,
  selection?: ReviewTextRange,
): Promise<void> {
  await page.evaluate(
    ({ scenario, text, selection }) => {
      const fixture = window.__lexicalReviewEditorFixture;

      if (fixture == null) {
        throw new Error("The review editor fixture is not ready.");
      }

      fixture.compose(scenario, text, selection);
    },
    { scenario, text, selection },
  );
}

async function getMarkup(
  page: Page,
  scenario: ReviewEditorScenario,
): Promise<ReviewMarkup> {
  return page.evaluate((scenario) => {
    const fixture = window.__lexicalReviewEditorFixture;

    if (fixture == null) {
      throw new Error("The review editor fixture is not ready.");
    }

    return fixture.getMarkup(scenario);
  }, scenario);
}

async function placeCaret(
  page: Page,
  scenario: ReviewEditorScenario,
): Promise<void> {
  await page.evaluate((scenario) => {
    const fixture = window.__lexicalReviewEditorFixture;

    if (fixture == null) {
      throw new Error("The review editor fixture is not ready.");
    }

    fixture.placeCaret(scenario);
  }, scenario);
}

async function getCaret(
  page: Page,
  scenario: ReviewEditorScenario,
): Promise<NativeCaret | null> {
  return page.evaluate((scenario) => {
    const fixture = window.__lexicalReviewEditorFixture;

    if (fixture == null) {
      throw new Error("The review editor fixture is not ready.");
    }

    return fixture.getCaret(scenario);
  }, scenario);
}

async function installDeleteTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const trace: DeleteTraceEntry[] = [];

    for (const type of ["keydown", "beforeinput", "input"]) {
      document.addEventListener(
        type,
        (event) => {
          const keyboardEvent = event as KeyboardEvent;
          const inputEvent = event as InputEvent;
          trace.push({
            type,
            defaultPrevented: event.defaultPrevented,
            key: keyboardEvent.key,
            inputType: inputEvent.inputType,
          });
        },
        false,
      );
    }

    window.__deleteTrace = trace;
  });
}

test("Delete creates and extends one deletion draft in the review session", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  const editor = page.getByTestId("review-session-editor");
  await expect(editor).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__lexicalReviewSessionEditorFixture !== undefined,
      ),
    )
    .toBe(true);
  await expect(getSessionSegments(page)).resolves.toEqual([
    { review: "original", text: "Alpha beta gamma" },
  ]);

  await placeSessionCaret(page, 0);
  await editor.press("Delete");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "deletion", text: "A" },
      { review: "original", text: "lpha beta gamma" },
    ]);
  await expect(editor.locator("del")).toHaveText("A");

  await editor.press("Delete");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "deletion", text: "Al" },
      { review: "original", text: "pha beta gamma" },
    ]);
  await expect(editor.locator("del")).toHaveText("Al");
  await expect
    .poll(() => getSessionCaret(page))
    .toEqual({
      anchorNodeType: "text",
      offset: 2,
      review: "deletion",
      segmentIndex: 0,
    });
});

test("Backspace creates and extends one backward deletion draft", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  const editor = page.getByTestId("review-session-editor");
  await expect(editor).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__lexicalReviewSessionEditorFixture !== undefined,
      ),
    )
    .toBe(true);

  await placeSessionCaret(page, "Alpha beta gamma".length);
  await editor.press("Backspace");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "original", text: "Alpha beta gamm" },
      { review: "deletion", text: "a" },
    ]);

  await editor.press("Backspace");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "original", text: "Alpha beta gam" },
      { review: "deletion", text: "ma" },
    ]);
  await expect(editor.locator("del")).toHaveText("ma");
  await expect
    .poll(() => getSessionCaret(page))
    .toEqual({
      anchorNodeType: "text",
      offset: 0,
      review: "deletion",
      segmentIndex: 1,
    });
});

test("native forward beforeinput creates a deletion draft", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  const editor = page.getByTestId("review-session-editor");
  await placeSessionCaret(page, 0);

  await expect(
    dispatchSessionBeforeInput(page, "deleteContentForward"),
  ).resolves.toBe(true);
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "deletion", text: "A" },
      { review: "original", text: "lpha beta gamma" },
    ]);
  await expect
    .poll(() => getSessionCaret(page))
    .toEqual({
      anchorNodeType: "text",
      offset: 1,
      review: "deletion",
      segmentIndex: 0,
    });
  await expect(editor.locator("del")).toHaveText("A");
});

test("native word beforeinput resolves a larger deletion target", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  await placeSessionCaret(page, 0);

  await expect(
    dispatchSessionBeforeInput(page, "deleteWordForward"),
  ).resolves.toBe(true);
  await expect
    .poll(async () => {
      const segments = await getSessionSegments(page);
      const deleted = segments[0];
      const remaining = segments[1];
      return (
        deleted?.review === "deletion" &&
        /^Alpha/.test(deleted.text) &&
        deleted.text.length > 1 &&
        remaining?.review === "original" &&
        remaining.text.trimStart() === "beta gamma"
      );
    })
    .toBe(true);
});

test("an explicit selected range creates one deletion draft", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  const editor = page.getByTestId("review-session-editor");
  await selectSessionSegmentRange(page, 0, 1, 0, 3);
  await editor.press("Backspace");

  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "original", text: "A" },
      { review: "deletion", text: "lp" },
      { review: "original", text: "ha beta gamma" },
    ]);
});

test("insertion-draft correction reconciles across an accepted boundary", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  const editor = page.getByTestId("review-session-editor");

  await placeSessionCaret(page, 2);
  await insertSessionText(page, "XYZ");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "original", text: "Al" },
      { review: "insertion", text: "XYZ" },
      { review: "original", text: "pha beta gamma" },
    ]);

  await selectSessionSegmentRange(page, 0, 2, 1, 1);
  await editor.press("Backspace");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "original", text: "Al" },
      { review: "insertion", text: "YZ" },
      { review: "original", text: "pha beta gamma" },
    ]);
});

test("deleting inside a deletion draft restores it, while an adjacent caret is a no-op", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  const editor = page.getByTestId("review-session-editor");

  await selectSessionSegmentRange(page, 0, 1, 0, 3);
  await editor.press("Backspace");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "original", text: "A" },
      { review: "deletion", text: "lp" },
      { review: "original", text: "ha beta gamma" },
    ]);

  await placeSessionSegmentCaret(page, 0, 1);
  await editor.press("Delete");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([
      { review: "original", text: "A" },
      { review: "deletion", text: "lp" },
      { review: "original", text: "ha beta gamma" },
    ]);

  await placeSessionSegmentCaret(page, 1, 1);
  await editor.press("Delete");
  await expect
    .poll(() => getSessionSegments(page))
    .toEqual([{ review: "original", text: "Alpha beta gamma" }]);
});

async function getDeleteTrace(page: Page): Promise<DeleteTraceEntry[]> {
  return page.evaluate(() => window.__deleteTrace ?? []);
}

async function expectEditorFocused(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
    )
    .toBe("review-editor");
}

function expectedDeletedSegments(
  originalText: string,
  deletedCharacters: number,
): ReviewSegment[] {
  return [
    {
      review: "deletion",
      text: originalText.slice(0, deletedCharacters),
    },
    {
      review: "original",
      text: originalText.slice(deletedCharacters),
    },
  ];
}

test("Delete removes one inserted character at an original-to-insertion boundary", async ({
  page,
}, testInfo) => {
  await openReviewEditorFixture(page);
  const initialSegments = await getSegments(page, "insertion-boundary");
  const insertionIndex = initialSegments.findIndex(
    (segment) => segment.review === "insertion",
  );
  const initialInsertion = initialSegments[insertionIndex];

  expect(insertionIndex).toBeGreaterThanOrEqual(0);
  if (initialInsertion == null) {
    throw new Error("The review editor fixture has no insertion segment.");
  }
  expect(initialInsertion.text).not.toBe("");

  await placeCaret(page, "insertion-boundary");
  await expectEditorFocused(page);
  await expect
    .poll(() => getCaret(page, "insertion-boundary"))
    .toEqual({
      anchorNodeType: "text",
      offset: initialSegments[0]?.text.length,
      review: "original",
      segmentIndex: 0,
    });
  await installDeleteTrace(page);
  await page.keyboard.press("Delete");

  const expectedSegments = initialSegments.map((segment, index) =>
    index === insertionIndex
      ? { ...segment, text: segment.text.slice(1) }
      : segment,
  );
  await expect
    .poll(async () => ({
      caret: await getCaret(page, "insertion-boundary"),
      segments: await getSegments(page, "insertion-boundary"),
    }))
    .toEqual({
      caret: {
        anchorNodeType: "text",
        offset: 0,
        review: "insertion",
        segmentIndex: insertionIndex,
      },
      segments: expectedSegments,
    });

  await expect
    .poll(async () => {
      const trace = await getDeleteTrace(page);
      return trace.some(
        (event) => event.type === "keydown" && event.key === "Delete",
      );
    })
    .toBe(true);

  const trace = await getDeleteTrace(page);
  await testInfo.attach("delete-event-trace", {
    body: JSON.stringify(
      {
        browser: testInfo.project.name,
        caret: await getCaret(page, "insertion-boundary"),
        trace,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("two Delete presses mark consecutive original characters as deleted", async ({
  page,
}, testInfo) => {
  await openReviewEditorFixture(page);
  const initialSegments = await getSegments(page, "consecutive-delete-start");

  expect(initialSegments).toHaveLength(1);
  const initialSegment = initialSegments[0];
  if (initialSegment == null) {
    throw new Error("The review editor fixture has no original segment.");
  }
  expect(initialSegment.review).toBe("original");
  expect(initialSegment.text.length).toBeGreaterThanOrEqual(2);

  await placeCaret(page, "consecutive-delete-start");
  await expectEditorFocused(page);
  await expect
    .poll(() => getCaret(page, "consecutive-delete-start"))
    .toEqual({
      anchorNodeType: "text",
      offset: 0,
      review: "original",
      segmentIndex: 0,
    });

  await page.keyboard.press("Delete");

  const snapshots: Array<{
    caret: NativeCaret | null;
    segments: ReviewSegment[];
  }> = [];
  await expect
    .poll(async () => ({
      caret: await getCaret(page, "consecutive-delete-start"),
      segments: await getSegments(page, "consecutive-delete-start"),
    }))
    .toEqual({
      caret: {
        anchorNodeType: "text",
        offset: 1,
        review: "deletion",
        segmentIndex: 0,
      },
      segments: expectedDeletedSegments(initialSegment.text, 1),
    });
  snapshots.push({
    caret: await getCaret(page, "consecutive-delete-start"),
    segments: await getSegments(page, "consecutive-delete-start"),
  });

  await page.keyboard.press("Delete");
  try {
    await expect
      .poll(async () => ({
        caret: await getCaret(page, "consecutive-delete-start"),
        segments: await getSegments(page, "consecutive-delete-start"),
      }))
      .toEqual({
        caret: {
          anchorNodeType: "text",
          offset: 2,
          review: "deletion",
          segmentIndex: 0,
        },
        segments: expectedDeletedSegments(initialSegment.text, 2),
      });
  } finally {
    snapshots.push({
      caret: await getCaret(page, "consecutive-delete-start"),
      segments: await getSegments(page, "consecutive-delete-start"),
    });

    await testInfo.attach("consecutive-delete-snapshots", {
      body: JSON.stringify(
        { browser: testInfo.project.name, snapshots },
        null,
        2,
      ),
      contentType: "application/json",
    });
  }
});

test("composition commits formatted review text once and keeps the caret", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  await expect
    .poll(() => getSegments(page, "composition"))
    .toEqual([{ review: "insertion", text: "composed" }]);

  await placeCaret(page, "composition");
  await compose(page, "composition", "あ");

  await expect
    .poll(async () => ({
      caret: await getCaret(page, "composition"),
      markup: await getMarkup(page, "composition"),
      segments: await getSegments(page, "composition"),
    }))
    .toEqual({
      caret: {
        anchorNodeType: "text",
        offset: "composedあ".length,
        review: "insertion",
        segmentIndex: 0,
      },
      markup: {
        format: "EM",
        marker: "INS",
        text: "composedあ",
      },
      segments: [{ review: "insertion", text: "composedあ" }],
    });
});

test("composition over selected original text creates an insertion review", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  await expect
    .poll(() => getSegments(page, "composition-selection"))
    .toEqual([{ review: "original", text: "abcdef" }]);

  await compose(page, "composition-selection", "あ", {
    start: 0,
    end: "abcdef".length,
  });

  await expect
    .poll(async () => ({
      caret: await getCaret(page, "composition-selection"),
      segments: await getSegments(page, "composition-selection"),
    }))
    .toEqual({
      caret: {
        anchorNodeType: "text",
        offset: "あ".length,
        review: "insertion",
        segmentIndex: 1,
      },
      segments: [
        { review: "deletion", text: "abcdef" },
        { review: "insertion", text: "あ" },
      ],
    });
});
