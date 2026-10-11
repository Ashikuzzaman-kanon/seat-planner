import { readFile } from "node:fs/promises";
import { devToolsAllowed, findApk } from "../devTools";

/*
 * The Android app, straight from this computer to a phone on the same Wi-Fi —
 * the "Install the app" QR code on the Open on phone page points here. Only
 * on a developer's machine, like the page itself.
 */
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!devToolsAllowed(request.headers.get("host") || "")) {
    return new Response("Not found", { status: 404 });
  }

  const apk = await findApk();
  if (!apk) {
    return new Response("The Android app has not been built on this computer yet — see android/README.md.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const body = await readFile(apk.path);
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": 'attachment; filename="seat-planner.apk"',
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
  });
}
