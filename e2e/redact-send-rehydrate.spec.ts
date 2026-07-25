import { expect, test } from "@playwright/test";

/**
 * The redact → send → rehydrate loop, automated in a real (headless) browser,
 * driving the demo app (examples/demo) which consumes ONLY the library's
 * public API.
 *
 * We drive the OpenRouter provider path (VITE_USE_OPENROUTER=1, which routes
 * through the same-origin dev proxy) and intercept the request with `page.route`
 * BEFORE it reaches the proxy, so NOTHING leaves the machine. The interceptor is
 * the network-boundary proof: it inspects the exact bytes the app puts on the
 * wire and asserts only placeholders cross it.
 */

/** Raw PII from SYNTHETIC_STATEMENT — none of these may ever hit the wire. */
const RAW_VALUES = [
  "Ada Lovelace",
  "ada.lovelace@example.com",
  "(415) 555-0132",
  "123-45-6789",
  "000123456789",
  "021000021",
  "GB82 WEST 1234 5698 7654 32",
  "4242 4242 4242 4242",
  "Whole Foods",
  "$1,482.10",
];

const SUCCESS_TEXT =
  "Done. The provider only saw placeholders; real values were restored locally.";

test("redact → send → rehydrate: only placeholders cross the wire", async ({
  page,
}) => {
  let wireBody = "";

  // Register the interceptor BEFORE goto so it catches the send. The canned
  // OpenAI-compatible reply echoes placeholders so local rehydration has
  // tokens to restore.
  await page.route("**/openrouter/**", async (route) => {
    wireBody = route.request().postData() ?? "";

    // NETWORK-BOUNDARY PROOF: placeholders present, raw PII absent.
    expect(wireBody).toContain("[NAME_1]");
    expect(wireBody).toContain("[CARD_1]");
    for (const raw of RAW_VALUES) {
      expect(wireBody, `raw value leaked on the wire: ${raw}`).not.toContain(
        raw,
      );
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            message: {
              content:
                "Reviewed [NAME_1]'s statement; largest charge [AMOUNT_1].",
            },
          },
        ],
      }),
    });
  });

  await page.goto("/");

  // Pre-send proof: the rendered wire payload already shows placeholders and
  // none of the raw values.
  const wire = page.locator("#wire");
  await expect(wire).toContainText("[NAME_1]");
  await expect(wire).toContainText("[CARD_1]");
  for (const raw of RAW_VALUES) {
    await expect(wire).not.toContainText(raw);
  }

  // The send button IS the explicit approval step — say so on its face.
  await expect(page.locator("#send")).toContainText("Approve");
  await page.locator("#send").click();

  // Wait for the loop to finish.
  await expect(page.locator("#status")).toHaveText(SUCCESS_TEXT);

  // The interceptor fired (wire bytes captured) — guards against a silent
  // provider-path miss.
  expect(wireBody.length).toBeGreaterThan(0);

  // Rehydration proof: real values restored locally in the answer pane.
  const answer = page.locator("#answer");
  await expect(answer).toContainText("Ada Lovelace");
  await expect(answer).toContainText("$1,482.10");

  // Write to the gitignored artifacts dir so test runs never churn the tree.
  // The committed README hero (docs/demo.png) is a stable, decoupled snapshot.
  await page.screenshot({
    path: "test-results/redact-send-rehydrate.png",
    fullPage: true,
  });
});

test("egress receipts + fail-closed refusal are demonstrable in the demo", async ({
  page,
}) => {
  // Canned OpenAI-compatible reply for the approved (allow) send.
  await page.route("**/openrouter/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: "Reviewed [NAME_1]'s statement." } }],
      }),
    });
  });

  await page.goto("/");

  // Turn ON receipt signing so every guard decision is sealed.
  await page.locator("#receipts-toggle").check();

  // 1) Fail-closed refusal: attempt to send a payload that was NEVER approved.
  await page.locator("#try-unapproved").click();
  await expect(page.locator("#answer")).toContainText("Refused (fail-closed)");
  // With receipts on, the refusal itself is sealed as a signed DENY receipt.
  const denyReceipt = page.locator("#receipts .receipt");
  await expect(denyReceipt).toHaveCount(1);
  await expect(denyReceipt.first()).toContainText("DENY");
  await expect(denyReceipt.first()).toContainText("signed ✓");

  // 2) An approved send is sealed as a signed ALLOW receipt.
  await page.locator("#send").click();
  await expect(page.locator("#status")).toHaveText(SUCCESS_TEXT);
  const allowReceipt = page.locator("#receipts .receipt");
  await expect(allowReceipt).toHaveCount(1);
  await expect(allowReceipt.first()).toContainText("ALLOW");
  await expect(allowReceipt.first()).toContainText("signed ✓");
});
