import { expect, test } from "vitest";
import { htmlToText } from "./mail";

test("an HTML mail becomes readable text with its amounts intact", () => {
  const html = `<html><head><style>.x{color:red}</style><title>Receipt</title></head><body>
    <!-- header -->
    <table><tr><td>Order Total:</td><td>&#8377;1,249.00</td></tr></table>
    <p>Paid with Visa &bull;&bull;&bull;&bull; 4521<br>Thanks &amp; see you soon</p>
    <script>track()</script>
    <div>Delivered to&nbsp;Home</div></body></html>`;
  const text = htmlToText(html);
  expect(text).not.toMatch(/<|color:red|track\(\)|Receipt/);
  expect(text).toContain("Order Total: ₹1,249.00");
  expect(text).toContain("Paid with Visa •••• 4521\nThanks & see you soon");
  expect(text).toContain("Delivered to Home");
});

test("unknown entities are left alone and blank lines are collapsed", () => {
  expect(htmlToText("a&zzz;b<p></p><p></p><p>c</p>")).toBe("a&zzz;b\n\nc");
});
