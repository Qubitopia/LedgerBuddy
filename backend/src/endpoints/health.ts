import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";

import type { AppContext } from "../types";

export class HealthCheck extends OpenAPIRoute {
	schema = {
		tags: ["System"],
		summary: "Health check",
		responses: {
			"200": {
				description: "Service is healthy",
				content: {
					"application/json": {
						schema: z.object({
							status: Str({ example: "ok" }),
							timestamp: Str({ example: "2026-03-09T12:00:00.000Z" }),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
		};
	}
}
