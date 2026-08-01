import { insertNameToTestTable } from "./try.js";

export default {
	fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/")) {
			return insertNameToTestTable("Cloudflare", env);
		}

		return new Response(null, { status: 404 });
	},
}
