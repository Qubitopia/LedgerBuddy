import { createMiddleware } from "hono/factory";
import type { AppContext } from "../types";

export const deviceAuth = createMiddleware<AppContext>(async (c, next) => {
  const token = c.req.header("x-device-token");
  if (!token || token !== c.env.DEVICE_SHARED_TOKEN) {
    return c.json({ error: "Unauthorized device" }, 401);
  }
  await next();
});
