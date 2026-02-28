import { Hono } from "hono";
import { announcementsRoute } from "./routes/announcements";
import { voiceRoute } from "./routes/voice";
import { webhooksRoute } from "./routes/webhooks";
import { setupOpenApi } from "./openapi";
import type { AppContext } from "./types";

const app = new Hono<AppContext>();

app.get("/health", (c) => c.json({ status: "ok", app: c.env.APP_NAME }));

app.route("/webhooks", webhooksRoute);
app.route("/announcements", announcementsRoute);
app.route("/voice", voiceRoute);

setupOpenApi(app);

app.onError((error, c) => {
  return c.json({ error: error.message || "Internal Server Error" }, 500);
});

export default app;
